"use strict";

(function exposeInstagramFilename(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SnapTudoInstagramFilename = api;
})(typeof globalThis !== "undefined" ? globalThis : self, () => {
  function safeDecode(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (e) {
      return String(value || "");
    }
  }

  function sanitizePart(value, fallback) {
    const clean = safeDecode(value)
      .replace(/^@+/, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^[_\-.]+|[_\-.]+$/g, "")
      .slice(0, 80);
    return clean || fallback;
  }

  function extractNumericId(value) {
    const match = String(value || "").match(/(?:^|\D)(\d{10,30})(?:\D|$)/);
    return match ? match[1] : "";
  }

  function decodeInstagramCacheKey(value) {
    if (!value) return "";
    try {
      const normalized = safeDecode(value).replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      if (typeof atob === "function") return atob(padded);
      if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
    } catch (e) {}
    return "";
  }

  function parseStoryUrl(rawUrl) {
    try {
      const url = new URL(rawUrl || "", "https://www.instagram.com");
      const parts = url.pathname.split("/").filter(Boolean);
      const storyIndex = parts.indexOf("stories");
      if (storyIndex === -1) return { username: "", storyId: "" };
      return {
        username: sanitizePart(parts[storyIndex + 1], ""),
        storyId: extractNumericId(parts[storyIndex + 2])
      };
    } catch (e) {
      return { username: "", storyId: "" };
    }
  }

  function extractStoryIdFromMediaUrl(rawUrl) {
    if (!rawUrl || String(rawUrl).startsWith("blob:")) return "";
    try {
      const url = new URL(rawUrl);
      for (const key of ["story_id", "media_id", "id"]) {
        const id = extractNumericId(url.searchParams.get(key));
        if (id) return id;
      }
      const cacheKey = decodeInstagramCacheKey(url.searchParams.get("ig_cache_key"));
      const cacheId = extractNumericId(cacheKey);
      if (cacheId) return cacheId;
      return extractNumericId(url.pathname);
    } catch (e) {
      return extractNumericId(rawUrl);
    }
  }

  function extensionFor({ type, mime, mediaUrl } = {}) {
    const normalizedMime = String(mime || "").toLowerCase();
    if (normalizedMime.includes("png")) return "png";
    if (normalizedMime.includes("webp")) return "webp";
    if (normalizedMime.includes("jpeg") || normalizedMime.includes("jpg")) return "jpg";
    if (normalizedMime.includes("mp4")) return "mp4";
    if (type === "video") return "mp4";
    try {
      const match = new URL(mediaUrl || "").pathname.match(/\.([a-z0-9]{2,5})$/i);
      if (match && ["jpg", "jpeg", "png", "webp", "mp4"].includes(match[1].toLowerCase())) {
        return match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
      }
    } catch (e) {}
    return "jpg";
  }

  function getStoryIdentity(options = {}) {
    const page = parseStoryUrl(options.pageUrl);
    const linked = parseStoryUrl(options.storyHref);
    const username = sanitizePart(
      page.username || linked.username || options.username,
      "instagram"
    );
    const storyId = page.storyId
      || linked.storyId
      || extractNumericId(options.storyId)
      || extractStoryIdFromMediaUrl(options.mediaUrl)
      || String(options.timestamp || Date.now());
    return { username, storyId: sanitizePart(storyId, String(Date.now())) };
  }

  function buildStoryFilename(options = {}) {
    const identity = getStoryIdentity(options);
    const extension = extensionFor(options);
    return `${identity.username}_story_${identity.storyId}.${extension}`;
  }

  return {
    buildStoryFilename,
    extractStoryIdFromMediaUrl,
    extensionFor,
    getStoryIdentity,
    parseStoryUrl,
    sanitizePart
  };
});
