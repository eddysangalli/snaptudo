"use strict";

(function exposeSidecarCompat(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SnapTudoSidecarCompat = api;
})(typeof globalThis !== "undefined" ? globalThis : self, () => {
  const MINIMUM_VERSION = "1.2.3";

  function parseVersion(value) {
    const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/i);
    return match ? match.slice(1, 5).map(part => Number(part || 0)) : null;
  }

  function compareVersions(left, right) {
    const a = parseVersion(left);
    const b = parseVersion(right);
    if (!a || !b) return null;
    for (let i = 0; i < 4; i++) {
      if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
  }

  function evaluate(installedVersion) {
    const comparison = compareVersions(installedVersion, MINIMUM_VERSION);
    return {
      installedVersion: String(installedVersion || "desconhecida"),
      requiredVersion: MINIMUM_VERSION,
      compatible: comparison !== null && comparison >= 0,
      needsUpdate: comparison === null || comparison < 0
    };
  }

  return { MINIMUM_VERSION, compareVersions, evaluate, parseVersion };
});
