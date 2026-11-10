/**
 * SnapTudo - Background Service Worker
 * Gerencia downloads, sniffing de mídias de rede e comunicação com tabs.
 */

// Canal de atualizações (receitas remotas + checagem de versão no GitHub)
importScripts("updater.js", "sidecar-compat.js");

const SNAPTUDO_YTDLP_HOST = "com.eddysangalli.snaptudo";
const YTDLP_JOB_STORAGE_KEY = "snaptudoYtDlpJob";
const YTDLP_MONITOR_ALARM = "snaptudo-ytdlp-monitor";

// Armazena mídias capturadas via rede por tabId
const tabMediaStreams = new Map();

// Extensões de mídia monitoradas
const MEDIA_EXTENSIONS = /\.(mp4|webm|m4v|mkv|mov|flv|mp3|m4a|aac|ogg|m3u8|mpd)(\?.*)?$/i;

// Domínios e padrões de publicidade, telemetria e rastreamento para ignorar
const AD_AND_TRACKING_PATTERNS = [
  "doubleclick.net", "googlesyndication.com", "google-analytics.com",
  "scorecardresearch.com", "adnxs.com", "adservice.google", "pagead",
  "amazon-adsystem.com", "pubmatic.com", "criteo.com", "adroll.com",
  "cadmus.globo.com", "ads.globo.com", "metrics", "analytics", "telemetry",
  "beacon", "segment-timeline", "ping", "stats", "taboola.com", "outbrain.com"
];

function isAdOrTracking(url) {
  const u = url.toLowerCase();
  // Padrões embutidos + padrões extras publicados na receita remota (GitHub)
  const remotePatterns = self.SnapTudoUpdater?.getCachedRecipes()?.sniffer?.adAndTrackingPatterns || [];
  for (const pat of AD_AND_TRACKING_PATTERNS.concat(remotePatterns)) {
    if (pat && u.includes(String(pat).toLowerCase())) return true;
  }
  return false;
}

function getMaxStreamsPerTab() {
  const n = self.SnapTudoUpdater?.getCachedRecipes()?.sniffer?.maxStreamsPerTab;
  return Number.isInteger(n) && n > 0 ? n : 15;
}

// Verificar se a URL é apenas um fragmento ou pedaço temporário de streaming
function isStreamingSegment(url) {
  const u = url.toLowerCase();
  if (u.includes(".ts") || u.includes(".m4s") || u.includes(".m4f") || u.includes(".mp4d")) return true;
  if (u.includes("init.mp4") || u.includes("/init-") || u.includes("-init.") || u.includes("map.mp4")) return true;
  if (/(audio_por|video_por)=[0-9]+/i.test(u)) return true;
  if (/[-_](seg|segment|frag|chunk|part)[-_0-9]/i.test(u)) return true;
  if (/[?&]range=[0-9]+-[0-9]+/i.test(u) && !u.includes(".m3u8") && !u.includes(".mpd")) return true;
  return false;
}

// Monitorar requisições de mídia HTTP
if (chrome.webRequest && chrome.webRequest.onResponseStarted) {
  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      if (details.tabId < 0 || details.method !== "GET") return;

      const url = details.url;
      // Ignorar fragmentos, chunks de streaming e anúncios para não poluir a lista (ex: Globo, HLS chunks)
      if (isStreamingSegment(url) || isAdOrTracking(url)) return;

      const isMediaExt = MEDIA_EXTENSIONS.test(url);
      let isMediaHeader = false;
      let contentLength = 0;

      if (details.responseHeaders) {
        for (const h of details.responseHeaders) {
          const name = h.name.toLowerCase();
          if (name === "content-type" && h.value) {
            const v = h.value.toLowerCase();
            if (v.includes("video/") || v.includes("audio/") || v.includes("mpegurl") || v.includes("dash+xml")) {
              isMediaHeader = true;
            }
          }
          if (name === "content-length" && h.value) {
            contentLength = parseInt(h.value, 10) || 0;
          }
        }
      }

      if (isMediaExt || isMediaHeader) {
        if (!tabMediaStreams.has(details.tabId)) {
          tabMediaStreams.set(details.tabId, []);
        }
        const list = tabMediaStreams.get(details.tabId);

        // De-duplicar streams pelo ID do vídeo (evitar múltiplos manifests do mesmo vídeo na Globo/HLS)
        const idMatch = url.match(/\/videos\/(\d{6,12})/i) || url.match(/(\d{6,12})/) || url.match(/\/([a-zA-Z0-9_-]{8,})\//);
        const streamId = idMatch ? idMatch[1] : url.split("?")[0];

        const isMaster = url.includes("playlist.m3u8") || url.includes("master.m3u8");
        const isSubtrack = url.includes("/track/audio/") || url.includes("/track/subtitles/") || url.includes("/track/video_");

        if (streamId) {
          const existingIdx = list.findIndex(item => item.url.includes(streamId) || item.url.split("?")[0] === url.split("?")[0]);

          if (existingIdx !== -1) {
            // Se já temos a master e o novo é sub-faixa, ignorar sub-faixa
            if (isSubtrack && list[existingIdx].url.includes("playlist.m3u8")) {
              return;
            }
            // Se o novo é a master e o existente era sub-faixa, substituir pela master
            if (isMaster) {
              list[existingIdx] = { url, size: contentLength, time: Date.now() };
            }
            return;
          }
        }

        // Se for sub-faixa de áudio/legenda e não temos nada, preferir aguardar a master playlist
        if (isSubtrack && !isMaster && list.some(item => item.url.includes("playlist.m3u8"))) {
          return;
        }

        if (!list.some(item => item.url.split("?")[0] === url.split("?")[0])) {
          if (list.length < getMaxStreamsPerTab()) {
            list.push({
              url,
              size: contentLength,
              time: Date.now()
            });

            // Atualizar badge da extensão com a quantidade de mídias limpas
            chrome.action.setBadgeText({
              tabId: details.tabId,
              text: String(list.length)
            });
            chrome.action.setBadgeBackgroundColor({
              tabId: details.tabId,
              color: "#ff3b5c"
            });
          }
        }
      }
    },
    { urls: ["<all_urls>"] },
    ["responseHeaders"]
  );
}

// Limpar memória ao fechar a aba
chrome.tabs.onRemoved.addListener((tabId) => {
  tabMediaStreams.delete(tabId);
});

// Limpar mídias de rede ao atualizar a aba
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabMediaStreams.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

// Sanitizar nomes de arquivo para Windows/Linux/Mac (remove marcas d'água SnapTudo_)
function sanitizeFilename(name) {
  let clean = (name || `midia_${Date.now()}`)
    .replace(/^SnapTudo[_\-\s]*/i, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  if (!clean) clean = `midia_${Date.now()}`;
  return clean;
}

function isAllowedYouTubeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
  } catch (e) {
    return false;
  }
}

function isYtDlpJobActive(job) {
  return ["queued", "starting", "downloading", "processing"].includes(job?.state);
}

function setYtDlpBadge(job, tabId) {
  let text = "";
  let color = "#71717a";
  let title = "SnapTudo - Baixador de Mídias";

  if (job?.state === "completed") {
    text = "✓";
    color = "#22c55e";
    title = "SnapTudo: download concluído";
  } else if (job?.state === "failed") {
    text = "!";
    color = "#ef4444";
    title = `SnapTudo: download falhou${job.error ? ` — ${job.error}` : ""}`;
  } else if (job?.state === "processing") {
    text = "…";
    color = "#f59e0b";
    title = "SnapTudo: finalizando vídeo e áudio";
  } else if (isYtDlpJobActive(job)) {
    const progress = Number(job.progress || 0);
    text = progress >= 1 ? String(Math.min(99, Math.round(progress))) : "↓";
    color = "#3b82f6";
    title = progress >= 1 ? `SnapTudo: baixando ${progress.toFixed(1)}%` : "SnapTudo: iniciando download";
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title });
  if (Number.isInteger(tabId) && tabId >= 0) {
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({ tabId, color });
    chrome.action.setTitle({ tabId, title });
  }
}

function scheduleYtDlpMonitor(delayMs = 3000) {
  chrome.alarms.create(YTDLP_MONITOR_ALARM, { when: Date.now() + Math.max(1000, delayMs) });
}

function queryYtDlpJob(jobId, callback) {
  chrome.runtime.sendNativeMessage(SNAPTUDO_YTDLP_HOST, {
    action: "getDownloadStatus",
    jobId: jobId || ""
  }, (response) => {
    const error = chrome.runtime.lastError;
    if (error) {
      callback({ success: false, error: error.message || "Falha ao consultar o sidecar." });
      return;
    }
    callback(response || { success: false, error: "O sidecar não respondeu." });
  });
}

function persistYtDlpJob(job, tabId) {
  if (!job) return;
  const value = { job, tabId: Number.isInteger(tabId) ? tabId : null };
  chrome.storage.local.set({ [YTDLP_JOB_STORAGE_KEY]: value });
  setYtDlpBadge(job, value.tabId);
  if (isYtDlpJobActive(job)) scheduleYtDlpMonitor();
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== YTDLP_MONITOR_ALARM) return;
  chrome.storage.local.get(YTDLP_JOB_STORAGE_KEY, (stored) => {
    const current = stored?.[YTDLP_JOB_STORAGE_KEY];
    if (!current?.job?.id || !isYtDlpJobActive(current.job)) return;
    queryYtDlpJob(current.job.id, (response) => {
      if (response?.success && response.job) {
        persistYtDlpJob(response.job, current.tabId);
      } else {
        scheduleYtDlpMonitor(5000);
      }
    });
  });
});

// Listener de mensagens
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  if (action === "downloadUrl") {
    const filename = sanitizeFilename(message.filename);
    chrome.downloads.download({
      url: message.url,
      filename,
      saveAs: false
    }, (downloadId) => {
      sendResponse({ success: !!downloadId, downloadId });
    });
    return true;
  }

  if (action === "getNetworkStreams") {
    const tabId = message.tabId || sender?.tab?.id;
    const streams = tabMediaStreams.get(tabId) || [];
    sendResponse({ streams });
    return true;
  }

  if (action === "getYtDlpStatus") {
    chrome.runtime.sendNativeMessage(SNAPTUDO_YTDLP_HOST, { action: "ping" }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        sendResponse({
          success: true,
          available: false,
          error: `Falha do Chrome ao abrir o sidecar: ${error.message || "erro desconhecido"}`
        });
        return;
      }
      const compatibility = self.SnapTudoSidecarCompat.evaluate(response?.version);
      sendResponse({
        ...response,
        success: true,
        available: response?.success === true,
        ...compatibility
      });
    });
    return true;
  }

  if (action === "startYtDlpDownload") {
    const mode = message.mode === "audio" ? "audio" : "video";
    if (!isAllowedYouTubeUrl(message.url)) {
      sendResponse({ success: false, error: "URL do YouTube inválida ou não permitida." });
      return false;
    }

    chrome.runtime.sendNativeMessage(SNAPTUDO_YTDLP_HOST, { action: "ping" }, (pingResponse) => {
      const error = chrome.runtime.lastError;
      if (error) {
        sendResponse({
          success: false,
          sidecarMissing: true,
          error: `Falha do Chrome ao abrir o sidecar: ${error.message || "erro desconhecido"}`
        });
        return;
      }
      if (!pingResponse?.success) {
        sendResponse(pingResponse || { success: false, error: "O sidecar não respondeu." });
        return;
      }
      const compatibility = self.SnapTudoSidecarCompat.evaluate(pingResponse.version);
      if (compatibility.needsUpdate) {
        sendResponse({
          success: false,
          sidecarOutdated: true,
          ...compatibility,
          error: `Sidecar ${compatibility.installedVersion} incompatível. Instale a versão ${compatibility.requiredVersion} ou superior.`
        });
        return;
      }

      chrome.runtime.sendNativeMessage(SNAPTUDO_YTDLP_HOST, {
        action: "startDownload",
        mode,
        url: message.url
      }, (response) => {
        const startError = chrome.runtime.lastError;
        if (startError) {
          sendResponse({
            success: false,
            sidecarMissing: true,
            error: `Falha do Chrome ao abrir o sidecar: ${startError.message || "erro desconhecido"}`
          });
          return;
        }
        const result = response || { success: false, error: "O sidecar não respondeu." };
        if (result.success && result.job) {
          persistYtDlpJob(result.job, Number.isInteger(message.tabId) ? message.tabId : null);
        }
        sendResponse(result);
      });
    });
    return true;
  }

  if (action === "getYtDlpDownloadStatus") {
    chrome.storage.local.get(YTDLP_JOB_STORAGE_KEY, (stored) => {
      const current = stored?.[YTDLP_JOB_STORAGE_KEY];
      const jobId = message.jobId || current?.job?.id || "";
      queryYtDlpJob(jobId, (response) => {
        if (response?.success && response.job) {
          persistYtDlpJob(response.job, current?.tabId);
          sendResponse(response);
          return;
        }
        if (current?.job) {
          sendResponse({ success: true, job: current.job, stale: true, error: response?.error });
          return;
        }
        sendResponse(response);
      });
    });
    return true;
  }

  if (action === "openYtDlpDownloadDir") {
    chrome.runtime.sendNativeMessage(SNAPTUDO_YTDLP_HOST, { action: "openDownloadDir" }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        sendResponse({ success: false, error: error.message || "Falha ao abrir a pasta." });
        return;
      }
      sendResponse(response || { success: false, error: "O sidecar não respondeu." });
    });
    return true;
  }

  // Obter a URL de vídeo mais recente capturada da aba atual
  if (action === "getLatestVideoForTab") {
    const tabId = sender?.tab?.id || message.tabId;
    const list = tabMediaStreams.get(tabId) || [];
    // Filtrar ESTRITAMENTE apenas vídeos reais (.mp4, .webm ou streams de vídeo)
    // NUNCA retornar imagens (.jpg, .png, thumbnails ou posters)
    const videoStreams = list.filter(item => {
      const u = item.url.toLowerCase();
      const isImage = u.includes(".jpg") || u.includes(".jpeg") || u.includes(".png") || u.includes("_thumbnail") || u.includes("video_first_frame");
      if (isImage) return false;
      return u.includes(".mp4") || u.includes(".webm") || u.includes("/o1/v/") || u.includes("/v/t16/");
    });

    if (videoStreams.length > 0) {
      sendResponse({ success: true, url: videoStreams[videoStreams.length - 1].url });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  // Fetch com permissão do background para contornar restrições de CORS em arquivos binários (HLS / M3U8 Globo)
  if (action === "fetchThroughBackground") {
    fetch(message.url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 16384;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);
        sendResponse({ success: true, base64 });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Fetch com permissão do background para contornar restrições de CORS
  if (action === "fetchBlobData") {
    fetch(message.url, { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 16384;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);
        const mime = res.headers.get("content-type") || "application/octet-stream";
        sendResponse({ success: true, dataUrl: `data:${mime};base64,${base64}` });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

// Auto-injeção ao instalar ou atualizar a extensão para reativar abas já abertas sem exigir F5 manual
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: ["*://*.instagram.com/*", "*://*.youtube.com/*"] });
    for (const t of tabs) {
      if (t.url.includes("instagram.com")) {
        chrome.scripting.executeScript({
          target: { tabId: t.id },
          files: ["lib/jszip.min.js", "lib/instagram-filename.js", "content/instagram.js"]
        }).catch(() => {});
      } else if (t.url.includes("youtube.com")) {
        chrome.scripting.executeScript({
          target: { tabId: t.id },
          files: ["content/youtube.js"]
        }).catch(() => {});
      }
    }
  } catch (e) {}
});

console.info("[SnapTudo] Service Worker pronto 🌶️");
