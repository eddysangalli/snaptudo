package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var version = "dev"

const maxNativeMessageBytes = 1024 * 1024

type request struct {
	Action string `json:"action"`
	Mode   string `json:"mode"`
	URL    string `json:"url"`
	JobID  string `json:"jobId"`
}

type config struct {
	YtDlpPath   string `json:"ytDlpPath"`
	DownloadDir string `json:"downloadDir"`
	NodePath    string `json:"nodePath"`
	FFmpegPath  string `json:"ffmpegPath"`
}

type response struct {
	Success     bool         `json:"success"`
	Error       string       `json:"error,omitempty"`
	Version     string       `json:"version,omitempty"`
	YtDlp       string       `json:"ytDlpVersion,omitempty"`
	DownloadDir string       `json:"downloadDir,omitempty"`
	NodeFound   bool         `json:"nodeFound,omitempty"`
	FFmpegFound bool         `json:"ffmpegFound,omitempty"`
	Started     bool         `json:"started,omitempty"`
	PID         int          `json:"pid,omitempty"`
	LogPath     string       `json:"logPath,omitempty"`
	Mode        string       `json:"mode,omitempty"`
	Job         *downloadJob `json:"job,omitempty"`
}

type downloadJob struct {
	ID          string  `json:"id"`
	State       string  `json:"state"`
	Mode        string  `json:"mode"`
	URL         string  `json:"url"`
	Progress    float64 `json:"progress"`
	PID         int     `json:"pid,omitempty"`
	DownloadDir string  `json:"downloadDir"`
	LogPath     string  `json:"logPath"`
	FilePath    string  `json:"filePath,omitempty"`
	Error       string  `json:"error,omitempty"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

var downloadProgressPattern = regexp.MustCompile(`\[download\]\s+([0-9]+(?:\.[0-9]+)?)%`)

const completedFilePrefix = "__SNAPTUDO_FILE__:"

func main() {
	if len(os.Args) >= 3 && os.Args[1] == "--run-job" {
		runJobFile(os.Args[2])
		return
	}

	req, err := readRequest(os.Stdin)
	if err != nil {
		_ = writeResponse(os.Stdout, response{Success: false, Error: err.Error()})
		return
	}

	cfg, installDir, err := loadConfig()
	if err != nil {
		_ = writeResponse(os.Stdout, response{Success: false, Error: err.Error()})
		return
	}

	var result response
	switch req.Action {
	case "ping":
		result = ping(cfg)
	case "startDownload":
		result = startDownload(cfg, installDir, req)
	case "getDownloadStatus":
		result = getDownloadStatus(installDir, req.JobID)
	case "openDownloadDir":
		result = openDownloadDir(cfg)
	default:
		result = response{Success: false, Error: "Ação não permitida."}
	}
	_ = writeResponse(os.Stdout, result)
}

func readRequest(r io.Reader) (request, error) {
	var req request
	header := make([]byte, 4)
	if _, err := io.ReadFull(r, header); err != nil {
		return req, fmt.Errorf("mensagem nativa ausente: %w", err)
	}
	length := binary.LittleEndian.Uint32(header)
	if length == 0 || length > maxNativeMessageBytes {
		return req, fmt.Errorf("tamanho de mensagem inválido: %d", length)
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return req, fmt.Errorf("mensagem nativa incompleta: %w", err)
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return req, fmt.Errorf("JSON inválido: %w", err)
	}
	return req, nil
}

func writeResponse(w io.Writer, value response) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	header := make([]byte, 4)
	binary.LittleEndian.PutUint32(header, uint32(len(payload)))
	if _, err := w.Write(header); err != nil {
		return err
	}
	_, err = w.Write(payload)
	return err
}

func loadConfig() (config, string, error) {
	var cfg config
	executable, err := os.Executable()
	if err != nil {
		return cfg, "", err
	}
	installDir := filepath.Dir(executable)
	content, err := os.ReadFile(filepath.Join(installDir, "config.json"))
	if err != nil {
		return cfg, installDir, errors.New("config.json do sidecar não encontrado; execute install-sidecar.ps1")
	}
	if err := json.Unmarshal(content, &cfg); err != nil {
		return cfg, installDir, fmt.Errorf("config.json inválido: %w", err)
	}
	if cfg.YtDlpPath == "" {
		cfg.YtDlpPath = filepath.Join(installDir, "yt-dlp.exe")
	}
	if cfg.DownloadDir == "" {
		home, _ := os.UserHomeDir()
		cfg.DownloadDir = filepath.Join(home, "Downloads", "SnapTudo")
	}
	return cfg, installDir, nil
}

func ping(cfg config) response {
	if !fileExists(cfg.YtDlpPath) {
		return response{Success: false, Error: "yt-dlp.exe não encontrado no sidecar."}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, cfg.YtDlpPath, "--version").CombinedOutput()
	if err != nil {
		return response{Success: false, Error: "yt-dlp não iniciou: " + compactOutput(output, err)}
	}
	nodePath, nodeFound := resolveTool(cfg.NodePath, "node.exe")
	ffmpegPath, ffmpegFound := resolveTool(cfg.FFmpegPath, "ffmpeg.exe")
	_ = nodePath
	_ = ffmpegPath
	return response{
		Success:     true,
		Version:     version,
		YtDlp:       strings.TrimSpace(string(output)),
		DownloadDir: cfg.DownloadDir,
		NodeFound:   nodeFound,
		FFmpegFound: ffmpegFound,
	}
}

func startDownload(cfg config, installDir string, req request) response {
	if !isAllowedYouTubeURL(req.URL) {
		return response{Success: false, Error: "Apenas URLs HTTPS do YouTube são aceitas."}
	}
	if !fileExists(cfg.YtDlpPath) {
		return response{Success: false, Error: "yt-dlp.exe não encontrado; reinstale o sidecar."}
	}
	mode := "video"
	if req.Mode == "audio" {
		mode = "audio"
	}
	if err := os.MkdirAll(cfg.DownloadDir, 0o755); err != nil {
		return response{Success: false, Error: "Não foi possível criar a pasta de downloads: " + err.Error()}
	}
	logsDir := filepath.Join(installDir, "logs")
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return response{Success: false, Error: "Não foi possível criar a pasta de logs: " + err.Error()}
	}
	jobsDir := filepath.Join(installDir, "jobs")
	if err := os.MkdirAll(jobsDir, 0o755); err != nil {
		return response{Success: false, Error: "Não foi possível criar a pasta de trabalhos: " + err.Error()}
	}

	jobID := fmt.Sprintf("%s-%d", time.Now().Format("20060102-150405.000"), os.Getpid())
	jobID = strings.ReplaceAll(jobID, ".", "-")
	logPath := filepath.Join(logsDir, fmt.Sprintf("download-%s-%s.log", mode, jobID))
	jobPath := filepath.Join(jobsDir, jobID+".json")
	now := time.Now().Format(time.RFC3339)
	job := downloadJob{
		ID:          jobID,
		State:       "queued",
		Mode:        mode,
		URL:         req.URL,
		DownloadDir: cfg.DownloadDir,
		LogPath:     logPath,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := writeJob(jobPath, &job); err != nil {
		return response{Success: false, Error: "Não foi possível salvar o estado do download: " + err.Error()}
	}
	if err := os.WriteFile(filepath.Join(jobsDir, "latest.txt"), []byte(jobID), 0o644); err != nil {
		return response{Success: false, Error: "Não foi possível marcar o download atual: " + err.Error()}
	}
	job.State = "starting"
	job.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := writeJob(jobPath, &job); err != nil {
		return response{Success: false, Error: "Não foi possível preparar o estado do download: " + err.Error()}
	}

	executable, err := os.Executable()
	if err != nil {
		return response{Success: false, Error: "Não foi possível localizar o sidecar: " + err.Error()}
	}
	cmd := exec.Command(executable, "--run-job", jobPath)
	cmd.Dir = installDir
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000200}
	}
	if err := cmd.Start(); err != nil {
		job.State = "failed"
		job.Error = "Falha ao iniciar o monitor do download: " + err.Error()
		job.UpdatedAt = time.Now().Format(time.RFC3339)
		_ = writeJob(jobPath, &job)
		return response{Success: false, Error: job.Error, Job: &job}
	}
	pid := cmd.Process.Pid
	job.PID = pid
	_ = cmd.Process.Release()
	_, ffmpegFound := buildYtDlpArgs(cfg, mode, req.URL)

	result := response{
		Success:     true,
		Started:     true,
		PID:         pid,
		Mode:        mode,
		DownloadDir: cfg.DownloadDir,
		LogPath:     logPath,
		FFmpegFound: ffmpegFound,
		Job:         &job,
	}
	if mode == "video" && !ffmpegFound {
		result.Error = "FFmpeg não foi encontrado; o yt-dlp tentará um formato já combinado de até 720p."
	}
	return result
}

func runJobFile(jobPath string) {
	job, err := readJob(jobPath)
	if err != nil {
		return
	}
	cfg, installDir, err := loadConfig()
	if err != nil {
		job.State = "failed"
		job.Error = err.Error()
		job.UpdatedAt = time.Now().Format(time.RFC3339)
		_ = writeJob(jobPath, &job)
		return
	}

	logFile, err := os.OpenFile(job.LogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		job.State = "failed"
		job.Error = "Não foi possível abrir o log: " + err.Error()
		job.UpdatedAt = time.Now().Format(time.RFC3339)
		_ = writeJob(jobPath, &job)
		return
	}
	defer logFile.Close()

	args, _ := buildYtDlpArgs(cfg, job.Mode, job.URL)
	cmd := exec.Command(cfg.YtDlpPath, args...)
	cmd.Dir = installDir
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		markJobFailed(jobPath, &job, "Não foi possível capturar a saída do yt-dlp: "+err.Error())
		return
	}
	cmd.Stderr = cmd.Stdout
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000200}
	}
	if err := cmd.Start(); err != nil {
		markJobFailed(jobPath, &job, "Falha ao iniciar yt-dlp: "+err.Error())
		return
	}

	job.State = "downloading"
	job.PID = cmd.Process.Pid
	job.UpdatedAt = time.Now().Format(time.RFC3339)
	_ = writeJob(jobPath, &job)

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	lastPersist := time.Now()
	lastLine := ""
	for scanner.Scan() {
		line := scanner.Text()
		lastLine = line
		_, _ = fmt.Fprintln(logFile, line)

		changed := false
		if match := downloadProgressPattern.FindStringSubmatch(line); len(match) == 2 {
			if progress, parseErr := strconv.ParseFloat(match[1], 64); parseErr == nil && progress >= job.Progress {
				if progress-job.Progress >= 0.5 {
					changed = true
				}
				job.Progress = progress
				job.State = "downloading"
			}
		}
		if strings.Contains(line, "[Merger]") || strings.Contains(line, "[ExtractAudio]") || strings.Contains(line, "[VideoRemuxer]") {
			job.State = "processing"
			changed = true
		}
		if strings.HasPrefix(line, completedFilePrefix) {
			job.FilePath = strings.TrimSpace(strings.TrimPrefix(line, completedFilePrefix))
			changed = true
		}
		if changed || time.Since(lastPersist) >= time.Second {
			job.UpdatedAt = time.Now().Format(time.RFC3339)
			_ = writeJob(jobPath, &job)
			lastPersist = time.Now()
		}
	}

	waitErr := cmd.Wait()
	if waitErr != nil {
		detail := strings.TrimSpace(lastLine)
		if detail == "" {
			detail = waitErr.Error()
		}
		markJobFailed(jobPath, &job, compactOutput([]byte(detail), waitErr))
		return
	}
	if scanErr := scanner.Err(); scanErr != nil {
		markJobFailed(jobPath, &job, "Falha ao ler o progresso: "+scanErr.Error())
		return
	}

	job.State = "completed"
	job.Progress = 100
	job.Error = ""
	job.UpdatedAt = time.Now().Format(time.RFC3339)
	_ = writeJob(jobPath, &job)
}

func getDownloadStatus(installDir, requestedID string) response {
	jobsDir := filepath.Join(installDir, "jobs")
	jobID := strings.TrimSpace(requestedID)
	if jobID == "" {
		content, err := os.ReadFile(filepath.Join(jobsDir, "latest.txt"))
		if errors.Is(err, os.ErrNotExist) {
			return response{Success: true}
		}
		if err != nil {
			return response{Success: false, Error: "Não foi possível ler o download atual: " + err.Error()}
		}
		jobID = strings.TrimSpace(string(content))
	}
	if jobID == "" || filepath.Base(jobID) != jobID || strings.ContainsAny(jobID, `/\`) {
		return response{Success: false, Error: "Identificador de download inválido."}
	}
	job, err := readJob(filepath.Join(jobsDir, jobID+".json"))
	if err != nil {
		return response{Success: false, Error: "Estado do download não encontrado: " + err.Error()}
	}
	return response{Success: true, Job: &job, DownloadDir: job.DownloadDir, LogPath: job.LogPath, Mode: job.Mode, PID: job.PID}
}

func openDownloadDir(cfg config) response {
	if err := os.MkdirAll(cfg.DownloadDir, 0o755); err != nil {
		return response{Success: false, Error: "Não foi possível abrir a pasta: " + err.Error()}
	}
	if runtime.GOOS != "windows" {
		return response{Success: false, Error: "Abrir pasta está disponível apenas no Windows."}
	}
	if err := exec.Command("explorer.exe", cfg.DownloadDir).Start(); err != nil {
		return response{Success: false, Error: "Não foi possível abrir a pasta: " + err.Error()}
	}
	return response{Success: true, DownloadDir: cfg.DownloadDir}
}

func readJob(path string) (downloadJob, error) {
	var job downloadJob
	content, err := os.ReadFile(path)
	if err != nil {
		return job, err
	}
	if err := json.Unmarshal(content, &job); err != nil {
		return job, err
	}
	return job, nil
}

func writeJob(path string, job *downloadJob) error {
	content, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, content, 0o644)
}

func markJobFailed(path string, job *downloadJob, message string) {
	job.State = "failed"
	job.Error = message
	job.UpdatedAt = time.Now().Format(time.RFC3339)
	_ = writeJob(path, job)
}

func buildYtDlpArgs(cfg config, mode, rawURL string) ([]string, bool) {
	args := []string{
		"--no-playlist",
		"--newline",
		"--windows-filenames",
		"--continue",
		"--no-overwrites",
		"--paths", cfg.DownloadDir,
		"--output", "%(title).180B [%(id)s].%(ext)s",
	}
	args = append(args, "--print", "after_move:"+completedFilePrefix+"%(filepath)s")

	if nodePath, ok := resolveTool(cfg.NodePath, "node.exe"); ok {
		args = append(args, "--js-runtimes", "node:"+nodePath)
	}
	ffmpegPath, ffmpegFound := resolveTool(cfg.FFmpegPath, "ffmpeg.exe")
	if ffmpegFound {
		args = append(args, "--ffmpeg-location", ffmpegPath)
	}

	if mode == "audio" {
		args = append(args, "--format", "bestaudio[ext=m4a]/bestaudio")
	} else if ffmpegFound {
		args = append(args,
			"--format", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
			"--merge-output-format", "mp4",
		)
	} else {
		args = append(args, "--format", "b[height<=720][ext=mp4]/b[height<=720]/b")
	}
	return append(args, rawURL), ffmpegFound
}

func isAllowedYouTubeURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "youtu.be" && host != "youtube.com" && !strings.HasSuffix(host, ".youtube.com") {
		return false
	}
	if host == "youtu.be" {
		return strings.Trim(parsed.Path, "/") != ""
	}
	if parsed.Query().Get("v") != "" {
		return true
	}
	return strings.HasPrefix(parsed.Path, "/shorts/") || strings.HasPrefix(parsed.Path, "/live/")
}

func resolveTool(configuredPath, executableName string) (string, bool) {
	if configuredPath != "" && fileExists(configuredPath) {
		return configuredPath, true
	}
	path, err := exec.LookPath(executableName)
	return path, err == nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func compactOutput(output []byte, err error) string {
	text := strings.TrimSpace(string(output))
	if len(text) > 500 {
		text = text[len(text)-500:]
	}
	if text == "" && err != nil {
		return err.Error()
	}
	return text
}
