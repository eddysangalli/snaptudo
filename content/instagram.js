/**
 * SnapTudo - Content Script para Instagram 🌶️
 * Injeção ultra segura na barra de ações, detecção contextual (Feed, Perfil, Post, Stories),
 * nomes de arquivos limpos baseados na manchete da legenda (sem marca d'água SnapTudo_),
 * inclusão da capa do Reels no ZIP e download em massa de perfis com filtros.
 */

(() => {
  if (typeof window.__SNAPTUDO_INSTAGRAM_CLEANUP__ === "function") {
    try { window.__SNAPTUDO_INSTAGRAM_CLEANUP__(); } catch (e) {}
  }
  window.__SNAPTUDO_INSTAGRAM_INJECTED__ = true;

  console.info("[SnapTudo] Content Script Instagram ativo 🌶️");

  const pendingRequests = new Map();
  let requestCounter = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "SNAPTUDO_MAIN") return;
    const { action, requestId, success, data, url } = event.data;
    if (pendingRequests.has(requestId)) {
      const resolver = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);
      resolver({ success, data, url });
    }
  });

  function queryMainWorld(action, payload = {}) {
    return new Promise((resolve) => {
      const requestId = `st_req_${Date.now()}_${++requestCounter}`;
      pendingRequests.set(requestId, resolve);
      window.postMessage({
        source: "SNAPTUDO_CONTENT",
        action,
        requestId,
        ...payload
      }, "*");

      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          resolve({ success: false, error: "timeout" });
        }
      }, 4000);
    });
  }

  // Toast Flutuante SnapTudo
  let toastElem = null;
  let toastTimer = null;

  function showToast(text, duration = 3000) {
    if (!toastElem) {
      toastElem = document.createElement("div");
      toastElem.className = "snaptudo-toast";
      document.body.appendChild(toastElem);
    }
    clearTimeout(toastTimer);
    toastElem.innerHTML = `<span class="toast-icon">🌶️</span> <span>${text}</span>`;
    toastElem.classList.add("visible");
    toastTimer = setTimeout(() => {
      toastElem.classList.remove("visible");
    }, duration);
  }

  const ICONS = {
    open: `<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
    download: `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,
    zip: `<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`
  };

  // Gerar nome de arquivo limpo baseado na manchete da legenda (sem marca d'água)
  function generateHeadlineFilename(caption, fallback, ext) {
    let base = "";
    if (caption && typeof caption === "string" && caption.trim().length > 3) {
      let clean = caption.split("\n")[0].trim();
      clean = clean.replace(/#[\w\u00C0-\u00FF]+/g, "");
      clean = clean.replace(/@[\w.]+/g, "");
      clean = clean.replace(/https?:\/\/\S+/g, "");
      clean = clean.replace(/[\\/:*?"<>|!.,;()+=~`[\]{}]/g, " ").trim();
      clean = clean.replace(/\s+/g, "_");
      if (clean.length > 50) {
        clean = clean.substring(0, 50);
      }
      clean = clean.replace(/_+$/, "");
      if (clean.length >= 3) {
        base = clean;
      }
    }

    if (!base) {
      base = (fallback || `midia_${Date.now()}`).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").trim();
    }

    return ext ? `${base}.${ext}` : base;
  }

  // Localizar o container isolado do post específico
  function getPostRoot(actionRow) {
    if (!actionRow) return document.body;

    const article = actionRow.closest("article");
    if (article) return article;

    const dialog = actionRow.closest("div[role='dialog']");
    if (dialog) return dialog;

    // Em Reels e postagens isoladas: localizar o container que possui o vídeo ou imagem principal
    let curr = actionRow.parentElement;
    while (curr && curr.tagName !== "MAIN" && curr !== document.body) {
      if (curr.querySelector("video, div[role='presentation'] img, img[style*='object-fit']")) {
        return curr;
      }
      curr = curr.parentElement;
    }

    const main = document.querySelector("main");
    if (main) {
      const firstSection = main.querySelector("section, article, div[role='presentation']");
      if (firstSection && firstSection.contains(actionRow)) return firstSection;
    }

    return actionRow.parentElement || document.body;
  }

  // Extrair shortcode do post
  function getPostShortcode(postRoot) {
    if (!postRoot) return "";

    const timeLink = postRoot.querySelector('time')?.closest('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    if (timeLink) {
      const match = timeLink.getAttribute("href")?.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return match[1];
    }

    const links = postRoot.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) return match[1];
    }

    if (!postRoot.closest("div[role='dialog']")) {
      const pageMatch = window.location.pathname.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
      if (pageMatch && pageMatch[1]) return pageMatch[1];
    }

    return "";
  }

  // Extrair nome de usuário legítimo do autor
  function getUsername(postRoot) {
    if (postRoot) {
      const headerUser = postRoot.querySelector('header a[href^="/"], header h2 a, h2 a');
      if (headerUser) {
        const href = headerUser.getAttribute("href") || "";
        const clean = href.replace(/\//g, "").trim();
        if (clean && !["explore", "stories", "p", "reel", "reels"].includes(clean)) {
          return clean;
        }
      }

      const topLink = postRoot.querySelector('a.notranslate, a[role="link"][tabindex="0"][href^="/"]');
      if (topLink) {
        const href = topLink.getAttribute("href") || "";
        const clean = href.replace(/\//g, "").trim();
        if (clean && !["explore", "stories", "p", "reel", "reels"].includes(clean)) {
          return clean;
        }
      }
    }

    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 1 && !["p", "reel", "reels", "stories", "explore"].includes(pathParts[0])) {
      return pathParts[0];
    }
    return "instagram";
  }

  // Extrair legenda legítima do post
  function getCaption(postRoot) {
    try {
      if (!postRoot) postRoot = document.body;
      const h1 = postRoot.querySelector("h1");
      if (h1 && h1.textContent.trim()) return h1.textContent.trim();

      const captionContainer = postRoot.querySelector('div[class*="_a9zs"] span, span._ap3a._aaco, li[role="menuitem"] span[dir="auto"]');
      if (captionContainer && captionContainer.textContent.trim()) {
        const text = captionContainer.textContent.trim();
        if (text.length > 5 && !text.includes("Curtir") && !text.includes("Responder")) {
          return text;
        }
      }

      const spans = postRoot.querySelectorAll('span[dir="auto"]');
      for (const span of spans) {
        if (span.closest('ul[class*="_a9z"] > li:not(:first-child)')) continue;
        const text = span.textContent.trim();
        if (text.length > 15 && !text.includes("Curtir") && !text.includes("Responder")) {
          return text;
        }
      }
    } catch (e) {}
    return "";
  }

  // Disparar download direto
  function downloadDirect(url, filename) {
    chrome.runtime.sendMessage({
      action: "downloadUrl",
      url,
      filename
    });
  }

  // Baixar blob de mídia de forma segura (com fallback via background para evitar qualquer restrição de CORS)
  async function fetchMediaBlob(url) {
    if (!url) return null;
    try {
      const resp = await fetch(url, { credentials: "include", cache: "no-store" });
      if (resp.ok) return await resp.blob();
    } catch (e) {}

    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: "fetchBlobData", url }, (res) => {
          if (res?.success && res.dataUrl) {
            fetch(res.dataUrl).then(r => r.blob()).then(resolve).catch(() => resolve(null));
          } else {
            resolve(null);
          }
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function saveBlobLocally(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }

  function findActiveStoryMedia() {
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 200 && rect.height >= 200 && style.display !== "none" && style.visibility !== "hidden";
    };

    const visibleVideos = [...document.querySelectorAll("section video, main video, div[role='dialog'] video, video")]
      .filter(video => isVisible(video) && (video.currentSrc || video.src))
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (br.width * br.height) - (ar.width * ar.height);
      });
    if (visibleVideos[0]) {
      return { type: "video", element: visibleVideos[0], url: visibleVideos[0].currentSrc || visibleVideos[0].src };
    }

    const visibleImages = [...document.querySelectorAll("section img, main img, div[role='dialog'] img")]
      .filter(img => isVisible(img) && (img.currentSrc || img.src) && (img.naturalWidth || 0) >= 300)
      .sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return (br.width * br.height) - (ar.width * ar.height);
      });
    if (visibleImages[0]) {
      return { type: "image", element: visibleImages[0], url: visibleImages[0].currentSrc || visibleImages[0].src };
    }
    return null;
  }

  function findActiveStoryHref(mediaElement) {
    const directLink = mediaElement?.closest?.('a[href*="/stories/"]')?.getAttribute("href");
    if (directLink) return directLink;

    const links = [...document.querySelectorAll('a[href*="/stories/"]')];
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    const activeUsername = pathParts[0] === "stories" ? pathParts[1] : "";
    const activeUserPattern = activeUsername
      ? new RegExp(`/stories/${activeUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\d{10,30}/?(?:[?#]|$)`)
      : null;
    const withStoryId = links.find(link => {
      const href = link.getAttribute("href") || "";
      return activeUserPattern?.test(href) || /\/stories\/[^/]+\/\d{10,30}\/?(?:[?#]|$)/.test(href);
    });
    return withStoryId?.getAttribute("href") || "";
  }

  function findStoryIdHint(mediaElement) {
    let element = mediaElement;
    for (let depth = 0; element && depth < 8; depth++, element = element.parentElement) {
      for (const attribute of ["data-story-id", "data-media-id", "data-id", "id"]) {
        const value = element.getAttribute?.(attribute) || "";
        const match = value.match(/(?:^|\D)(\d{10,30})(?:\D|$)/);
        if (match) return match[1];
      }
    }
    return "";
  }

  function buildActiveStoryFilename(media, mediaUrl, blob) {
    const options = {
      pageUrl: window.location.href,
      storyHref: findActiveStoryHref(media?.element),
      storyId: findStoryIdHint(media?.element),
      mediaUrl,
      type: media?.type,
      mime: blob?.type,
      timestamp: Date.now()
    };
    if (globalThis.SnapTudoInstagramFilename?.buildStoryFilename) {
      return globalThis.SnapTudoInstagramFilename.buildStoryFilename(options);
    }

    const parts = window.location.pathname.split("/").filter(Boolean);
    const username = parts[0] === "stories" && parts[1] ? parts[1] : "instagram";
    const storyId = parts[2] || options.storyId || options.timestamp;
    const extension = media?.type === "video" ? "mp4" : (blob?.type?.includes("png") ? "png" : "jpg");
    return `${username}_story_${storyId}.${extension}`;
  }

  // Configuração dinâmica ("receita"): valores padrão embutidos, sobrescritos pela receita
  // publicada no GitHub (recipes/recipes.json) e sincronizada pelo background em chrome.storage.
  const IG_CONFIG = {
    appId: "936619743392459",
    asbdId: "129477",
    mediaInfoEndpoint: "https://www.instagram.com/api/v1/media/{mediaId}/info/",
    graphqlEndpoint: "https://www.instagram.com/api/graphql",
    shortcodeAlphabet: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
    recipesVersion: "embutida"
  };

  let GRAPHQL_DOC_IDS = [
    "10015901848480474",
    "8845758582119845",
    "24368985919464652",
    "7119106094848386",
    "5572260122820385"
  ];

  function applyInstagramRecipe(recipes) {
    const ig = recipes?.instagram;
    if (!ig) return;
    if (typeof ig.appId === "string" && ig.appId) IG_CONFIG.appId = ig.appId;
    if (typeof ig.asbdId === "string" && ig.asbdId) IG_CONFIG.asbdId = ig.asbdId;
    if (typeof ig.mediaInfoEndpoint === "string" && ig.mediaInfoEndpoint.startsWith("https://www.instagram.com/")) {
      IG_CONFIG.mediaInfoEndpoint = ig.mediaInfoEndpoint;
    }
    if (typeof ig.graphqlEndpoint === "string" && ig.graphqlEndpoint.startsWith("https://www.instagram.com/")) {
      IG_CONFIG.graphqlEndpoint = ig.graphqlEndpoint;
    }
    if (typeof ig.shortcodeAlphabet === "string" && ig.shortcodeAlphabet.length === 64) {
      IG_CONFIG.shortcodeAlphabet = ig.shortcodeAlphabet;
    }
    if (Array.isArray(ig.graphqlDocIds) && ig.graphqlDocIds.length > 0) {
      GRAPHQL_DOC_IDS = ig.graphqlDocIds.filter(id => /^\d+$/.test(String(id)));
    }
    if (recipes.recipesVersion) IG_CONFIG.recipesVersion = recipes.recipesVersion;
  }

  try {
    chrome.storage.local.get("snaptudoRecipes", ({ snaptudoRecipes }) => {
      if (chrome.runtime.lastError) return;
      applyInstagramRecipe(snaptudoRecipes);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.snaptudoRecipes?.newValue) {
        applyInstagramRecipe(changes.snaptudoRecipes.newValue);
        console.info(`[SnapTudo] Receita do Instagram atualizada: ${IG_CONFIG.recipesVersion}`);
      }
    });
  } catch (e) {
    console.warn("[SnapTudo] Receitas indisponíveis, usando valores embutidos:", e);
  }

  // Normalizar payload de mídia vindo do GraphQL ou CometRelay
  function normalizeInstagramMedia(raw, fallbackUser = "") {
    if (!raw) return null;
    const item = raw.xdt_shortcode_media || raw.shortcode_media || raw.items?.[0] || raw;

    const username = item.owner?.username || item.user?.username || fallbackUser || "instagram";
    const caption = item.edge_media_to_caption?.edges?.[0]?.node?.text
      || item.caption?.text
      || (typeof item.caption === "string" ? item.caption : "")
      || "";

    const date = item.taken_at_timestamp
      ? new Date(item.taken_at_timestamp * 1000)
      : (item.taken_at ? new Date(item.taken_at * 1000) : new Date());

    const coverUrl = item.display_url
      || item.image_versions2?.candidates?.[0]?.url
      || item.thumbnail_src
      || "";

    const mediaList = [];

    // 1. CARROSSEL / ÁLBUM (edge_sidecar_to_children ou carousel_media)
    const carEdges = item.edge_sidecar_to_children?.edges;
    const carItems = item.carousel_media;

    if (carEdges && Array.isArray(carEdges) && carEdges.length > 0) {
      carEdges.forEach((edge, idx) => {
        const node = edge.node;
        if (node.is_video && (node.video_url || node.video_versions?.length > 0)) {
          const vUrl = node.video_url || node.video_versions?.[0]?.url;
          if (vUrl) {
            mediaList.push({
              type: "video",
              url: vUrl,
              ext: "mp4",
              name: `media_${String(idx + 1).padStart(2, "0")}.mp4`
            });
          }
        } else {
          const iUrl = node.display_url || node.display_resources?.slice(-1)[0]?.src || node.image_versions2?.candidates?.[0]?.url;
          if (iUrl) {
            mediaList.push({
              type: "image",
              url: iUrl,
              ext: "jpg",
              name: `media_${String(idx + 1).padStart(2, "0")}.jpg`
            });
          }
        }
      });
    } else if (carItems && Array.isArray(carItems) && carItems.length > 0) {
      carItems.forEach((cItem, idx) => {
        if ((cItem.media_type === 2 || cItem.video_versions?.length > 0) && (cItem.video_versions?.[0]?.url || cItem.video_url)) {
          mediaList.push({
            type: "video",
            url: cItem.video_versions?.[0]?.url || cItem.video_url,
            ext: "mp4",
            name: `media_${String(idx + 1).padStart(2, "0")}.mp4`
          });
        } else {
          const iUrl = cItem.image_versions2?.candidates?.[0]?.url || cItem.display_url;
          if (iUrl) {
            mediaList.push({
              type: "image",
              url: iUrl,
              ext: "jpg",
              name: `media_${String(idx + 1).padStart(2, "0")}.jpg`
            });
          }
        }
      });
    } else if (item.is_video || item.media_type === 2 || item.video_url || (item.video_versions && item.video_versions.length > 0)) {
      // 2. VÍDEO ÚNICO / REELS
      const vUrl = item.video_url || item.video_versions?.[0]?.url;
      if (vUrl) {
        mediaList.push({
          type: "video",
          url: vUrl,
          ext: "mp4",
          name: "video_01.mp4"
        });
      }
    } else {
      // 3. FOTO ÚNICA
      const iUrl = item.display_url
        || item.display_resources?.slice(-1)[0]?.src
        || item.image_versions2?.candidates?.[0]?.url;
      if (iUrl) {
        mediaList.push({
          type: "image",
          url: iUrl,
          ext: "jpg",
          name: "foto_01.jpg"
        });
      }
    }

    if (mediaList.length === 0) return null;

    return {
      username,
      caption,
      coverUrl,
      mediaList,
      date
    };
  }

  // Extrair token CSRF ativo dos cookies
  function getCsrfToken() {
    try {
      const match = document.cookie.match(/csrftoken=([a-zA-Z0-9_-]+)/);
      return match ? match[1] : "";
    } catch (e) {
      return "";
    }
  }

  // Converter shortcode alfanumérico para ID numérico do Instagram (Base64 URL -> BigInt)
  function shortcodeToMediaId(shortcode) {
    if (!shortcode) return "";
    const alphabet = IG_CONFIG.shortcodeAlphabet;
    let id = BigInt(0);
    for (let i = 0; i < shortcode.length; i++) {
      const val = alphabet.indexOf(shortcode[i]);
      if (val === -1) continue;
      id = id * BigInt(64) + BigInt(val);
    }
    return id.toString();
  }

  // Buscar dados completos via API REST v1 oficial do Instagram Web
  // Responde em ~100ms diretamente no content script com permissões de sessão
  async function fetchMediaInfoV1(shortcode) {
    const mediaId = shortcodeToMediaId(shortcode);
    if (!mediaId) return null;

    try {
      const csrfToken = getCsrfToken();
      const resp = await fetch(IG_CONFIG.mediaInfoEndpoint.replace("{mediaId}", mediaId), {
        headers: {
          "X-IG-App-ID": IG_CONFIG.appId,
          "X-ASBD-ID": IG_CONFIG.asbdId,
          "X-CSRFToken": csrfToken,
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "include"
      });

      if (resp.ok) {
        const json = await resp.json();
        if (json?.items?.[0]) {
          return json.items[0];
        }
      }
    } catch (e) {
      console.debug("[SnapTudo] API v1 media info falhou:", e);
    }
    return null;
  }

  // Consulta direta ao GraphQL no escopo do content script com credenciais de sessão
  async function fetchPostViaGraphQL(shortcode) {
    if (!shortcode || shortcode === "post") return null;

    const csrfToken = getCsrfToken();
    for (const docId of GRAPHQL_DOC_IDS) {
      try {
        const body = new URLSearchParams();
        body.set("variables", JSON.stringify({
          shortcode,
          child_comment_count: 3,
          fetch_comment_count: 20,
          has_threaded_comments: true,
          parent_comment_count: 10
        }));
        body.set("doc_id", docId);

        const resp = await fetch(IG_CONFIG.graphqlEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-IG-App-ID": IG_CONFIG.appId,
            "X-ASBD-ID": IG_CONFIG.asbdId,
            "X-CSRFToken": csrfToken,
            "X-Requested-With": "XMLHttpRequest",
            "Sec-Fetch-Site": "same-origin"
          },
          body: body.toString(),
          credentials: "include"
        });

        if (resp.ok) {
          const json = await resp.json();
          const media = json?.data?.xdt_shortcode_media || json?.data?.shortcode_media;
          if (media) {
            return media;
          }
        }
      } catch (e) {}
    }

    return null;
  }

  // Buscar mídia e metadados do post diretamente via HTML do endpoint /p/ ou /reel/
  async function fetchPostDataFromHtml(shortcode, postRoot) {
    if (!shortcode) return null;

    try {
      const endpoints = [`/p/${shortcode}/`, `/reel/${shortcode}/`];
      let html = "";
      for (const ep of endpoints) {
        try {
          const resp = await fetch(ep, {
            credentials: "include",
            headers: { "Accept": "text/html,application/xhtml+xml,application/xml" }
          });
          if (resp.ok) {
            html = await resp.text();
            if (html.length > 500) break;
          }
        } catch (err) {}
      }

      if (!html) return null;

      const mediaList = [];
      let caption = "";
      let coverUrl = "";

      // 1. Meta tags OpenGraph
      const ogVideo = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i)?.[1]
        || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:video"/i)?.[1];
      const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1]
        || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/i)?.[1];
      const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1]
        || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/i)?.[1];

      if (ogDesc) {
        const txt = document.createElement("textarea");
        txt.innerHTML = ogDesc;
        caption = txt.value;
      }
      if (ogImage) coverUrl = ogImage.replace(/&amp;/g, "&");

      // 2. Extrair URLs de vídeo embutidas no JSON
      const videoMatches = Array.from(html.matchAll(/"video_url":"(https:[^"]+)"/g));
      const cleanVideoUrls = new Set();
      videoMatches.forEach(m => {
        const u = m[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
        if (!cleanVideoUrls.has(u) && !u.includes(".jpg") && !u.includes(".png")) {
          cleanVideoUrls.add(u);
        }
      });

      if (cleanVideoUrls.size > 0) {
        Array.from(cleanVideoUrls).forEach((vUrl, vIdx) => {
          mediaList.push({
            type: "video",
            url: vUrl,
            ext: "mp4",
            name: `video_${String(vIdx + 1).padStart(2, "0")}.mp4`
          });
        });
      } else if (ogVideo) {
        mediaList.push({
          type: "video",
          url: ogVideo.replace(/&amp;/g, "&"),
          ext: "mp4",
          name: "video_01.mp4"
        });
      }

      // 3. Extrair URLs de imagens completas embutidas no JSON (display_url)
      const imgMatches = Array.from(html.matchAll(/"display_url":"(https:[^"]+)"/g));
      const cleanImgUrls = new Set();
      imgMatches.forEach(m => {
        const u = m[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
        if (!cleanImgUrls.has(u)) cleanImgUrls.add(u);
      });

      if (cleanImgUrls.size > 0) {
        Array.from(cleanImgUrls).forEach((iUrl, iIdx) => {
          mediaList.push({
            type: "image",
            url: iUrl,
            ext: "jpg",
            name: `foto_${String(iIdx + 1).padStart(2, "0")}.jpg`
          });
        });
      }

      const username = getUsername(postRoot);

      if (mediaList.length > 0) {
        return {
          username,
          caption,
          coverUrl,
          mediaList,
          date: new Date()
        };
      }
    } catch (e) {
      console.debug("[SnapTudo] Falha na extração de HTML:", e);
    }
    return null;
  }

  // Buscar dados completos do post (Prioridade: REST API v1 oficial -> MAIN World -> GraphQL oficial -> HTML)
  async function fetchCompletePostData(shortcode, postRoot) {
    if (!shortcode || shortcode === "post") return null;

    // 1. PRIORIDADE MÁXIMA: Endpoint oficial REST v1 (/api/v1/media/<id>/info/)
    // Extremamente veloz (~100ms), oficial, sem dependência de módulos externos ou doc_id.
    // Retorna MP4 HD original, todos os itens de carrossel e fotos em resolução nativa.
    try {
      const v1Data = await fetchMediaInfoV1(shortcode);
      if (v1Data) {
        const normalized = normalizeInstagramMedia(v1Data, getUsername(postRoot));
        if (normalized && normalized.mediaList?.length > 0) {
          return normalized;
        }
      }
    } catch (e) {}

    // 2. MAIN World (CometRelay ou interceptação ativa em memória)
    try {
      const mainResp = await queryMainWorld("GET_POST_INFO", {
        shortcode,
        recipe: {
          appId: IG_CONFIG.appId,
          asbdId: IG_CONFIG.asbdId,
          mediaInfoEndpoint: IG_CONFIG.mediaInfoEndpoint,
          graphqlEndpoint: IG_CONFIG.graphqlEndpoint,
          graphqlDocIds: GRAPHQL_DOC_IDS
        }
      });
      if (mainResp?.success && mainResp.data) {
        const normalized = normalizeInstagramMedia(mainResp.data, getUsername(postRoot));
        if (normalized && normalized.mediaList?.length > 0) {
          return normalized;
        }
      }
    } catch (e) {}

    // 3. Consulta Direta aos Endpoints GraphQL com doc_id persistido
    try {
      const gqlRaw = await fetchPostViaGraphQL(shortcode);
      if (gqlRaw) {
        const normalized = normalizeInstagramMedia(gqlRaw, getUsername(postRoot));
        if (normalized && normalized.mediaList?.length > 0) {
          return normalized;
        }
      }
    } catch (e) {}

    // 4. Fallback: Parse de scripts HTML para busca de JSON video_url ou display_url
    const htmlData = await fetchPostDataFromHtml(shortcode, postRoot);
    if (htmlData && htmlData.mediaList && htmlData.mediaList.length > 0) {
      return htmlData;
    }

    return null;
  }

  // Resolver mídia atual do post específico
  async function resolveCurrentMedia(postRoot) {
    if (!postRoot) postRoot = document.body;

    const shortcode = getPostShortcode(postRoot);

    // 1. Post de vídeo
    const videos = Array.from(postRoot.querySelectorAll("video"));
    const visibleVideo = videos.find(v => {
      const rect = v.getBoundingClientRect();
      return rect.width > 60 && rect.height > 60;
    }) || videos[0];

    const hasVideo = !!visibleVideo;

    if (hasVideo) {
      if (visibleVideo.currentSrc && !visibleVideo.currentSrc.startsWith("blob:") && !visibleVideo.currentSrc.includes(".jpg")) {
        return { type: "video", url: visibleVideo.currentSrc, ext: "mp4" };
      }
      if (visibleVideo.src && !visibleVideo.src.startsWith("blob:") && !visibleVideo.src.includes(".jpg")) {
        return { type: "video", url: visibleVideo.src, ext: "mp4" };
      }

      const targetId = `st_vid_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      visibleVideo.setAttribute("data-snaptudo-target", targetId);

      const fiberResp = await queryMainWorld("FIND_VIDEO_URL_FOR_ELEMENT", { targetId });
      if (visibleVideo.hasAttribute("data-snaptudo-target")) {
        visibleVideo.removeAttribute("data-snaptudo-target");
      }

      if (fiberResp?.url && !fiberResp.url.includes(".jpg") && !fiberResp.url.includes(".png")) {
        return { type: "video", url: fiberResp.url, ext: "mp4" };
      }

      if (shortcode) {
        const postData = await fetchCompletePostData(shortcode, postRoot);
        const videoItem = postData?.mediaList?.find(m => m.type === "video");
        if (videoItem?.url && !videoItem.url.includes(".jpg")) {
          return { type: "video", url: videoItem.url, ext: "mp4" };
        }
      }

      const bgVideoResp = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: "getLatestVideoForTab" }, resolve);
      });
      if (bgVideoResp?.success && bgVideoResp.url && !bgVideoResp.url.includes(".jpg") && !bgVideoResp.url.includes(".png")) {
        return { type: "video", url: bgVideoResp.url, ext: "mp4" };
      }

      return { isRestricted: true };
    }

    // 2. Post de foto
    if (shortcode) {
      const postData = await fetchCompletePostData(shortcode, postRoot);
      if (postData?.mediaList?.length > 0) {
        let targetIndex = 0;
        const urlParams = new URLSearchParams(window.location.search);
        const imgIndex = parseInt(urlParams.get("img_index"), 10);
        if (imgIndex && imgIndex > 0 && imgIndex <= postData.mediaList.length) {
          targetIndex = imgIndex - 1;
        }
        const targetMedia = postData.mediaList[targetIndex] || postData.mediaList[0];
        return {
          type: targetMedia.type,
          url: targetMedia.url,
          ext: targetMedia.ext
        };
      }
    }

    const images = Array.from(postRoot.querySelectorAll("img"));
    const postImages = images.filter(img => {
      const rect = img.getBoundingClientRect();
      const isVisible = rect.width > 150 && rect.height > 150;
      const isProfile = img.alt?.toLowerCase().includes("perfil") || img.alt?.toLowerCase().includes("profile");
      return isVisible && !isProfile;
    });

    if (postImages.length > 0) {
      postImages.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
      const targetImg = postImages[0];
      let bestUrl = targetImg.currentSrc || targetImg.src;

      if (targetImg.srcset) {
        const parts = targetImg.srcset.split(",").map(p => p.trim());
        let maxW = 0;
        for (const part of parts) {
          const [u, w] = part.split(" ");
          const widthVal = parseInt(w) || 0;
          if (widthVal > maxW && u) {
            maxW = widthVal;
            bestUrl = u;
          }
        }
      }
      return { type: "image", url: bestUrl, ext: "jpg" };
    }

    return null;
  }

  // Baixar pacote ZIP completo (Carrossel + Legenda + Capa do Reels em alta resolução)
  async function handleDownloadZip(postRoot, zipBtn) {
    if (zipBtn.classList.contains("loading")) return;
    zipBtn.classList.add("loading");
    const originalContent = zipBtn.innerHTML;
    zipBtn.innerHTML = `<span class="snaptudo-spinner"></span>`;

    const shortcode = getPostShortcode(postRoot);
    const postCaption = getCaption(postRoot);
    showToast("🔍 Buscando carrossel do post...");

    try {
      let postData = null;
      if (shortcode) {
        postData = await fetchCompletePostData(shortcode, postRoot);
      }

      if (!postData || !postData.mediaList || postData.mediaList.length === 0) {
        const singleMedia = await resolveCurrentMedia(postRoot);
        if (singleMedia && singleMedia.url) {
          postData = {
            username: getUsername(postRoot),
            caption: postCaption,
            date: new Date(),
            mediaList: [{
              type: singleMedia.type,
              url: singleMedia.url,
              ext: singleMedia.ext,
              name: `media_01.${singleMedia.ext}`
            }]
          };
        }
      }

      if (!postData || !postData.mediaList || postData.mediaList.length === 0) {
        showToast("⚠️ Mídias protegidas ou anúncio. Use a gravação ao vivo!");
        return;
      }

      showToast(`📦 Baixando mídias e capa em alta resolução...`);

      if (typeof JSZip === "undefined") {
        throw new Error("Biblioteca JSZip não carregada.");
      }

      const zip = new JSZip();

      // 1. Baixar todas as mídias da lista
      const fetchPromises = postData.mediaList.map(async (media) => {
        try {
          const resp = await fetch(media.url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          zip.file(media.name, blob);
        } catch (fetchErr) {
          console.warn("[SnapTudo] Falha ao baixar mídia:", media.url, fetchErr);
        }
      });

      // 2. Se for vídeo / Reels: incluir também a foto de capa (Thumbnail HD) no ZIP
      const hasVideo = postData.mediaList.some(m => m.type === "video") || !!postRoot.querySelector("video");
      if (hasVideo) {
        let coverUrl = postData.coverUrl;
        if (!coverUrl) {
          const posterImg = postRoot.querySelector('img[style*="object-fit"], img[srcset], video[poster]');
          coverUrl = posterImg?.currentSrc || posterImg?.src || posterImg?.getAttribute("poster");
        }
        if (coverUrl && !coverUrl.startsWith("blob:")) {
          fetchPromises.push(
            fetch(coverUrl)
              .then(res => res.ok ? res.blob() : null)
              .then(blob => {
                if (blob) zip.file("capa_reels.jpg", blob);
              })
              .catch(() => {})
          );
        }
      }

      await Promise.all(fetchPromises);

      // 3. Incluir legenda.txt
      const captionText = postData.caption || postCaption;
      if (captionText) {
        zip.file("legenda.txt", captionText);
      }

      // 4. Incluir info.txt com detalhes
      const infoContent = [
        "==================================================",
        " SnapTudo - Pacote Instagram Completo 🌶️",
        "==================================================",
        `Autor: @${postData.username}`,
        `Shortcode: ${shortcode || "post"}`,
        `Link: https://www.instagram.com/p/${shortcode}/`,
        `Data: ${postData.date.toLocaleString("pt-BR")}`,
        `Total de Mídias: ${postData.mediaList.length}`,
        `Capa do Reels inclusa: ${hasVideo ? "Sim (capa_reels.jpg)" : "Não"}`,
        "==================================================",
        "",
        "LEGENDA:",
        "--------------------------------------------------",
        captionText || "(sem legenda)",
        "--------------------------------------------------"
      ].join("\n");
      zip.file("info.txt", infoContent);

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const blobUrl = URL.createObjectURL(zipBlob);

      // Nome do arquivo baseado na manchete da legenda (estilo notícia, sem marca d'água)
      const headline = generateHeadlineFilename(captionText, `${postData.username}_${shortcode || Date.now()}`);
      const zipFileName = `${headline}.zip`;

      const downloadLink = document.createElement("a");
      downloadLink.href = blobUrl;
      downloadLink.download = zipFileName;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();

      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
      showToast(`✅ ZIP com mídias e capa do Reels baixado!`);
    } catch (err) {
      console.error("[SnapTudo] Falha ao criar ZIP:", err);
      showToast(`❌ Erro no ZIP: ${err.message || err}`);
    } finally {
      zipBtn.classList.remove("loading");
      zipBtn.innerHTML = originalContent;
    }
  }

  // Baixar mídia atual individual (HD) com nome estilo manchete da legenda
  async function handleDownloadSingle(postRoot, btn) {
    showToast("🔍 Buscando mídia em alta definição...");
    const media = await resolveCurrentMedia(postRoot);

    if (media?.isRestricted) {
      showToast("⚠️ Anúncio patrocinado ou protegido. Use a gravação ao vivo!");
      return;
    }

    if (!media || !media.url) {
      showToast("⚠️ Mídia não disponível para download direto.");
      return;
    }

    const shortcode = getPostShortcode(postRoot);
    const username = getUsername(postRoot);
    const caption = getCaption(postRoot);

    // Nome baseado na manchete da legenda
    const filename = generateHeadlineFilename(caption, `${username}_${shortcode || Date.now()}`, media.ext);
    showToast(`⬇️ Baixando ${media.type === "video" ? "vídeo HD (MP4)" : "foto em alta resolução"}...`);
    downloadDirect(media.url, filename);
  }

  // Copiar link direto
  async function handleCopyLink(postRoot) {
    showToast("🔍 Identificando link direto...");
    const media = await resolveCurrentMedia(postRoot);

    if (media?.isRestricted) {
      showToast("⚠️ Anúncio patrocinado ou protegido.");
      return;
    }

    if (!media || !media.url) {
      showToast("⚠️ Link direto não encontrado.");
      return;
    }

    navigator.clipboard.writeText(media.url).then(() => {
      showToast(`📋 Link do ${media.type === "video" ? "vídeo MP4" : "foto"} copiado!`);
    }).catch(() => {
      window.open(media.url, "_blank");
    });
  }

  // Criar grupo de botões do SnapTudo
  function createActionGroup(postRoot, isReel = false) {
    const group = document.createElement("div");
    group.className = isReel ? "snaptudo-action-group snaptudo-reel-group" : "snaptudo-action-group";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "snaptudo-btn";
    openBtn.title = "SnapTudo: Copiar Link Direto (ou Ctrl+Clique para abrir)";
    openBtn.innerHTML = ICONS.open;
    openBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        const media = await resolveCurrentMedia(postRoot);
        if (media?.url) window.open(media.url, "_blank");
      } else {
        await handleCopyLink(postRoot);
      }
    };

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "snaptudo-btn";
    dlBtn.title = "SnapTudo: Baixar Mídia Atual (HD)";
    dlBtn.innerHTML = ICONS.download;
    dlBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDownloadSingle(postRoot, dlBtn);
    };

    const zipBtn = document.createElement("button");
    zipBtn.type = "button";
    zipBtn.className = "snaptudo-btn snaptudo-btn-zip";
    zipBtn.title = "SnapTudo: Baixar Todas as Mídias + Capa do Reels (.ZIP)";
    zipBtn.innerHTML = `${ICONS.zip} <span>ZIP</span>`;
    zipBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDownloadZip(postRoot, zipBtn);
    };

    if (isReel) {
      // No Reels, colocar download direto e ZIP
      group.append(dlBtn, zipBtn);
    } else {
      group.append(openBtn, dlBtn, zipBtn);
    }
    return group;
  }

  // Localizar a barra de ações horizontal (apenas no Feed e página do Post /p/, NUNCA na sidebar de navegação)
  function findActionRow(icon) {
    if (!icon) return null;

    // NUNCA injetar na barra de navegação lateral (menu esquerdo) ou cabeçalhos
    if (icon.closest("nav, aside, [role='navigation'], header, [aria-label*='Navegação'], [aria-label*='Navigation']")) {
      return null;
    }

    // 1. Instagram usa semântica de <section> para a barra de botões do post
    const section = icon.closest("section");
    if (section) return section;

    // 2. Fallback seguro por proximidade restrito ao conteúdo do post
    let curr = icon.parentElement;
    for (let depth = 0; depth < 10 && curr && curr !== document.body; depth++) {
      if (curr.tagName === "NAV" || curr.getAttribute("role") === "navigation") {
        return null;
      }
      const hasLikeOrComment = curr.querySelector('svg[aria-label*="Curtir"], svg[aria-label*="Like"], svg[aria-label*="Descurtir"], svg[aria-label*="Comentar"], svg[aria-label*="Comment"]');
      if (hasLikeOrComment && curr.children.length >= 2 && !curr.classList.contains("snaptudo-action-group")) {
        // Garantir que é um container de post
        if (curr.closest("article, [role='dialog'], main")) {
          return curr;
        }
      }
      curr = curr.parentElement;
    }
    return null;
  }

  // Localizar a coluna de ações vertical do Reels (estreita, vertical, SEM o player de vídeo dentro)
  function findReelsActionColumn(node) {
    if (!node) return null;
    if (node.closest("nav, aside, [role='navigation'], [aria-label*='Navegação' i], [aria-label*='Navigation' i], header")) {
      return null;
    }

    let curr = node.parentElement;
    for (let depth = 0; depth < 10 && curr && curr !== document.body; depth++) {
      if (curr.closest("nav, aside, [role='navigation']")) return null;

      // Se contém a tag de vídeo, já ultrapassou a coluna e entrou no container pai geral
      if (curr.querySelector("video")) {
        break;
      }

      // Na coluna do Reels temos múltiplos botões verticais (Curtir, Comentar, Compartilhar, Salvar, Mais)
      const hasLike = curr.querySelector('[aria-label*="Curtir" i], [aria-label*="Like" i], [aria-label*="Descurtir" i], [aria-label*="Me gusta" i], [aria-label*="gusta" i]');
      const hasComment = curr.querySelector('[aria-label*="Comentar" i], [aria-label*="Comment" i]');
      const hasShare = curr.querySelector('[aria-label*="Compartilhar" i], [aria-label*="Compartir" i], [aria-label*="Share" i]');
      const hasSave = curr.querySelector('[aria-label*="Salvar" i], [aria-label*="Save" i], [aria-label*="Guardar" i], [aria-label*="Salvo" i], [aria-label*="Saved" i], polygon[points*="20 21 12 13.44"]');
      const hasMore = curr.querySelector('[aria-label*="Mais" i], [aria-label*="More" i], [aria-label*="Más" i]');

      const matches = (hasLike ? 1 : 0) + (hasComment ? 1 : 0) + (hasShare ? 1 : 0) + (hasSave ? 1 : 0) + (hasMore ? 1 : 0);
      if (matches >= 2) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  // Injetar botões de forma harmoniosa (Feed, Post /p/ e Reels)
  function injectActionBars() {
    // 1. INJEÇÃO EM REELS (Barra Vertical Lateral Nativa do Vídeo)
    const reelNodes = document.querySelectorAll(
      '[aria-label*="Salvar" i], [aria-label*="Save" i], [aria-label*="Guardar" i], [aria-label*="Salvo" i], [aria-label*="Saved" i], polygon[points*="20 21 12 13.44"], ' +
      '[aria-label*="Compartilhar" i], [aria-label*="Compartir" i], [aria-label*="Share" i], ' +
      '[aria-label*="Comentar" i], [aria-label*="Comment" i], ' +
      '[aria-label*="Curtir" i], [aria-label*="Like" i], [aria-label*="Me gusta" i], [aria-label*="Descurtir" i]'
    );

    reelNodes.forEach((node) => {
      try {
        if (node.closest("nav, aside, [role='navigation'], [aria-label*='Navegação' i], [aria-label*='Navigation' i], header")) return;

        const column = findReelsActionColumn(node);
        if (column && !column.querySelector(".snaptudo-reel-group")) {
          // Localizar o item correspondente ao Bookmark ou Compartilhar dentro desta coluna
          const bmTarget = column.querySelector(
            '[aria-label*="Salvar" i], [aria-label*="Save" i], [aria-label*="Guardar" i], [aria-label*="Salvo" i], [aria-label*="Saved" i], polygon[points*="20 21 12 13.44"]'
          );
          const shareTarget = column.querySelector('[aria-label*="Compartilhar" i], [aria-label*="Compartir" i], [aria-label*="Share" i]');
          const commentTarget = column.querySelector('[aria-label*="Comentar" i], [aria-label*="Comment" i]');
          const target = bmTarget || shareTarget || commentTarget || node;

          let refChild = target;
          while (refChild && refChild.parentElement && refChild.parentElement !== column) {
            refChild = refChild.parentElement;
          }

          const postRoot = getPostRoot(column);
          const group = createActionGroup(postRoot, true);
          if (refChild && refChild.parentElement === column) {
            column.insertBefore(group, refChild.nextSibling);
          } else {
            column.appendChild(group);
          }
        }
      } catch (e) {
        console.debug("[SnapTudo] Falha segura no Reels:", e);
      }
    });

    // Injeção direta a partir dos vídeos de Reels visíveis (garantia absoluta de presença na coluna lateral)
    const activeVideos = Array.from(document.querySelectorAll("video")).filter(v => v.offsetHeight > 180);
    activeVideos.forEach((video) => {
      try {
        let parent = video.parentElement;
        for (let d = 0; d < 8 && parent && parent !== document.body; d++) {
          const actionIcons = parent.querySelectorAll(
            '[aria-label*="Salvar" i], [aria-label*="Guardar" i], [aria-label*="Save" i], [aria-label*="Compartilhar" i], [aria-label*="Compartir" i], [aria-label*="Share" i]'
          );
          for (const icon of actionIcons) {
            const col = findReelsActionColumn(icon);
            if (col && !col.querySelector(".snaptudo-reel-group")) {
              const bm = col.querySelector('[aria-label*="Salvar" i], [aria-label*="Guardar" i], [aria-label*="Save" i], polygon[points*="20 21 12 13.44"]')
                || col.querySelector('[aria-label*="Compartilhar" i], [aria-label*="Compartir" i], [aria-label*="Share" i]');
              let ref = bm || col.firstElementChild;
              while (ref && ref.parentElement && ref.parentElement !== col) {
                ref = ref.parentElement;
              }
              const postRoot = getPostRoot(col) || parent;
              const group = createActionGroup(postRoot, true);
              if (ref && ref.parentElement === col) {
                col.insertBefore(group, ref.nextSibling);
              } else {
                col.appendChild(group);
              }
              break;
            }
          }
          if (parent.querySelector(".snaptudo-reel-group")) break;
          parent = parent.parentElement;
        }
      } catch (e) {}
    });

    // 2. FALLBACK DE CONTINGÊNCIA REELS: Se estiver em página de Reels (/reels/ ou /reel/) e a coluna nativa não foi detectada
    const isReelsPage = window.location.pathname.startsWith("/reels") || window.location.pathname.startsWith("/reel");
    if (isReelsPage) {
      const videos = Array.from(document.querySelectorAll("video")).filter(v => v.offsetHeight > 150);
      videos.forEach((video) => {
        try {
          // Localizar o slide container do Reel
          let slide = video.closest("article, div[role='presentation']") || video.parentElement?.parentElement;
          if (slide && !slide.querySelector(".snaptudo-reel-group")) {
            const postRoot = getPostRoot(slide);
            const dockGroup = createActionGroup(postRoot, true);
            dockGroup.classList.add("snaptudo-reel-floating-dock");

            // Garantir posicionamento relativo no container pai
            const currentPos = window.getComputedStyle(slide).position;
            if (currentPos === "static") {
              slide.style.position = "relative";
            }
            slide.appendChild(dockGroup);
          }
        } catch (err) {}
      });
    }

    // 2. INJEÇÃO NO FEED E PÁGINAS DE POST /p/ (Barra Horizontal)
    const actionIcons = document.querySelectorAll(
      'svg[aria-label*="Salvar"], svg[aria-label*="Save"], svg[aria-label*="Guardar"], svg[aria-label*="Salvo"], svg[aria-label*="Saved"], svg[aria-label*="Remover"], svg[aria-label*="Curtir"], svg[aria-label*="Like"], svg[aria-label*="Descurtir"], svg[aria-label*="Comentar"]'
    );

    actionIcons.forEach((icon) => {
      try {
        if (icon.closest("nav, aside, [role='navigation'], [aria-label*='Navegação']")) return;
        if (icon.closest("[data-snaptudo-reels-injected]")) return;

        const actionRow = findActionRow(icon);
        if (!actionRow || actionRow.querySelector(".snaptudo-action-group")) {
          return;
        }

        // Se for a coluna vertical do Reels, já foi tratada acima
        if (window.getComputedStyle(actionRow).flexDirection === "column") {
          return;
        }

        const postRoot = getPostRoot(actionRow);
        const group = createActionGroup(postRoot, false);

        // Localizar o ícone de Salvar / Bookmark dentro desta barra
        const bmSvg = actionRow.querySelector(
          'svg[aria-label*="Salvar"], svg[aria-label*="Save"], svg[aria-label*="Guardar"], svg[aria-label*="Salvo"], svg[aria-label*="Saved"], svg[aria-label*="Remover"]'
        );

        let saveContainer = null;
        if (bmSvg) {
          let node = bmSvg;
          while (node && node.parentElement && node.parentElement !== actionRow) {
            node = node.parentElement;
          }
          if (node && node.parentElement === actionRow) {
            saveContainer = node;
          }
        }

        // Forçar layout flex horizontal na actionRow para NUNCA quebrar o Bookmark para a linha de baixo
        actionRow.style.setProperty("display", "flex", "important");
        actionRow.style.setProperty("flex-direction", "row", "important");
        actionRow.style.setProperty("flex-wrap", "nowrap", "important");
        actionRow.style.setProperty("align-items", "center", "important");

        // Empurrar grupo SnapTudo para a direita (junto ao Salvar)
        group.style.setProperty("margin-left", "auto", "important");
        group.style.setProperty("margin-right", "4px", "important");
        group.style.setProperty("flex-shrink", "0", "important");

        if (saveContainer && saveContainer.parentElement === actionRow) {
          saveContainer.style.setProperty("margin-left", "0", "important");
          saveContainer.style.setProperty("flex-shrink", "0", "important");
          actionRow.insertBefore(group, saveContainer);
        } else {
          actionRow.appendChild(group);
        }

        actionRow.setAttribute("data-snaptudo-injected", "true");
      } catch (err) {
        console.warn("[SnapTudo] Falha segura ao injetar na barra:", err);
      }
    });
  }

  // Injetar em Stories
  function injectIntoStories() {
    if (!window.location.pathname.startsWith("/stories/")) return;
    if (document.querySelector(".snaptudo-stories-bar")) return;

    const header = document.querySelector('section header, div[role="dialog"] header, .x6s0dn4.x78zum5.x1xmf6yo');
    if (!header) return;

    const bar = document.createElement("div");
    bar.className = "snaptudo-stories-bar";

    const dlStoryBtn = document.createElement("button");
    dlStoryBtn.className = "snaptudo-btn";
    dlStoryBtn.title = "SnapTudo: Baixar este Story";
    dlStoryBtn.innerHTML = ICONS.download;
    dlStoryBtn.onclick = async () => {
      const media = findActiveStoryMedia();
      if (!media) {
        showToast("⚠️ Nenhuma mídia de story encontrada no momento.");
        return;
      }

      dlStoryBtn.disabled = true;
      showToast("⬇️ Preparando Story com a sessão ativa...");
      try {
        let mediaUrl = media.url;
        if (media.type === "video" && mediaUrl.startsWith("blob:")) {
          const captured = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: "getLatestVideoForTab" }, response => resolve(response));
          });
          if (captured?.success && captured.url) mediaUrl = captured.url;
        }

        const blob = await fetchMediaBlob(mediaUrl);
        if (!blob || blob.size === 0) throw new Error("A CDN não entregou a mídia.");
        const filename = buildActiveStoryFilename(media, mediaUrl, blob);
        saveBlobLocally(blob, filename);
        showToast(`✅ Story preparado (${Math.max(1, Math.round(blob.size / 1024))} KB).`);
      } catch (error) {
        console.warn("[SnapTudo] Falha ao baixar Story autenticado:", error);
        showToast("⚠️ Não foi possível buscar este Story. Avance e volte para renovar a URL.");
      } finally {
        dlStoryBtn.disabled = false;
      }
    };

    bar.appendChild(dlStoryBtn);
    header.appendChild(bar);
  }

  // Identificar o post centralizado no viewport do usuário
  function getCurrentlyViewedPost() {
    const dialog = document.querySelector("div[role='dialog']");
    if (dialog) return dialog;

    if (window.location.pathname.startsWith("/p/") || window.location.pathname.startsWith("/reel/") || window.location.pathname.startsWith("/reels")) {
      const mainSection = document.querySelector("main section, main article, [role='main']");
      if (mainSection) return mainSection;
    }

    const centerY = window.innerHeight / 2;
    const actionGroups = Array.from(document.querySelectorAll(".snaptudo-action-group, .snaptudo-reel-group"));

    if (actionGroups.length > 0) {
      let bestPost = null;
      let minDistance = Infinity;

      for (const group of actionGroups) {
        const postRoot = getPostRoot(group.closest("section, div[data-snaptudo-injected]") || group.parentElement);
        const rect = postRoot.getBoundingClientRect();
        if (rect.bottom > 80 && rect.top < window.innerHeight - 80) {
          const postCenter = rect.top + rect.height / 2;
          const dist = Math.abs(centerY - postCenter);
          if (dist < minDistance) {
            minDistance = dist;
            bestPost = postRoot;
          }
        }
      }
      if (bestPost) return bestPost;
    }

    return document.querySelector("article") || document.body;
  }

  // Obter o contexto completo da página atual
  function getPageContext() {
    const path = window.location.pathname;
    const pathParts = path.split("/").filter(Boolean);

    const reservedRoots = [
      "p", "reel", "reels", "stories", "explore", "direct", "accounts",
      "emails", "your_activity", "login", "create", "settings", "terms", "privacy", "support", "about", "developer", "api"
    ];

    // 1. Identificar se é página de perfil
    let usernameFromUrl = "";
    if (pathParts.length >= 1 && !reservedRoots.includes(pathParts[0])) {
      usernameFromUrl = pathParts[0];
    }

    const titleMatch = document.title.match(/\(@([a-zA-Z0-9_.]+)\)/);
    const usernameFromTitle = titleMatch ? titleMatch[1] : "";
    const username = usernameFromUrl || usernameFromTitle;

    const isStories = path.startsWith("/stories/");
    const isSinglePost = path.startsWith("/p/") || (path.startsWith("/reel/") && !usernameFromUrl);
    const isProfile = !!username && !isStories && !isSinglePost;

    if (isProfile) {
      const avatarImg = document.querySelector(`
        header img[alt*="perfil" i],
        header img[alt*="profile" i],
        header img[src],
        [role="main"] header img,
        img[data-testid="user-avatar"]
      `);
      const avatar = avatarImg?.src || "";
      const headerTitle = document.querySelector('header h2, header h1, [role="main"] header h2, [role="main"] header h1')?.textContent?.trim() || username;

      // Buscar todos os links de postagens na grade (independente de estar em main, article ou div)
      const postLinks = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]'))
        .filter(a => !a.closest("nav, aside, [role='navigation'], [aria-label*='Navegação' i]"));

      const seenShortcodes = new Set();
      const uniquePosts = [];
      postLinks.forEach(a => {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !seenShortcodes.has(m[1])) {
          seenShortcodes.add(m[1]);
          uniquePosts.push(a.href);
        }
      });

      return {
        ok: true,
        pageType: "profile",
        username,
        title: headerTitle,
        avatar,
        postCount: uniquePosts.length,
        posts: uniquePosts
      };
    }

    if (isStories) {
      const storiesUser = pathParts[1] || "stories";
      return {
        ok: true,
        pageType: "stories",
        username: storiesUser,
        title: `@${storiesUser}`
      };
    }

    const activePost = getCurrentlyViewedPost();
    const shortcode = getPostShortcode(activePost);
    const activeUsername = getUsername(activePost);
    const caption = getCaption(activePost);
    const hasVideo = !!activePost.querySelector("video");

    return {
      ok: true,
      pageType: path.startsWith("/p/") || path.startsWith("/reel/") || path.startsWith("/reels/") ? "post" : "feed",
      username: activeUsername,
      caption,
      shortcode,
      hasVideo
    };
  }

  // Baixar mídias em massa de um perfil (com filtros, suporte a Port em tempo real e fallback para imagens da grade)
  async function downloadProfileMedia(options = {}, port = null) {
    const { filter = "all", limit = "all" } = options;

    function notify(p) {
      if (port) {
        try { port.postMessage(p); } catch (e) {}
      }
      try {
        chrome.runtime.sendMessage({ action: "profileDownloadProgress", ...p });
      } catch (e) {}
    }

    notify({ percent: 10, text: "Escaneando publicações do perfil..." });

    try {
      const postLinks = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]'))
        .filter(a => !a.closest("nav, aside, [role='navigation'], [aria-label*='Navegação' i]"));

      const items = [];
      const seenCodes = new Set();
      for (const a of postLinks) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !seenCodes.has(m[1])) {
          seenCodes.add(m[1]);
          const img = a.querySelector("img");
          const isVideo = !!a.querySelector('svg[aria-label*="Vídeo" i], svg[aria-label*="Video" i], svg[aria-label*="Reels" i], [aria-label*="Vídeo" i], [aria-label*="Video" i]');
          items.push({
            shortcode: m[1],
            tileImgUrl: img?.src || "",
            altText: img?.alt || "",
            isVideo
          });
        }
      }

      if (items.length === 0) {
        notify({ error: "Nenhum post encontrado. Role a página do perfil para carregar." });
        showToast("⚠️ Nenhum post encontrado no perfil. Role a página para carregar!");
        return;
      }

      const maxItems = limit === "all" ? items.length : Math.min(parseInt(limit, 10) || 12, items.length);
      const selectedItems = items.slice(0, maxItems);
      const profileUser = getUsername() || "perfil";

      notify({ percent: 15, text: `Iniciando coleta de ${selectedItems.length} posts de @${profileUser}...` });
      showToast(`🔍 Processando ${selectedItems.length} postagens de @${profileUser}...`);

      if (typeof JSZip === "undefined") {
        notify({ error: "Biblioteca JSZip não carregada." });
        showToast("❌ Biblioteca JSZip não disponível.");
        return;
      }

      const zip = new JSZip();
      let collectedCount = 0;
      const legendas = [];

      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const code = item.shortcode;
        const currentPct = Math.round(15 + ((i / selectedItems.length) * 70));

        notify({
          percent: currentPct,
          current: i + 1,
          total: selectedItems.length,
          text: `Baixando post ${i + 1} de ${selectedItems.length} (${code})...`
        });

        try {
          // 1. Tentar dados completos do post (vídeo HD / carrossel / imagem original)
          let postData = await fetchCompletePostData(code);

          // 2. Se falhar ou estiver vazio, usar dados visíveis do grid como contingência
          if (!postData || !postData.mediaList || postData.mediaList.length === 0) {
            if (item.tileImgUrl) {
              postData = {
                username: profileUser,
                caption: item.altText || "",
                coverUrl: item.tileImgUrl,
                mediaList: [{
                  type: item.isVideo ? "video" : "image",
                  url: item.tileImgUrl,
                  ext: "jpg",
                  name: `foto_${code}.jpg`
                }],
                date: new Date()
              };
            }
          }

          if (postData && postData.mediaList) {
            const headline = generateHeadlineFilename(postData.caption, `${code}`);

            if (postData.caption) {
              legendas.push(`[Post ${code} - ${postData.date.toLocaleDateString("pt-BR")}]\n${postData.caption}\n${"-".repeat(40)}`);
            }

            for (let mIdx = 0; mIdx < postData.mediaList.length; mIdx++) {
              const media = postData.mediaList[mIdx];
              if (filter === "photos" && media.type !== "image") continue;
              if (filter === "videos" && media.type !== "video") continue;

              try {
                const blob = await fetchMediaBlob(media.url);
                if (blob) {
                  const ext = media.ext || (media.type === "video" ? "mp4" : "jpg");
                  const fileName = `${String(i + 1).padStart(2, "0")}_${headline}_${mIdx + 1}.${ext}`;
                  zip.file(fileName, blob);
                  collectedCount++;
                }
              } catch (err) {}
            }
          }
        } catch (err) {
          console.debug(`[SnapTudo] Erro no post ${code}:`, err);
        }
      }

      if (collectedCount === 0) {
        notify({ error: "Nenhuma mídia correspondeu aos filtros selecionados." });
        showToast("⚠️ Nenhuma mídia correspondeu aos filtros selecionados.");
        return;
      }

      if (legendas.length > 0) {
        zip.file("todas_legendas.txt", legendas.join("\n\n"));
      }

      notify({ percent: 88, text: `Compactando ${collectedCount} arquivos em ZIP...` });
      showToast(`📦 Compactando ${collectedCount} arquivo(s)...`);

      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        const packPct = Math.round(88 + (meta.percent * 0.11));
        notify({ percent: packPct, text: `Compactando ZIP: ${Math.round(meta.percent)}%` });
      });

      const blobUrl = URL.createObjectURL(zipBlob);
      const cleanUser = profileUser.replace(/[\\/:*?"<>|]/g, "_");
      const zipName = `${cleanUser}_${filter}_${Date.now()}.zip`;

      const downloadLink = document.createElement("a");
      downloadLink.href = blobUrl;
      downloadLink.download = zipName;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();

      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
      showToast(`✅ Perfil @${profileUser}: ${collectedCount} mídia(s) baixadas com sucesso!`);

      notify({
        percent: 100,
        current: selectedItems.length,
        total: selectedItems.length,
        text: `✓ Download Concluído (${collectedCount} arquivos)!`,
        done: true
      });
    } catch (err) {
      console.error("[SnapTudo] Erro geral no download do perfil:", err);
      notify({ error: `Erro no download: ${err.message}` });
    }
  }

  // Agendador com DEBOUNCE seguro
  let isExecuting = false;
  let debounceTimeout = null;

  function scheduleRun() {
    if (debounceTimeout) return;
    debounceTimeout = setTimeout(() => {
      debounceTimeout = null;
      if (!isExecuting) {
        isExecuting = true;
        try {
          injectActionBars();
          injectIntoStories();
        } catch (e) {
          console.debug("[SnapTudo] Erro na injeção:", e);
        } finally {
          isExecuting = false;
        }
      }
    }, 350);
  }

  const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        shouldUpdate = true;
        break;
      }
    }
    if (shouldUpdate) scheduleRun();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  scheduleRun();
  const runInterval = setInterval(scheduleRun, 1000);
  window.addEventListener("popstate", scheduleRun);

  window.__SNAPTUDO_INSTAGRAM_CLEANUP__ = () => {
    try { observer.disconnect(); } catch (e) {}
    try { clearInterval(runInterval); } catch (e) {}
    try { window.removeEventListener("popstate", scheduleRun); } catch (e) {}
  };

  // Suporte a canal direto dedicado (Port) para envio de progresso sem perdas
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "snaptudo-profile-download") {
      port.onMessage.addListener((msg) => {
        if (msg.action === "startDownloadProfile") {
          downloadProfileMedia(msg.options, port);
        }
      });
    }
  });

  // Listener de Mensagens da Extensão
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "ping") {
      sendResponse({ ok: true, alive: true });
      return true;
    }

    if (msg.action === "getInstagramPageContext" || msg.action === "getInstagramCurrentPostInfo") {
      const context = getPageContext();
      sendResponse(context);
      return true;
    }

    if (msg.action === "startDownloadProfile") {
      downloadProfileMedia(msg.options);
      sendResponse({ started: true });
      return true;
    }
  });
})();
