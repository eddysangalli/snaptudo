package main

import (
	"strings"
	"testing"
)

func TestAllowedYouTubeURL(t *testing.T) {
	allowed := []string{
		"https://www.youtube.com/watch?v=jNQXAC9IVRw",
		"https://m.youtube.com/shorts/jNQXAC9IVRw",
		"https://youtu.be/jNQXAC9IVRw",
	}
	for _, raw := range allowed {
		if !isAllowedYouTubeURL(raw) {
			t.Fatalf("URL permitida foi recusada: %s", raw)
		}
	}

	blocked := []string{
		"http://youtube.com/watch?v=x",
		"https://youtube.example/watch?v=x",
		"https://evil.example/?v=x",
		"https://www.youtube.com/",
	}
	for _, raw := range blocked {
		if isAllowedYouTubeURL(raw) {
			t.Fatalf("URL indevida foi aceita: %s", raw)
		}
	}
}

func TestBuildArgsAreBoundedAndNoPlaylist(t *testing.T) {
	args, _ := buildYtDlpArgs(config{DownloadDir: `C:\Downloads\SnapTudo`}, "video", "https://youtu.be/test")
	joined := strings.Join(args, " ")
	for _, expected := range []string{"--no-playlist", "https://youtu.be/test"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("argumento esperado ausente: %s em %s", expected, joined)
		}
	}
	if !strings.Contains(joined, "height<=720") && !strings.Contains(joined, "height<=1080") {
		t.Fatalf("limite de resolução ausente em %s", joined)
	}
}
