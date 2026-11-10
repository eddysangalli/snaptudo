/**
 * SnapTudo - Sniffer Universal de Mídias Web
 * Detecta vídeos HTML5, playlists HLS (m3u8), DASH, áudios e imagens em alta resolução,
 * além de permitir gravação direta de stream (MediaRecorder) para vídeos blob/livestreams.
 */

(() => {
  if (window.__SNAPTUDO_UNIVERSAL_INJECTED__) return;
  window.__SNAPTUDO_UNIVERSAL_INJECTED__ = true;

  console.info("[SnapTudo] Sniffer Universal ativo na página 🌶️");

  let universalRecorder = null;
  let universalStream = null;
  let universalChunks = [];
  let recTimer = null;

  // Escanear mídias presentes no DOM
  function scanMedia() {
    const pageTitle = document.title || "midia";
    const videoList = [];
    const imageList = [];
    const hlsList = [];
    const seenUrls = new Set();

    // 1. VÍDEOS & STREAMS
    const videoTags = document.querySelectorAll("video");
    videoTags.forEach((v, idx) => {
      let src = v.currentSrc || v.src;
      if (!src) {
        const source = v.querySelector("source[src]");
        if (source) src = source.src;
      }

      if (src) {
        const isBlob = src.startsWith("blob:");
        const isHls = src.includes(".m3u8");

        if (!seenUrls.has(src)) {
          seenUrls.add(src);
          if (isHls) {
            hlsList.push({
              url: src,
              title: `${pageTitle} - Fluxo HLS ${idx + 1}`
            });
          } else {
            videoList.push({
              id: `vid_${idx}`,
              url: src,
              isBlob,
              type: "video",
              ext: isBlob ? "blob" : (src.split("?")[0].split(".").pop() || "mp4"),
              width: v.videoWidth || v.clientWidth || 0,
              height: v.videoHeight || v.clientHeight || 0,
              duration: v.duration ? Math.round(v.duration) : null,
              title: v.getAttribute("title") || `${pageTitle} - Vídeo ${idx + 1}`
            });
          }
        }
      }
    });

    // 2. IMAGENS
    const imgTags = document.querySelectorAll("img");
    imgTags.forEach((img, idx) => {
      let src = img.currentSrc || img.src;
      if (!src || src.startsWith("data:") || seenUrls.has(src)) return;

      const rect = img.getBoundingClientRect();
      const naturalW = img.naturalWidth || rect.width || 0;
      const naturalH = img.naturalHeight || rect.height || 0;

      // Filtrar ícones pequenos (< 120px)
      if (naturalW >= 120 && naturalH >= 120) {
        seenUrls.add(src);
        imageList.push({
          id: `img_${idx}`,
          url: src,
          type: "image",
          ext: src.split("?")[0].split(".").pop() || "jpg",
          width: naturalW,
          height: naturalH,
          alt: img.alt || `Imagem ${idx + 1}`
        });
      }
    });

    return {
      title: pageTitle,
      url: window.location.href,
      videos: videoList,
      images: imageList,
      hls: hlsList
    };
  }

  // Gravação de tela / Player de Vídeo em tempo real com validação de faixas
  async function startRecording(videoIndex = 0) {
    const videos = document.querySelectorAll("video");
    const targetVideo = videos[videoIndex] || videos[0];
    if (!targetVideo) {
      alert("Nenhum player de vídeo encontrado na página.");
      return;
    }

    try {
      // Se o vídeo estiver pausado, tentar dar play para inicializar faixas de áudio e vídeo
      if (targetVideo.paused) {
        try {
          await targetVideo.play();
        } catch (e) {
          try {
            targetVideo.muted = true;
            await targetVideo.play();
          } catch (err) {}
        }
      }

      universalStream = targetVideo.captureStream ? targetVideo.captureStream(30) : (targetVideo.mozCaptureStream ? targetVideo.mozCaptureStream(30) : null);
      if (!universalStream) {
        alert("Seu navegador não suporta captura direta deste player.");
        return;
      }

      // Aguardar faixas estarem disponíveis se o vídeo estiver carregando
      let videoTracks = universalStream.getVideoTracks();
      if (!videoTracks || videoTracks.length === 0) {
        let attempts = 15;
        while (attempts > 0 && (!videoTracks || videoTracks.length === 0)) {
          await new Promise(r => setTimeout(r, 200));
          videoTracks = universalStream.getVideoTracks();
          attempts--;
        }
      }

      if (!videoTracks || videoTracks.length === 0) {
        alert("Dê play no vídeo da página antes de iniciar a gravação para que as faixas de vídeo sejam carregadas.");
        return;
      }

      universalChunks = [];

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : (MediaRecorder.isTypeSupported("video/mp4") ? "video/mp4" : "video/webm");

      try {
        universalRecorder = new MediaRecorder(universalStream, { mimeType });
      } catch (recInitErr) {
        alert("Não foi possível inicializar o gravador: " + recInitErr.message + "\nDica: Dê play no vídeo na página primeiro.");
        return;
      }

      universalRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          universalChunks.push(e.data);
        }
      };

      universalRecorder.onstop = () => {
        const blob = new Blob(universalChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const title = document.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "Gravacao";
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";

        const a = document.createElement("a");
        a.href = url;
        a.download = `${title}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 15000);
        removeRecOverlay();
      };

      try {
        universalRecorder.start(1000);
      } catch (startErr) {
        alert("Não foi possível iniciar a gravação: " + startErr.message + "\nDica: Dê play no vídeo primeiro.");
        return;
      }
      showRecOverlay(targetVideo);
    } catch (e) {
      alert("Não foi possível iniciar a gravação do player: " + e.message + "\nDica: Dê play no vídeo na página primeiro.");
    }
  }

  function stopRecording() {
    if (universalRecorder && universalRecorder.state !== "inactive") {
      universalRecorder.stop();
    }
    if (universalStream) {
      universalStream.getTracks().forEach(t => t.stop());
    }
  }

  function showRecOverlay(targetVideo) {
    removeRecOverlay();
    const overlay = document.createElement("div");
    overlay.id = "snaptudo-universal-rec";
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999999;
      background: rgba(15, 16, 21, 0.9);
      border: 1px solid #ff3b5c;
      color: #ffffff;
      padding: 8px 16px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: sans-serif;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    `;

    let s = 0;
    overlay.innerHTML = `
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ff3b5c;"></span>
      <span>Gravando Stream: <strong id="snaptudo-u-time">00:00</strong></span>
      <button id="snaptudo-u-stop" style="background:#ff3b5c;border:none;color:#fff;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;cursor:pointer;">Parar e Salvar</button>
    `;

    document.body.appendChild(overlay);

    recTimer = setInterval(() => {
      s++;
      const min = String(Math.floor(s / 60)).padStart(2, "0");
      const sec = String(s % 60).padStart(2, "0");
      const timeElem = document.getElementById("snaptudo-u-time");
      if (timeElem) timeElem.textContent = `${min}:${sec}`;
    }, 1000);

    document.getElementById("snaptudo-u-stop").onclick = stopRecording;
  }

  function removeRecOverlay() {
    clearInterval(recTimer);
    const ov = document.getElementById("snaptudo-universal-rec");
    if (ov) ov.remove();
  }

  // Ouvinte de mensagens do popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scanPageMedia") {
      const data = scanMedia();
      sendResponse(data);
      return true;
    }
    if (request.action === "startRecording") {
      startRecording(request.videoIndex || 0);
      sendResponse({ ok: true });
      return true;
    }
    if (request.action === "stopRecording") {
      stopRecording();
      sendResponse({ ok: true });
      return true;
    }
  });
})();
