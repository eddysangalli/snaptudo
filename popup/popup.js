/**
 * SnapTudo - Popup Script 🌶️
 * Gerencia Instagram (Post do Feed & Download de Perfil Completo com Filtros),
 * YouTube, HLS (M3U8) Downloader e Sniffer Universal de Mídias.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const sectionInsta = document.getElementById("section-instagram");
  const sectionYt = document.getElementById("section-youtube");
  const sectionUniv = document.getElementById("section-universal");
  const footerStatus = document.getElementById("footer-status");
  let latestCapturedStreams = [];

  // Inicializar verificação de receitas e atualizações
  initUpdateChecker();

  // Buscar aba ativa
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    footerStatus.textContent = "Aba indisponível";
    return;
  }

  const isInstagram = tab.url.includes("instagram.com");
  const isYouTube = tab.url.includes("youtube.com");

  if (isInstagram) {
    setupInstagramMode(tab);
  } else if (isYouTube) {
    setupYouTubeMode(tab);
  } else {
    setupUniversalMode(tab);
  }

  // ==========================================
  // --- MODO INSTAGRAM (FEED & PERFIL) ---
  // ==========================================
  function setupInstagramMode(activeTab) {
    sectionInsta.classList.remove("hidden");
    sectionYt.classList.add("hidden");
    sectionUniv.classList.add("hidden");
    footerStatus.textContent = "Instagram Conectado";

    // Controles de Alternância de Abas Instagram
    const tabPostBtn = document.getElementById("tab-insta-post");
    const tabProfileBtn = document.getElementById("tab-insta-profile");
    const viewPost = document.getElementById("insta-view-post");
    const viewProfile = document.getElementById("insta-view-profile");

    // Elementos da Aba Post do Feed
    const userElem = document.getElementById("insta-username");
    const captionElem = document.getElementById("insta-caption");
    const btnSingle = document.getElementById("btn-insta-download-single");
    const btnZip = document.getElementById("btn-insta-download-zip");
    const btnCopy = document.getElementById("btn-insta-copy-caption");

    // Elementos da Aba Perfil Completo
    const profileAvatar = document.getElementById("profile-avatar");
    const profileUser = document.getElementById("profile-username");
    const profileCount = document.getElementById("profile-post-count");
    const btnDownloadProfile = document.getElementById("btn-download-profile-zip");
    const profileBtnText = document.getElementById("profile-btn-text");
    const profileProgressBox = document.getElementById("profile-progress-box");
    const profileBarFill = document.getElementById("profile-bar-fill");
    const profileProgressText = document.getElementById("profile-progress-text");
    const profileProgressPct = document.getElementById("profile-progress-pct");

    let currentPostData = null;
    let selectedType = "all";
    let selectedLimit = "all";
    let detectedProfileUsername = "";

    function switchInstaTab(mode) {
      if (mode === "profile") {
        tabProfileBtn.classList.add("active");
        tabPostBtn.classList.remove("active");
        viewProfile.classList.remove("hidden");
        viewPost.classList.add("hidden");
        refreshProfileDetection();
      } else {
        tabPostBtn.classList.add("active");
        tabProfileBtn.classList.remove("active");
        viewPost.classList.remove("hidden");
        viewProfile.classList.add("hidden");
      }
    }

    tabPostBtn.addEventListener("click", () => switchInstaTab("post"));
    tabProfileBtn.addEventListener("click", () => switchInstaTab("profile"));

    // Garantir que os scripts do Instagram estejam ativos na aba
    async function ensureInstagramReady(tabId) {
      return new Promise((resolve) => {
        try {
          chrome.tabs.sendMessage(tabId, { action: "ping" }, (res) => {
            const err = chrome.runtime.lastError;
            if (err || !res?.alive) {
              chrome.scripting.executeScript({
                target: { tabId },
                files: ["lib/jszip.min.js", "content/instagram.js"]
              }, () => {
                const injectErr = chrome.runtime.lastError;
                setTimeout(() => resolve(!injectErr), 150);
              });
            } else {
              resolve(true);
            }
          });
        } catch (e) {
          resolve(false);
        }
      });
    }

    // Atualizar UI de Perfil
    function updateProfileUI(username, postCount, avatar) {
      if (username) {
        profileUser.textContent = `@${username}`;
        profileBtnText.textContent = `📦 Baixar Mídias de @${username} (.ZIP)`;
        btnDownloadProfile.disabled = false;
      }
      if (postCount !== undefined) {
        profileCount.textContent = `${postCount} publicações carregadas na tela`;
      }
      if (avatar && profileAvatar) {
        profileAvatar.src = avatar;
      }
    }

    // Detecção ativa e profunda do perfil na aba ativa
    async function refreshProfileDetection() {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const pathParts = window.location.pathname.split("/").filter(Boolean);
            const reserved = [
              "p", "reel", "reels", "stories", "explore", "direct", "accounts",
              "emails", "your_activity", "login", "create", "settings"
            ];

            let user = "";
            if (pathParts.length >= 1 && !reserved.includes(pathParts[0])) {
              user = pathParts[0];
            }

            if (!user) {
              const tm = document.title.match(/\(@([a-zA-Z0-9_.]+)\)/);
              if (tm && tm[1]) user = tm[1];
            }

            if (!user) {
              const metaIos = document.querySelector('meta[property="al:ios:url"]')?.getAttribute("content");
              const mMatch = metaIos?.match(/username=([a-zA-Z0-9_.]+)/);
              if (mMatch && mMatch[1]) user = mMatch[1];
            }

            if (!user) {
              const h = document.querySelector('header section h2, header h2, header h1, [role="main"] header h2');
              if (h && h.textContent.trim().length > 1) user = h.textContent.trim();
            }

            const avatarImg = document.querySelector('header img[alt*="perfil" i], header img[alt*="profile" i], header img[src], [role="main"] header img, img[data-testid="user-avatar"]');

            const postLinks = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]'))
              .filter(a => !a.closest("nav, aside, [role='navigation']"));
            const seen = new Set();
            postLinks.forEach(a => {
              const m = a.getAttribute("href")?.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
              if (m && m[1]) seen.add(m[1]);
            });

            return {
              username: user || "",
              avatar: avatarImg?.src || "",
              postCount: seen.size
            };
          }
        });

        const res = results?.[0]?.result;
        if (res && res.username) {
          detectedProfileUsername = res.username;
          updateProfileUI(res.username, res.postCount, res.avatar);
        } else if (!detectedProfileUsername) {
          profileUser.textContent = "Nenhum perfil detectado";
          profileCount.textContent = "Abra um perfil no Instagram para baixar em lote";
          profileBtnText.textContent = "📦 Baixar Perfil Completo (.ZIP)";
          btnDownloadProfile.disabled = true;
        }
      } catch (e) {}
    }

    // Chips de Seleção de Tipo (Ambos, Só Fotos, Só Vídeos)
    const typeChips = document.querySelectorAll("#filter-type-chips .chip");
    typeChips.forEach(chip => {
      chip.addEventListener("click", () => {
        typeChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        selectedType = chip.getAttribute("data-type");
      });
    });

    // Chips de Seleção de Limite (12, 24, Todos)
    const limitChips = document.querySelectorAll("#filter-limit-chips .chip");
    limitChips.forEach(chip => {
      chip.addEventListener("click", () => {
        limitChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        selectedLimit = chip.getAttribute("data-limit");
      });
    });

    // Pré-detecção rápida a partir da URL
    try {
      const u = new URL(activeTab.url);
      const parts = u.pathname.split("/").filter(Boolean);
      const reserved = ["p", "reel", "reels", "stories", "explore", "direct", "accounts", "emails", "your_activity", "login", "create", "settings"];
      if (parts.length >= 1 && !reserved.includes(parts[0])) {
        detectedProfileUsername = parts[0];
        updateProfileUI(detectedProfileUsername, 0);
        switchInstaTab("profile");
      }
    } catch (e) {}

    // Iniciar conexão com a aba e sincronizar contexto
    ensureInstagramReady(activeTab.id).then(() => {
      chrome.tabs.sendMessage(activeTab.id, { action: "getInstagramPageContext" }, (resp) => {
        if (!chrome.runtime.lastError && resp?.ok) {
          currentPostData = resp;
          if (resp.pageType === "profile") {
            switchInstaTab("profile");
            detectedProfileUsername = resp.username;
            updateProfileUI(resp.username, resp.postCount, resp.avatar);
          } else {
            if (!detectedProfileUsername) switchInstaTab("post");
            userElem.textContent = `@${resp.username || "instagram"}`;
            captionElem.textContent = resp.caption || "(Publicação sem texto na legenda)";
          }
        } else {
          refreshProfileDetection();
        }
      });
    });

    // Ações do Post do Feed
    btnSingle.addEventListener("click", () => {
      chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const btn = document.querySelector(".snaptudo-btn[title*='Baixar Mídia Atual']");
          if (btn) btn.click();
          else alert("Navegue até o post desejado no feed e clique no botão de download.");
        }
      });
      window.close();
    });

    btnZip.addEventListener("click", () => {
      chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const btn = document.querySelector(".snaptudo-btn-zip");
          if (btn) btn.click();
          else alert("Clique no botão [ ZIP ] abaixo da publicação no seu feed.");
        }
      });
      window.close();
    });

    btnCopy.addEventListener("click", () => {
      if (currentPostData?.caption) {
        navigator.clipboard.writeText(currentPostData.caption).then(() => {
          btnCopy.textContent = "✓ Legenda Copiada!";
          setTimeout(() => btnCopy.textContent = "Copiar Legenda Completa", 2000);
        });
      } else {
        alert("Nenhuma legenda encontrada nesta publicação.");
      }
    });

    // Ação: Baixar Perfil Completo com Filtros
    btnDownloadProfile.addEventListener("click", async () => {
      profileProgressBox.classList.remove("hidden");
      btnDownloadProfile.disabled = true;
      profileBtnText.textContent = "Iniciando download...";
      profileBarFill.style.width = "10%";
      profileProgressPct.textContent = "10%";
      profileProgressText.textContent = "Conectando ao perfil...";

      await ensureInstagramReady(activeTab.id);

      function handleProgress(msg) {
        if (!msg) return;

        if (msg.percent !== undefined) {
          profileBarFill.style.width = `${msg.percent}%`;
          profileProgressPct.textContent = `${msg.percent}%`;
        }
        if (msg.text) {
          profileProgressText.textContent = msg.text;
        }

        if (msg.done) {
          btnDownloadProfile.disabled = false;
          profileBtnText.textContent = "✓ Download Concluído!";
          profileBarFill.style.width = "100%";
          profileProgressPct.textContent = "100%";
          setTimeout(() => {
            profileBtnText.textContent = `📦 Baixar Mídias de @${detectedProfileUsername || "perfil"} (.ZIP)`;
            profileProgressBox.classList.add("hidden");
          }, 4000);
          if (port) {
            try { port.disconnect(); } catch (e) {}
            port = null;
          }
        }

        if (msg.error) {
          btnDownloadProfile.disabled = false;
          profileBtnText.textContent = "Tentar Novamente";
          profileProgressText.textContent = msg.error;
          if (port) {
            try { port.disconnect(); } catch (e) {}
            port = null;
          }
        }
      }

      // Conexão direta dedicada (Port)
      let port = null;
      try {
        port = chrome.tabs.connect(activeTab.id, { name: "snaptudo-profile-download" });
        port.onMessage.addListener(handleProgress);
        port.onDisconnect.addListener(() => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            console.debug("[SnapTudo] Port desconectada:", lastErr.message);
          }
          port = null;
        });
        port.postMessage({
          action: "startDownloadProfile",
          options: {
            filter: selectedType,
            limit: selectedLimit
          }
        });
      } catch (err) {
        // Fallback por sendMessage caso a porta não conecte
        chrome.tabs.sendMessage(activeTab.id, {
          action: "startDownloadProfile",
          options: {
            filter: selectedType,
            limit: selectedLimit
          }
        }, (res) => {
          const sendErr = chrome.runtime.lastError;
          if (sendErr) {
            handleProgress({ error: "Atualize a página do perfil (F5) e tente novamente." });
          }
        });
      }

      // Ouvir também broadcast via runtime.onMessage
      chrome.runtime.onMessage.addListener(handleProgress);
    });
  }

  // ==========================================
  // --- MODO YOUTUBE ---
  // ==========================================
  function setupYouTubeMode(activeTab) {
    sectionInsta.classList.add("hidden");
    sectionYt.classList.remove("hidden");
    sectionUniv.classList.add("hidden");
    footerStatus.textContent = "YouTube Ativo";

    const titleElem = document.getElementById("yt-title");
    const channelElem = document.getElementById("yt-channel");
    const btn720 = document.getElementById("btn-yt-720p");
    const btn360 = document.getElementById("btn-yt-360p");
    const btnAudio = document.getElementById("btn-yt-audio");
    const btnRec = document.getElementById("btn-yt-rec");
    const sidecarStatus = document.getElementById("yt-sidecar-status");
    const ytCapturedBox = document.getElementById("yt-captured-box");
    const ytNetworkList = document.getElementById("yt-network-list");

    // Obter URL limpa do vídeo do YouTube
    let fullYtUrl = activeTab.url;
    if (fullYtUrl.includes("/shorts/")) {
      const sId = fullYtUrl.split("/shorts/")[1]?.split(/[?#&]/)[0];
      if (sId) fullYtUrl = `https://www.youtube.com/watch?v=${sId}`;
    }

    chrome.tabs.sendMessage(activeTab.id, { action: "getYouTubeInfo" }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok || !resp.data) {
        titleElem.textContent = (activeTab.title || "Vídeo do YouTube").replace(" - YouTube", "").trim();
        channelElem.textContent = "Selecione a opção de download desejada.";
        return;
      }
      const ytData = resp.data;
      if (ytData.videoId) fullYtUrl = `https://www.youtube.com/watch?v=${ytData.videoId}`;
      titleElem.textContent = ytData.title || (activeTab.title || "Vídeo do YouTube").replace(" - YouTube", "").trim();
      channelElem.textContent = ytData.channel ? `Canal: ${ytData.channel}` : "";
    });

    chrome.runtime.sendMessage({ action: "getYtDlpStatus" }, (status) => {
      if (chrome.runtime.lastError || !status?.available) {
        sidecarStatus.textContent = "⚠️ Sidecar yt-dlp não instalado. Use o pacote da Release ou o Cobalt.";
        sidecarStatus.style.color = "#fbbf24";
        return;
      }
      const ffmpeg = status.ffmpegFound ? "FFmpeg ativo: vídeo + áudio até 1080p" : "sem FFmpeg: formato combinado até 720p";
      sidecarStatus.textContent = `✓ yt-dlp ${status.ytDlpVersion || "ativo"} · ${ffmpeg}`;
      sidecarStatus.style.color = "#86efac";
    });

    function startYtDlpDownload(mode, button) {
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = mode === "audio" ? "🎵 Iniciando áudio..." : "📥 Iniciando vídeo...";
      chrome.runtime.sendMessage({ action: "startYtDlpDownload", mode, url: fullYtUrl }, (response) => {
        button.disabled = false;
        button.textContent = originalText;
        if (chrome.runtime.lastError || !response?.success) {
          sidecarStatus.textContent = `⚠️ ${response?.error || "Sidecar yt-dlp indisponível."}`;
          sidecarStatus.style.color = "#fbbf24";
          if (response?.sidecarMissing) {
            chrome.tabs.create({ url: "https://github.com/eddysangalli/snaptudo/releases/latest" });
          }
          return;
        }
        sidecarStatus.textContent = `✓ Download iniciado pelo yt-dlp em ${response.downloadDir}`;
        sidecarStatus.style.color = "#86efac";
        footerStatus.textContent = "yt-dlp em execução";
      });
    }

    // 1. Download local pelo sidecar yt-dlp
    btn720.addEventListener("click", () => startYtDlpDownload("video", btn720));
    btnAudio.addEventListener("click", () => startYtDlpDownload("audio", btnAudio));

    // 2. Alternativa web pelo Cobalt
    btn360.addEventListener("click", () => {
      navigator.clipboard.writeText(fullYtUrl).catch(() => {});
      chrome.tabs.create({ url: `https://cobalt.tools/#${fullYtUrl}` });
      window.close();
    });

    // 3. Gravar Player ao Vivo
    btnRec.addEventListener("click", () => {
      chrome.tabs.sendMessage(activeTab.id, { action: "startYouTubeLiveRecord" }, () => {
        window.close();
      });
    });

    // 4. Status de fluxos do player
    chrome.runtime.sendMessage({ action: "getNetworkStreams", tabId: activeTab.id }, (resp) => {
      if (resp?.streams && resp.streams.length > 0) {
        const videoStreams = resp.streams.filter(s => s.url.includes("googlevideo.com/videoplayback"));
        if (videoStreams.length > 0 && ytCapturedBox && ytNetworkList) {
          ytCapturedBox.classList.remove("hidden");
          ytNetworkList.innerHTML = `
            <div style="font-size: 11px; color: #a1a1aa; padding: 6px 0; line-height: 1.4;">
              ✨ ${videoStreams.length} faixas detectadas. Use os botões acima (Cobalt HD ou Gravar) para download instantâneo do vídeo e áudio sincronizados.
            </div>
          `;
        }
      }
    });
  }

  // ==========================================
  // --- MODO UNIVERSAL (OUTROS SITES) ---
  // ==========================================
  function setupUniversalMode(activeTab) {
    sectionInsta.classList.add("hidden");
    sectionYt.classList.add("hidden");
    sectionUniv.classList.remove("hidden");
    footerStatus.textContent = "Sniffer Universal Ativo";

    const tabBtns = document.querySelectorAll(".tab-nav .tab-btn");
    const tabPanes = document.querySelectorAll(".tab-pane");

    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        tabBtns.forEach(b => b.classList.remove("active"));
        tabPanes.forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        const targetId = btn.getAttribute("data-tab");
        document.getElementById(targetId)?.classList.add("active");
      });
    });

    const btnUnivRec = document.getElementById("btn-universal-record");
    btnUnivRec.addEventListener("click", () => {
      chrome.tabs.sendMessage(activeTab.id, { action: "startRecording" }, () => {
        window.close();
      });
    });

    let latestCapturedStreams = [];
    let cachedScannedData = null;

    chrome.tabs.sendMessage(activeTab.id, { action: "scanPageMedia" }, (data) => {
      if (chrome.runtime.lastError || !data) {
        return;
      }
      cachedScannedData = data;
      renderUniversalMedia(data, activeTab, latestCapturedStreams);
    });

    chrome.runtime.sendMessage({ action: "getNetworkStreams", tabId: activeTab.id }, (resp) => {
      if (resp?.streams && resp.streams.length > 0) {
        latestCapturedStreams = resp.streams;
        renderNetworkStreams(resp.streams);

        // Se já tiver dados do scanner, re-renderizar para atualizar botões para "Baixar HD (HLS)"
        if (cachedScannedData) {
          renderUniversalMedia(cachedScannedData, activeTab, latestCapturedStreams);
        }

        // Se houver fluxo HLS (como no GE Globo/G1), mudar automaticamente para a aba de HLS/Fluxos
        const hasHls = resp.streams.some(s => s.url.includes(".m3u8"));
        if (hasHls) {
          const tabNetworkBtn = document.querySelector(".tab-btn[data-tab='tab-network']");
          if (tabNetworkBtn && !tabNetworkBtn.classList.contains("active")) {
            tabNetworkBtn.click();
          }
        }
      }
    });
  }

  // Gerar nome de arquivo amigável baseado na manchete da aba (sem marca d'água)
  function getPageHeadlineFilename(tabTitle, fallback, ext) {
    let title = (tabTitle || "")
      .replace(/\s*[-|•–—]\s*(YouTube|Instagram|G1|GE|Globo|Globoplay|Twitter|X|Facebook).*$/i, "")
      .replace(/[\\/:*?"<>|!.,;()+=~`[\]{}]/g, " ")
      .trim()
      .replace(/\s+/g, "_");
    if (title.length > 60) title = title.substring(0, 60).replace(/_+$/, "");
    const base = (title && title.length >= 3) ? title : (fallback || `midia_${Date.now()}`).replace(/[\\/:*?"<>|]/g, "_");
    return ext ? `${base}.${ext}` : base;
  }

  // Função unificada para download de fluxos HLS com barra de progresso
  async function triggerHlsDownload(streamUrl, headline, triggerBtn) {
    const progressBox = document.getElementById("hls-progress-box");
    const barFill = document.getElementById("hls-bar-fill");
    const progressText = document.getElementById("hls-progress-text");
    const progressPct = document.getElementById("hls-progress-pct");

    progressBox.classList.remove("hidden");
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = "Baixando...";
    }

    try {
      const downloader = new SnapTudoHlsDownloader({ concurrency: 5 });
      const blob = await downloader.downloadStream(streamUrl, (p) => {
        barFill.style.width = `${p.percent}%`;
        progressPct.textContent = `${p.percent}%`;
        progressText.textContent = `Segmento ${p.completed}/${p.total} (${p.elapsedSec}s)`;
      });

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${headline}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);

      progressText.textContent = "✓ Concluído com Sucesso!";
      barFill.style.width = "100%";
      setTimeout(() => {
        progressBox.classList.add("hidden");
      }, 3500);
    } catch (err) {
      alert("Erro no download HLS: " + err.message);
      progressBox.classList.add("hidden");
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = "Baixar HLS";
      }
    }
  }

  function renderUniversalMedia(data, activeTab) {
    const countVideos = document.getElementById("count-videos");
    const countImages = document.getElementById("count-images");
    const videosList = document.getElementById("videos-list");
    const imagesGrid = document.getElementById("images-grid");
    const btnZipAllImgs = document.getElementById("btn-download-all-images");

    const videos = data.videos || [];
    const images = data.images || [];

    countVideos.textContent = videos.length;
    countImages.textContent = images.length;

    if (videos.length > 0) {
      videosList.innerHTML = "";
      videos.forEach((v, idx) => {
        const item = document.createElement("div");
        item.className = "media-item";
        item.innerHTML = `
          <div class="media-info">
            <div class="media-title" title="${v.url}">${v.title || `Vídeo ${idx + 1}`}</div>
            <div class="media-meta">${v.ext.toUpperCase()} • ${v.width ? `${v.width}x${v.height} px` : "HTML5"}</div>
          </div>
          <div class="media-actions">
            <button class="btn btn-sm btn-primary btn-copy" title="Copiar Link">📋</button>
            <button class="btn btn-sm btn-accent btn-download">Baixar</button>
          </div>
        `;

        item.querySelector(".btn-copy").onclick = () => {
          navigator.clipboard.writeText(v.url);
          alert("Link copiado!");
        };

        const dlBtn = item.querySelector(".btn-download");
        const isBlob = !!v.isBlob;

        // Se for blob e já detectamos HLS na aba (como no Globo/GE), estilizar botão para download direto
        if (isBlob) {
          const hasHlsStream = latestCapturedStreams.some(s => s.url.includes(".m3u8"));
          if (hasHlsStream) {
            dlBtn.textContent = "Baixar HD (HLS)";
          }
        }

        dlBtn.onclick = () => {
          if (isBlob) {
            // Verificar streams mais recentes da aba ativa antes de decidir entre HLS ou Gravação
            chrome.runtime.sendMessage({ action: "getNetworkStreams", tabId: activeTab.id }, (resp) => {
              const streams = (resp?.streams && resp.streams.length > 0) ? resp.streams : latestCapturedStreams;
              const hlsStream = streams.find(s => s.url.includes(".m3u8"));
              if (hlsStream) {
                const tabNetworkBtn = document.querySelector(".tab-btn[data-tab='tab-network']");
                if (tabNetworkBtn) tabNetworkBtn.click();
                const headline = getPageHeadlineFilename(activeTab.title, `video_${idx + 1}`);
                triggerHlsDownload(hlsStream.url, headline, dlBtn);
                return;
              }

              // Se não houver HLS disponível, acionar o gravador direto com overlay
              chrome.tabs.sendMessage(activeTab.id, { action: "startRecording", videoIndex: idx }, () => {
                window.close();
              });
            });
          } else {
            const fileName = getPageHeadlineFilename(activeTab.title, `video_${idx + 1}`, v.ext);
            chrome.runtime.sendMessage({
              action: "downloadUrl",
              url: v.url,
              filename: fileName
            });
          }
        };

        videosList.appendChild(item);
      });
    }

    if (images.length > 0) {
      imagesGrid.innerHTML = "";
      images.forEach((img, idx) => {
        const card = document.createElement("div");
        card.className = "image-card";
        card.innerHTML = `
          <img src="${img.url}" alt="${img.alt}" loading="lazy" />
          <div class="image-card-overlay">
            <button class="btn btn-sm btn-accent">Baixar</button>
          </div>
        `;
        card.querySelector("button").onclick = () => {
          const fileName = getPageHeadlineFilename(activeTab.title, `imagem_${idx + 1}`, img.ext);
          chrome.runtime.sendMessage({
            action: "downloadUrl",
            url: img.url,
            filename: fileName
          });
        };
        imagesGrid.appendChild(card);
      });

      btnZipAllImgs.onclick = async () => {
        btnZipAllImgs.textContent = "Compactando...";
        btnZipAllImgs.disabled = true;

        try {
          const zip = new JSZip();
          const fetchPromises = images.map(async (img, idx) => {
            try {
              const resp = await fetch(img.url);
              const blob = await resp.blob();
              zip.file(`imagem_${String(idx + 1).padStart(3, "0")}.${img.ext}`, blob);
            } catch (e) {}
          });

          await Promise.all(fetchPromises);
          const zipBlob = await zip.generateAsync({ type: "blob" });
          const blobUrl = URL.createObjectURL(zipBlob);

          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = getPageHeadlineFilename(activeTab.title, `imagens_${Date.now()}`, "zip");
          a.click();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        } catch (err) {
          alert("Erro ao empacotar ZIP de imagens: " + err.message);
        } finally {
          btnZipAllImgs.textContent = "Baixar Todas em ZIP";
          btnZipAllImgs.disabled = false;
        }
      };
    }
  }

  function renderNetworkStreams(rawStreams) {
    const countNetwork = document.getElementById("count-network");
    const networkList = document.getElementById("network-list");

    // 1. Filtrar fragmentos, pedaços de áudio/vídeo e chunks temporários
    const validStreams = (rawStreams || []).filter(s => {
      const u = s.url.toLowerCase();
      if (u.includes(".ts") || u.includes(".m4s") || u.includes("init.mp4") || u.includes("map.mp4")) return false;
      if (/(audio_por|video_por)=[0-9]+/i.test(u)) return false;
      if (/[-_](seg|segment|frag|chunk|part)[-_0-9]/i.test(u)) return false;
      if (u.includes("cadmus.globo.com") || u.includes("ads.globo.com") || u.includes("doubleclick") || u.includes("telemetry") || u.includes("beacon")) return false;
      return true;
    });

    // 2. De-duplicar com precisão cirúrgica (ex: Globo, G1, GE) para colapsar múltiplas requisições em 1 única entrada master
    const groupedStreams = [];

    for (const s of validStreams) {
      const u = s.url;
      const globoMatch = u.match(/\/videos\/(\d+)/i) || u.match(/vod-playback.*?\/(\d+)/i);
      const genericId = u.match(/(\d{6,12})/) || u.match(/\/([a-zA-Z0-9_-]{10,})\//);

      const isMaster = u.includes("playlist.m3u8") || u.includes("master.m3u8");
      const isSubtrack = u.includes("/track/audio/") || u.includes("/track/subtitles/") || u.includes("/track/video_");

      const existingIdx = groupedStreams.findIndex(item => {
        const itemU = item.url;
        const itemGlobo = itemU.match(/\/videos\/(\d+)/i) || itemU.match(/vod-playback.*?\/(\d+)/i);
        if (globoMatch && itemGlobo) return globoMatch[1] === itemGlobo[1];
        if (genericId && itemU.includes(genericId[1])) return true;
        return itemU.split("?")[0] === u.split("?")[0];
      });

      if (existingIdx !== -1) {
        if (isMaster) {
          groupedStreams[existingIdx] = s;
        }
      } else {
        if (!isSubtrack || !validStreams.some(v => v.url.includes("playlist.m3u8"))) {
          if (groupedStreams.length < 12) {
            groupedStreams.push(s);
          }
        }
      }
    }

    countNetwork.textContent = groupedStreams.length;

    const progressBox = document.getElementById("hls-progress-box");
    const barFill = document.getElementById("hls-bar-fill");
    const progressText = document.getElementById("hls-progress-text");
    const progressPct = document.getElementById("hls-progress-pct");

    if (groupedStreams.length > 0) {
      networkList.innerHTML = "";
      groupedStreams.forEach((stream, idx) => {
        const isHls = stream.url.includes(".m3u8") || stream.url.includes(".mpd");
        const item = document.createElement("div");
        item.className = "media-item";
        const headline = getPageHeadlineFilename(activeTab.title, `video_${idx + 1}`);
        const displayTitle = groupedStreams.length === 1 ? `${headline} (Vídeo Completo HD)` : `${headline} - Fluxo ${idx + 1}`;
        const badgeLabel = isHls ? "HLS • MP4 HD" : "VÍDEO HD";
        const sizeMb = stream.size ? `${(stream.size / (1024 * 1024)).toFixed(1)} MB` : "HD";

        item.innerHTML = `
          <div class="media-info">
            <div class="media-title" title="${stream.url}">${displayTitle}</div>
            <div class="media-meta">
              <span class="badge-stream">${badgeLabel}</span>
              <span>${sizeMb}</span>
            </div>
          </div>
          <div class="media-actions">
            <button class="btn btn-sm btn-primary btn-copy" title="Copiar Link Direto">📋</button>
            <button class="btn btn-sm btn-accent btn-download">${isHls ? "Baixar HLS" : "Baixar"}</button>
          </div>
        `;

        item.querySelector(".btn-copy").onclick = () => {
          navigator.clipboard.writeText(stream.url);
          alert("Link copiado!");
        };

        const dlBtn = item.querySelector(".btn-download");
        dlBtn.onclick = async () => {
          if (isHls) {
            triggerHlsDownload(stream.url, headline, dlBtn);
          } else {
            chrome.runtime.sendMessage({
              action: "downloadUrl",
              url: stream.url,
              filename: `${headline}.mp4`
            });
          }
        };

        networkList.appendChild(item);
      });
    } else {
      networkList.innerHTML = `<div class="empty-state">Nenhum fluxo de vídeo capturado na rede ainda. Dê play no vídeo para farejar.</div>`;
    }
  }

  // ==========================================
  // --- GERENCIADOR DE ATUALIZAÇÕES & RECEITAS ---
  // ==========================================
  function initUpdateChecker() {
    const footerVer = document.getElementById("footer-version");
    const banner = document.getElementById("update-banner");
    const latestVerElem = document.getElementById("update-latest-version");
    const btnDownload = document.getElementById("btn-update-download");
    const recipesInfo = document.getElementById("update-recipes-info");
    const btnCheck = document.getElementById("btn-check-updates");

    const manifest = chrome.runtime.getManifest();
    if (footerVer) {
      footerVer.textContent = `SnapTudo 🌶️ v${manifest.version}`;
    }

    function applyUpdateUI(status) {
      if (!status) return;

      if (recipesInfo && status.recipesVersion) {
        recipesInfo.textContent = `Receitas: v${status.recipesVersion}`;
        recipesInfo.title = `Última sincronização: ${status.checkedAt ? new Date(status.checkedAt).toLocaleString() : "Agora"}`;
      }

      if (status.updateAvailable && status.latestVersion) {
        if (banner) banner.classList.remove("hidden");
        if (latestVerElem) latestVerElem.textContent = `v${status.latestVersion}`;
        if (btnDownload) {
          btnDownload.onclick = () => {
            const url = status.downloadUrl || status.releaseUrl || "https://github.com/eddysangalli/snaptudo/releases/latest";
            chrome.downloads.download({
              url,
              filename: `SnapTudo/snaptudo-v${status.latestVersion}.zip`,
              saveAs: true
            }, () => {
              if (chrome.runtime.lastError) {
                chrome.tabs.create({ url: status.releaseUrl || url });
              }
            });
          };
        }
      } else {
        if (banner) banner.classList.add("hidden");
      }
    }

    // Consulta inicial do status em cache
    try {
      chrome.runtime.sendMessage({ action: "getUpdateStatus" }, (response) => {
        if (!chrome.runtime.lastError && response?.success) {
          applyUpdateUI(response.status);
        }
      });
    } catch (e) {
      console.warn("[SnapTudo Popup] Erro ao obter status de atualização:", e);
    }

    // Botão de checagem manual
    if (btnCheck) {
      btnCheck.onclick = () => {
        btnCheck.disabled = true;
        const originalText = btnCheck.textContent;
        btnCheck.textContent = "↻ Verificando...";

        try {
          chrome.runtime.sendMessage({ action: "checkUpdatesNow" }, (res) => {
            btnCheck.disabled = false;
            if (chrome.runtime.lastError || !res || !res.success) {
              btnCheck.textContent = "⚠ Falha ao checar";
              setTimeout(() => { btnCheck.textContent = originalText; }, 2500);
              return;
            }

            applyUpdateUI(res.status);
            btnCheck.textContent = res.status.updateAvailable ? "🚀 Nova versão!" : "✓ Atualizado!";
            setTimeout(() => { btnCheck.textContent = originalText; }, 3000);
          });
        } catch (e) {
          btnCheck.disabled = false;
          btnCheck.textContent = originalText;
        }
      };
    }
  }
});
