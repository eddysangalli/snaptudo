"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const updaterSource = fs.readFileSync(path.join(repoRoot, "background", "updater.js"), "utf8");
const bundledRecipes = JSON.parse(fs.readFileSync(path.join(repoRoot, "recipes", "recipes.json"), "utf8"));

const stored = {};
const event = () => ({ addListener() {} });

const chrome = {
  runtime: {
    getManifest: () => ({ version: "1.2.0" }),
    getURL: relative => `chrome-extension://test/${relative}`,
    onInstalled: event(),
    onStartup: event(),
    onMessage: event()
  },
  alarms: {
    get: (_name, callback) => callback({ name: "snaptudo-update-check" }),
    create() {},
    onAlarm: event()
  },
  storage: {
    local: {
      async get(key) {
        if (typeof key === "string") return { [key]: stored[key] };
        return { ...stored };
      },
      async set(values) {
        Object.assign(stored, values);
      }
    }
  }
};

async function fetchMock(url) {
  if (url.startsWith("chrome-extension://test/recipes/recipes.json")) {
    return { ok: true, status: 200, json: async () => bundledRecipes };
  }
  if (url.includes("raw.githubusercontent.com") && url.includes("recipes/recipes.json")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ ...bundledRecipes, recipesVersion: "2026.11.09.3" })
    };
  }
  if (url.includes("api.github.com/repos/eddysangalli/snaptudo/releases/latest")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v1.2.1",
        html_url: "https://github.com/eddysangalli/snaptudo/releases/tag/v1.2.1",
        zipball_url: "https://api.github.com/repos/eddysangalli/snaptudo/zipball/v1.2.1",
        assets: [{
          name: "snaptudo-v1.2.1.zip",
          browser_download_url: "https://github.com/eddysangalli/snaptudo/releases/download/v1.2.1/snaptudo-v1.2.1.zip",
          digest: `sha256:${"a".repeat(64)}`
        }]
      })
    };
  }
  throw new Error(`URL inesperada no teste: ${url}`);
}

const context = {
  chrome,
  fetch: fetchMock,
  console,
  Date,
  Promise,
  self: {}
};
vm.createContext(context);
vm.runInContext(updaterSource, context, { filename: "background/updater.js" });

(async () => {
  assert.equal(context.self.SnapTudoUpdater.compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(context.self.SnapTudoUpdater.compareVersions("1.2.0", "1.2.0"), 0);
  assert.equal(context.self.SnapTudoUpdater.compareVersions("1.1.9", "1.2.0"), -1);

  const status = await context.self.SnapTudoUpdater.runUpdateCycle();
  assert.equal(status.currentVersion, "1.2.0");
  assert.equal(status.latestVersion, "1.2.1");
  assert.equal(status.updateAvailable, true);
  assert.equal(status.recipesVersion, "2026.11.09.3");
  assert.match(status.downloadUrl, /snaptudo-v1\.2\.1\.zip$/);
  assert.equal(status.sha256, "a".repeat(64));
  assert.equal(stored.snaptudoUpdateStatus.latestVersion, "1.2.1");

  console.log("updater.test.js: OK");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
