/**
 * SnapTudo - Facebook Video Downloader Content Script
 * Inspirado no Getfvid: detecta vídeos em HD e SD no Facebook (Feed, Reels, Watch),
 * injeta botões de download direto e gravação de lives.
 */

(() => {
  if (window.__SNAPTUDO_FB_INJECTED__) return;
  window.__SNAPTUDO_FB_INJECTED__ = true;

  console.info("[SnapTudo] Facebook Video Downloader ativo 🌶️");

  // Localizar URLs HD e SD de um elemento de vídeo
  function findFbVideoUrls(videoElem) {
    let hdUrl = null;
    let sdUrl = null;

    if (videoElem.currentSrc && !videoElem.currentSrc.startsWith("blob:")) {
      sdUrl = videoElem.currentSrc;
    }

    // Inspecionar React Props
    let curr = videoElem;
    let depth = 0;
    while (curr && depth < 8) {
      const keys = Object.keys(curr);
      for (const k of keys) {
        if (k.startsWith("__reactProps$")) {
          const props = curr[k];
          if (props?.children?.props?.videoData) {
            hdUrl = props.children.props.videoData.hd_src || props.children.props.videoData.hdSrc;
            sdUrl = props.children.props.videoData.sd_src || props.children.props.videoData.sdSrc || sdUrl;
          }
          if (props?.videoData) {
            hdUrl = props.videoData.hd_src || props.videoData.hdSrc;
            sdUrl = props.videoData.sd_src || props.videoData.sdSrc || sdUrl;
          }
        }
      }
      curr = curr.parentElement;
      depth++;
    }

    return {
      hd: hdUrl,
      sd: sdUrl || hdUrl
    };
  }

  // Injetar botões nos containers de vídeo do Facebook
  function injectFacebookButtons() {
    const videos = document.querySelectorAll("video");
    videos.forEach((video, idx) => {
      // Ignorar vídeos minúsculos
      const rect = video.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 150) return;

      const container = video.closest("div[role='article'], div[data-pagelet], .x1y1aw1k") || video.parentElement;
      if (!container || container.querySelector(".snaptudo-fb-bar")) return;

      const bar = document.createElement("div");
      bar.className = "snaptudo-fb-bar";
      bar.style.cssText = `
        position: absolute;
        bottom: 12px;
        right: 12px;
        z-index: 999;
        display: flex;
        gap: 6px;
        background: rgba(15, 16, 21, 0.85);
        padding: 4px 8px;
        border-radius: 8px;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      `;

      const createBtn = (label, isAccent = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText = `
          background: ${isAccent ? "#ff3b5c" : "rgba(255,255,255,0.15)"};
          color: #ffffff;
          border: none;
          padding: 4px 10px;
          border-radius: 6px;
          font-family: sans-serif;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.15s ease;
        `;
        b.onmouseenter = () => b.style.transform = "scale(1.06)";
        b.onmouseleave = () => b.style.transform = "scale(1)";
        return b;
      };

      const btnHd = createBtn("🌶️ Baixar HD", true);
      btnHd.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const urls = findFbVideoUrls(video);
        const target = urls.hd || urls.sd;
        if (target) {
          chrome.runtime.sendMessage({
            action: "downloadUrl",
            url: target,
            filename: `video_facebook_${Date.now()}.mp4`
          });
        } else {
          alert("Vídeo em formato de transmissão direta. Use o botão REC no popup para gravar.");
        }
      };

      bar.appendChild(btnHd);

      // Posicionar container relativamente para ancoragem
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }
      container.appendChild(bar);
    });
  }

  const observer = new MutationObserver(injectFacebookButtons);
  observer.observe(document.body, { childList: true, subtree: true });
  injectFacebookButtons();
})();

