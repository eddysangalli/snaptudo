/**
 * SnapTudo - YouTube Content Script 🌶️
 * Injeta o botão SnapTudo na barra de ações do YouTube,
 * menu flutuante anti-overflow, download HD em 1 clique e gravação ao vivo do player.
 */

(() => {
  if (window.__SNAPTUDO_YT_INJECTED__) return;
  window.__SNAPTUDO_YT_INJECTED__ = true;

  console.info("[SnapTudo] YouTube Content Script ativo 🌶️");

  let activeRecorder = null;
  let activeStream = null;
  let recordedChunks = [];
  let recordingTimer = null;
  let activeDropdown = null;

  // Extrair ID do vídeo do YouTube
  function getYouTubeVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    const v = urlParams.get("v");
    if (v) return v;

    const shortsMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shortsMatch && shortsMatch[1]) return shortsMatch[1];

    return null;
  }

  // Gravar vídeo do player em tempo real (100% nativo e sem restrições)
  function startRecordingVideo() {
    const video = document.querySelector("#movie_player video, video.html5-main-video, video");
    if (!video) {
      alert("Nenhum vídeo em reprodução detectado no player.");
      return;
    }

    try {
      activeStream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
      if (!activeStream) {
        alert("Navegador não suporta gravação direta de stream HTML5.");
        return;
      }

      recordedChunks = [];

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : (MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm");

      activeRecorder = new MediaRecorder(activeStream, { mimeType });

      activeRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      activeRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const title = (document.title || "YouTube_Video")
          .replace(" - YouTube", "")
          .replace(/[\\/:*?"<>|]/g, "_")
          .trim();
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";

        const a = document.createElement("a");
        a.href = url;
        a.download = `${title}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
        removeRecordingBadge();
      };

      activeRecorder.start(1000);
      showRecordingBadge();
    } catch (e) {
      alert("Erro ao iniciar gravação do player: " + e.message);
    }
  }

  function stopRecordingVideo() {
    if (activeRecorder && activeRecorder.state !== "inactive") {
      activeRecorder.stop();
    }
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
    }
  }

  function showRecordingBadge() {
    removeRecordingBadge();
    const container = document.querySelector("#movie_player") || document.body;
    const badge = document.createElement("div");
    badge.className = "snaptudo-recording-badge";
    badge.id = "snaptudo-rec-badge";

    let sec = 0;
    badge.innerHTML = `
      <div class="snaptudo-rec-dot"></div>
      <span>Gravando Player: <strong id="snaptudo-rec-time">00:00</strong></span>
      <button class="snaptudo-rec-stop-btn" id="snaptudo-rec-stop">Parar e Salvar</button>
    `;

    container.appendChild(badge);

    recordingTimer = setInterval(() => {
      sec++;
      const m = String(Math.floor(sec / 60)).padStart(2, "0");
      const s = String(sec % 60).padStart(2, "0");
      const timeElem = document.getElementById("snaptudo-rec-time");
      if (timeElem) timeElem.textContent = `${m}:${s}`;
    }, 1000);

    document.getElementById("snaptudo-rec-stop").onclick = stopRecordingVideo;
  }

  function removeRecordingBadge() {
    clearInterval(recordingTimer);
    const b = document.getElementById("snaptudo-rec-badge");
    if (b) b.remove();
  }

  // Fechar qualquer menu flutuante ativo
  function closeActiveDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
  }

  // Abrir menu flutuante diretamente no document.body para NÃO ser cortado por overflow:hidden
  function openYouTubeMenu(triggerBtn) {
    closeActiveDropdown();

    const videoId = getYouTubeVideoId();
    if (!videoId) {
      alert("Abra um vídeo ou Shorts para baixar.");
      return;
    }

    const rect = triggerBtn.getBoundingClientRect();
    const cleanTitle = (document.title || "YouTube_Video")
      .replace(" - YouTube", "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim();

    const menu = document.createElement("div");
    menu.className = "snaptudo-yt-floating-menu";
    menu.style.top = `${rect.bottom + window.scrollY + 8}px`;
    menu.style.left = `${Math.max(12, rect.left + window.scrollX - 60)}px`;

    menu.innerHTML = `
      <div class="snaptudo-menu-header">
        <span class="snaptudo-menu-title">🌶️ SnapTudo: Opções de Download</span>
      </div>
      <button class="snaptudo-menu-item" id="opt-yt-sidecar">
        <span class="icon">⚡</span>
        <div class="text">
          <strong>Baixar Vídeo MP4 (yt-dlp)</strong>
          <small>Motor local, até 1080p com FFmpeg</small>
        </div>
        <span class="badge">HD</span>
      </button>
      <button class="snaptudo-menu-item" id="opt-yt-mp3">
        <span class="icon">🎵</span>
        <div class="text">
          <strong>Baixar Áudio M4A (yt-dlp)</strong>
          <small>Melhor faixa de áudio disponível</small>
        </div>
        <span class="badge">MP3</span>
      </button>
      <button class="snaptudo-menu-item" id="opt-yt-cobalt">
        <span class="icon">🎬</span>
        <div class="text">
          <strong>Alternativa web (Cobalt)</strong>
          <small>Fallback quando o sidecar não estiver instalado</small>
        </div>
        <span class="badge">MP4</span>
      </button>
      <button class="snaptudo-menu-item accent" id="opt-yt-rec">
        <span class="icon">🔴</span>
        <div class="text">
          <strong>Gravar Player ao Vivo</strong>
          <small>Gravação nativa do player em tempo real</small>
        </div>
        <span class="badge">REC</span>
      </button>
    `;

    document.body.appendChild(menu);
    activeDropdown = menu;

    const fullYtUrl = `https://www.youtube.com/watch?v=${videoId}`;
    function startSidecarDownload(mode) {
      chrome.runtime.sendMessage({ action: "startYtDlpDownload", mode, url: fullYtUrl }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          alert(response?.error || "Sidecar yt-dlp não instalado. Use a alternativa Cobalt.");
          return;
        }
        alert(`Download iniciado em:\n${response.downloadDir}`);
      });
    }

    menu.querySelector("#opt-yt-sidecar").onclick = (e) => {
      e.stopPropagation();
      closeActiveDropdown();
      startSidecarDownload("video");
    };

    menu.querySelector("#opt-yt-mp3").onclick = (e) => {
      e.stopPropagation();
      closeActiveDropdown();
      startSidecarDownload("audio");
    };

    menu.querySelector("#opt-yt-cobalt").onclick = (e) => {
      e.stopPropagation();
      closeActiveDropdown();
      navigator.clipboard.writeText(fullYtUrl).catch(() => {});
      window.open(`https://cobalt.tools/#${fullYtUrl}`, "_blank");
    };

    menu.querySelector("#opt-yt-rec").onclick = (e) => {
      e.stopPropagation();
      closeActiveDropdown();
      startRecordingVideo();
    };
  }

  // Injetar o botão na barra de ações do YouTube
  function injectYouTubeButton() {
    if (!window.location.pathname.includes("/watch") && !window.location.pathname.includes("/shorts")) return;
    if (document.querySelector(".snaptudo-yt-btn")) return;

    // Buscar a barra de botões abaixo do vídeo
    const target = document.querySelector("#actions #top-level-buttons-computed, ytd-watch-metadata #actions #top-level-buttons-computed");
    if (!target) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "snaptudo-yt-btn";
    btn.title = "SnapTudo: Baixar vídeo, áudio ou gravar em tempo real";
    btn.innerHTML = `🌶️ SnapTudo <span>▼</span>`;

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeDropdown) {
        closeActiveDropdown();
      } else {
        openYouTubeMenu(btn);
      }
    };

    target.appendChild(btn);
  }

  document.addEventListener("click", (e) => {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      closeActiveDropdown();
    }
  });

  window.addEventListener("scroll", closeActiveDropdown, { passive: true });

  const observer = new MutationObserver(injectYouTubeButton);
  observer.observe(document.body, { childList: true, subtree: true });
  injectYouTubeButton();

  // Responder ao popup da extensão
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "getYouTubeInfo") {
      const videoId = getYouTubeVideoId();
      const title = (document.title || "Vídeo do YouTube").replace(" - YouTube", "").trim();
      const channelElem = document.querySelector("#channel-name a, ytd-channel-name a, #owner-name a");
      const channel = channelElem?.textContent?.trim() || "";

      sendResponse({
        ok: !!videoId,
        data: {
          videoId,
          title,
          channel
        }
      });
      return true;
    }

    if (msg.action === "startYouTubeLiveRecord") {
      startRecordingVideo();
      sendResponse({ started: true });
      return true;
    }
  });
})();
