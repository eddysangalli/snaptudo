package main

import (
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
	"runtime"
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
}

type config struct {
	YtDlpPath   string `json:"ytDlpPath"`
	DownloadDir string `json:"downloadDir"`
	NodePath    string `json:"nodePath"`
	FFmpegPath  string `json:"ffmpegPath"`
}

type response struct {
	Success     bool   `json:"success"`
	Error       string `json:"error,omitempty"`
	Version     string `json:"version,omitempty"`
	YtDlp       string `json:"ytDlpVersion,omitempty"`
	DownloadDir string `json:"downloadDir,omitempty"`
	NodeFound   bool   `json:"nodeFound,omitempty"`
	FFmpegFound bool   `json:"ffmpegFound,omitempty"`
	Started     bool   `json:"started,omitempty"`
	PID         int    `json:"pid,omitempty"`
	LogPath     string `json:"logPath,omitempty"`
	Mode        string `json:"mode,omitempty"`
}

func main() {
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
	logPath := filepath.Join(logsDir, fmt.Sprintf("download-%s-%s.log", mode, time.Now().Format("20060102-150405")))
	logFile, err := os.Create(logPath)
	if err != nil {
		return response{Success: false, Error: "Não foi possível criar o log: " + err.Error()}
	}

	args, ffmpegFound := buildYtDlpArgs(cfg, mode, req.URL)
	cmd := exec.Command(cfg.YtDlpPath, args...)
	cmd.Dir = installDir
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000200}
	}
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return response{Success: false, Error: "Falha ao iniciar yt-dlp: " + err.Error()}
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	_ = logFile.Close()

	result := response{
		Success:     true,
		Started:     true,
		PID:         pid,
		Mode:        mode,
		DownloadDir: cfg.DownloadDir,
		LogPath:     logPath,
		FFmpegFound: ffmpegFound,
	}
	if mode == "video" && !ffmpegFound {
		result.Error = "FFmpeg não foi encontrado; o yt-dlp tentará um formato já combinado de até 720p."
	}
	return result
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
