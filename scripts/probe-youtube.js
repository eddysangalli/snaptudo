"use strict";

const videoId = process.argv[2] || "BaW_jenozKc";

function readBalancedObject(source, startIndex) {
  const start = source.indexOf("{", startIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

function extractInitialPlayerResponse(html) {
  const markers = [
    "var ytInitialPlayerResponse = ",
    "window.ytInitialPlayerResponse = ",
    '"ytInitialPlayerResponse":'
  ];
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;
    const json = readBalancedObject(html, markerIndex + marker.length);
    if (json) return JSON.parse(json);
  }
  return null;
}

(async () => {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141 Safari/537.36"
    }
  });
  if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);

  const player = extractInitialPlayerResponse(await response.text());
  if (!player) throw new Error("ytInitialPlayerResponse não encontrado");

  const formats = player.streamingData?.formats || [];
  const adaptive = player.streamingData?.adaptiveFormats || [];
  const count = list => ({
    total: list.length,
    directUrl: list.filter(item => typeof item.url === "string").length,
    signatureCipher: list.filter(item => typeof item.signatureCipher === "string" || typeof item.cipher === "string").length
  });

  console.log(JSON.stringify({
    videoId,
    status: player.playabilityStatus?.status || null,
    reason: player.playabilityStatus?.reason || null,
    title: player.videoDetails?.title || null,
    formats: count(formats),
    adaptiveFormats: count(adaptive),
    hasHlsManifestUrl: Boolean(player.streamingData?.hlsManifestUrl),
    hasDashManifestUrl: Boolean(player.streamingData?.dashManifestUrl)
  }, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
