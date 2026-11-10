/**
 * SnapTudo - Instagram Main World Script
 * Executa no contexto principal (MAIN world) para inspecionar React Fiber de forma passiva e segura.
 * NUNCA modifica window.fetch ou APIs nativas para não interferir na estabilidade do Instagram.
 */
(() => {
  if (window.__SNAPTUDO_MAIN_ACTIVE__) return;
  window.__SNAPTUDO_MAIN_ACTIVE__ = true;

  // Valores padrão; sobrescritos pela receita remota repassada pelo content script a cada consulta
  let IG_APP_ID = "936619743392459";
  let IG_ASBD_ID = "129477";
  let IG_MEDIA_INFO_ENDPOINT = "https://www.instagram.com/api/v1/media/{mediaId}/info/";
  let IG_GRAPHQL_ENDPOINT = "https://www.instagram.com/api/graphql";
  let GRAPHQL_DOC_IDS = [
    "10015901848480474", // Standard post/reel query
    "8845758582119845",  // Alternate post query
    "24368985919464652", // Shortcode media query
    "7119106094848386",  // Web post details
    "5572260122820385"   // Polar post query
  ];

  // Aplicar receita recebida (somente dados validados; endpoints restritos ao domínio do Instagram)
  function applyRecipe(recipe) {
    if (!recipe || typeof recipe !== "object") return;
    const isIgUrl = (u) => typeof u === "string" && u.startsWith("https://www.instagram.com/");
    if (typeof recipe.appId === "string" && /^\d+$/.test(recipe.appId)) IG_APP_ID = recipe.appId;
    if (typeof recipe.asbdId === "string" && /^\d+$/.test(recipe.asbdId)) IG_ASBD_ID = recipe.asbdId;
    if (isIgUrl(recipe.mediaInfoEndpoint)) IG_MEDIA_INFO_ENDPOINT = recipe.mediaInfoEndpoint;
    if (isIgUrl(recipe.graphqlEndpoint)) IG_GRAPHQL_ENDPOINT = recipe.graphqlEndpoint;
    if (Array.isArray(recipe.graphqlDocIds)) {
      const ids = recipe.graphqlDocIds.filter(id => /^\d+$/.test(String(id)));
      if (ids.length > 0) GRAPHQL_DOC_IDS = ids;
    }
  }

  // Extrair token CSRF ativo dos cookies do Instagram
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
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = BigInt(0);
    for (let i = 0; i < shortcode.length; i++) {
      const val = alphabet.indexOf(shortcode[i]);
      if (val === -1) continue;
      id = id * BigInt(64) + BigInt(val);
    }
    return id.toString();
  }

  // Buscar dados completos via API REST v1 oficial do Instagram Web
  async function fetchMediaInfoV1(shortcode) {
    const mediaId = shortcodeToMediaId(shortcode);
    if (!mediaId) return null;

    try {
      const csrfToken = getCsrfToken();
      const resp = await fetch(IG_MEDIA_INFO_ENDPOINT.replace("{mediaId}", mediaId), {
        headers: {
          "X-IG-App-ID": IG_APP_ID,
          "X-ASBD-ID": IG_ASBD_ID,
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
      console.debug("[SnapTudo] API v1 media info indisponível:", e);
    }
    return null;
  }

  // Buscar dados do post por shortcode de forma robusta e nativa
  async function fetchPostByShortcode(shortcode) {
    if (!shortcode || shortcode === "post") return null;

    // 1. PRIORIDADE MÁXIMA: Endpoint REST v1 direto (rápido, oficial e com vídeo 1080p / carrossel completo)
    try {
      const v1Data = await fetchMediaInfoV1(shortcode);
      if (v1Data) return v1Data;
    } catch (e) {}

    // 2. CometRelay em memória (se disponível no runtime do Instagram)
    if (typeof window.require === "function") {
      try {
        let relay = null;
        let env = null;
        let postQuery = null;

        try { relay = window.require("CometRelay"); } catch (e) {}
        try { env = window.require("PolarisRelayEnvironment"); } catch (e) {}
        try {
          const mod = window.require("PolarisPostActionLoadPostQuery");
          postQuery = mod?.POST_QUERY || mod?.default?.POST_QUERY || mod;
        } catch (e) {}

        if (relay && env && postQuery && typeof relay.fetchQuery === "function") {
          const queryObservable = relay.fetchQuery(env, postQuery, {
            shortcode,
            child_comment_count: 3,
            fetch_comment_count: 20,
            has_threaded_comments: true,
            parent_comment_count: 10
          });

          const relayData = typeof queryObservable.toPromise === "function"
            ? await queryObservable.toPromise()
            : await new Promise((res, rej) => queryObservable.subscribe({ next: res, error: rej }));

          if (relayData?.xdt_shortcode_media) {
            const media = relayData.xdt_shortcode_media;
            const fragment = media.__fragments?.PolarisPostActionLoadPostQueryInlineFragment
              || media.__fragments?.PolarisPostActionLoadPostQueryInlineFragmentWithoutRelatedProfiles
              || media;
            return Object.assign({}, media, fragment);
          }
        }
      } catch (e) {}
    }

    // 3. Chamadas diretas ao endpoint GraphQL oficial com body URLSearchParams e cabeçalhos de autenticação
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

        const resp = await fetch(IG_GRAPHQL_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-IG-App-ID": IG_APP_ID,
            "X-ASBD-ID": IG_ASBD_ID,
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

    // 3. Endpoint alternativo graphql/query
    try {
      const gUrl = `https://www.instagram.com/graphql/query/?query_hash=b3055c2e470540da1454e7d093880306&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;
      const gResp = await fetch(gUrl, {
        headers: {
          "X-IG-App-ID": IG_APP_ID,
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "include"
      });
      if (gResp.ok) {
        const gJson = await gResp.json();
        if (gJson?.data?.shortcode_media) return gJson.data.shortcode_media;
      }
    } catch (e) {}

    // 4. Fetch autenticado clássico (?__a=1&__d=dis)
    try {
      const endpoints = [
        `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
        `https://www.instagram.com/reel/${shortcode}/?__a=1&__d=dis`
      ];

      for (const url of endpoints) {
        try {
          const resp = await fetch(url, {
            headers: {
              "x-ig-app-id": IG_APP_ID,
              "x-asbd-id": IG_ASBD_ID,
              "x-requested-with": "XMLHttpRequest"
            },
            credentials: "include"
          });

          if (resp.ok) {
            const json = await resp.json();
            if (json?.items && json.items.length > 0) return json.items[0];
            if (json?.graphql?.shortcode_media) return json.graphql.shortcode_media;
            if (json?.data?.xdt_shortcode_media) return json.data.xdt_shortcode_media;
          }
        } catch (e) {}
      }
    } catch (e) {}

    return null;
  }

  // Busca profunda em nós do React Fiber (apenas leitura passiva)
  function deepSearchVideoUrl(obj, visited = new Set(), depth = 0) {
    if (!obj || depth > 6 || visited.has(obj)) return null;
    if (typeof obj !== "object") return null;
    visited.add(obj);

    const candidates = [
      obj.hdSrc,
      obj.sdSrc,
      obj.video_url,
      obj.videoUrl,
      obj.hd_src,
      obj.sd_src,
      obj.videoData?.hd_src,
      obj.videoData?.sd_src,
      obj.videoData?.hdSrc,
      obj.videoData?.sdSrc
    ];

    for (const c of candidates) {
      if (typeof c === "string" && c.startsWith("http") && !c.startsWith("blob:") && !c.includes(".jpg") && !c.includes(".png") && !c.includes("_thumbnail")) {
        return c;
      }
    }

    if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
      for (const v of obj.video_versions) {
        if (v?.url && typeof v.url === "string" && !v.url.includes(".jpg") && !v.url.includes(".png")) {
          return v.url;
        }
      }
    }

    if (Array.isArray(obj.implementations)) {
      for (const impl of obj.implementations) {
        const u = impl?.data?.hdSrc || impl?.data?.sdSrc;
        if (u && typeof u === "string" && !u.includes(".jpg") && !u.includes(".png")) return u;
      }
    }

    for (const k of Object.keys(obj)) {
      if (k === "stateNode" && obj[k] instanceof Node) continue;
      if (["child", "memoizedProps", "props", "children", "data", "return"].includes(k)) {
        const res = deepSearchVideoUrl(obj[k], visited, depth + 1);
        if (res) return res;
      }
    }
    return null;
  }

  // Extrair URL do vídeo inspecionando o elemento e ancestrais
  function findVideoHdSrc(videoElem) {
    if (!videoElem) return null;

    try {
      let curr = videoElem;
      let depth = 0;

      while (curr && depth < 8) {
        const keys = Object.keys(curr);
        for (const k of keys) {
          if (k.startsWith("__reactProps$") || k.startsWith("__reactFiber$")) {
            const found = deepSearchVideoUrl(curr[k]);
            if (found) return found;
          }
        }
        curr = curr.parentElement;
        depth++;
      }

      if (videoElem.currentSrc && !videoElem.currentSrc.startsWith("blob:") && !videoElem.currentSrc.includes(".jpg")) {
        return videoElem.currentSrc;
      }
      if (videoElem.src && !videoElem.src.startsWith("blob:") && !videoElem.src.includes(".jpg")) {
        return videoElem.src;
      }
    } catch (e) {}
    return null;
  }

  // Listener para mensagens vindas do content script isolado
  window.addEventListener("message", async (event) => {
    if (event.source !== window || !event.data || event.data.source !== "SNAPTUDO_CONTENT") {
      return;
    }

    const { action, requestId, shortcode, targetId, recipe } = event.data;

    if (action === "GET_POST_INFO") {
      applyRecipe(recipe);
      const data = await fetchPostByShortcode(shortcode);
      window.postMessage({
        source: "SNAPTUDO_MAIN",
        action: "POST_INFO_RESPONSE",
        requestId,
        shortcode,
        success: !!data,
        data
      }, "*");
    } else if (action === "FIND_VIDEO_URL_FOR_ELEMENT") {
      let targetVideo = null;
      if (targetId) {
        targetVideo = document.querySelector(`video[data-snaptudo-target="${targetId}"]`);
      }
      if (!targetVideo) {
        targetVideo = document.querySelector('video[data-snaptudo-target="true"]') || document.querySelector("video");
      }

      const url = findVideoHdSrc(targetVideo);

      if (targetVideo && targetVideo.hasAttribute("data-snaptudo-target")) {
        targetVideo.removeAttribute("data-snaptudo-target");
      }

      window.postMessage({
        source: "SNAPTUDO_MAIN",
        action: "VIDEO_URL_RESPONSE",
        requestId,
        url
      }, "*");
    }
  });

  console.info("[SnapTudo] Script passivo MAIN world pronto.");
})();
