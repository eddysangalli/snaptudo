/**
 * SnapTudo - YouTube Main World Script
 * Executa no contexto da página do YouTube para acessar o player interno e ytInitialPlayerResponse.
 */

(() => {
  function getPlayerResponse() {
    try {
      const player = document.getElementById("movie_player");
      if (player && typeof player.getPlayerResponse === "function") {
        return player.getPlayerResponse();
      }
    } catch (e) {}

    if (window.ytInitialPlayerResponse) {
      return window.ytInitialPlayerResponse;
    }
    return null;
  }

  function extractYouTubeStreams() {
    const data = getPlayerResponse();
    if (!data || !data.streamingData) return null;

    const details = data.videoDetails || {};
    const streaming = data.streamingData;
    const formats = streaming.formats || [];
    const adaptive = streaming.adaptiveFormats || [];

    const availableStreams = [];

    // 1. Formatos progressivos (Vídeo + Áudio mesclados em MP4)
    formats.forEach((f) => {
      if (f.url) {
        availableStreams.push({
          type: "muxed",
          quality: f.qualityLabel || `${f.height}p`,
          ext: "mp4",
          url: f.url,
          mimeType: f.mimeType,
          size: f.contentLength ? parseInt(f.contentLength, 10) : null
        });
      }
    });

    // 2. Extrair melhor faixa de áudio (M4A)
    const audioFormats = adaptive.filter(f => f.mimeType && f.mimeType.includes("audio/mp4") && f.url);
    if (audioFormats.length > 0) {
      // Maior bitrate de áudio
      audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      availableStreams.push({
        type: "audio",
        quality: `${Math.round((audioFormats[0].bitrate || 128000) / 1000)} kbps`,
        ext: "m4a",
        url: audioFormats[0].url,
        mimeType: audioFormats[0].mimeType,
        size: audioFormats[0].contentLength ? parseInt(audioFormats[0].contentLength, 10) : null
      });
    }

    return {
      title: details.title || document.title.replace(" - YouTube", ""),
      author: details.author || "",
      duration: parseInt(details.lengthSeconds, 10) || 0,
      thumbnail: details.thumbnail?.thumbnails?.pop()?.url || "",
      streams: availableStreams
    };
  }

  // Ouvinte de mensagens do script isolado
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.source !== "SNAPTUDO_YT_CONTENT") return;

    if (event.data.action === "GET_YT_DATA") {
      const info = extractYouTubeStreams();
      window.postMessage({
        source: "SNAPTUDO_YT_MAIN",
        action: "YT_DATA_RESPONSE",
        requestId: event.data.requestId,
        success: !!info,
        data: info
      }, "*");
    }
  });

  console.info("[SnapTudo] YouTube Main World Script ativo 🌶️");
})();

