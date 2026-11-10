"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

if (process.platform !== "win32") {
  console.log("story-main-world.browser.test.js: ignorado fora do Windows");
  process.exit(0);
}

const chromeCandidates = [
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
  process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
].filter(Boolean);
const chromePath = chromeCandidates.find(candidate => fs.existsSync(candidate));

if (!chromePath) {
  console.log("story-main-world.browser.test.js: Chrome não encontrado; teste ignorado");
  process.exit(0);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "snaptudo-story-test-"));
const profileRoot = path.join(tempRoot, "profile");
const fixturePath = path.join(tempRoot, "story-main-world.html");
const mainWorldUrl = pathToFileURL(path.resolve(__dirname, "..", "content", "instagram_main.js")).href;

const fixture = `<!doctype html>
<html><body data-result="pending">
<script src="${mainWorldUrl}"></script>
<script>
  window.addEventListener("message", (event) => {
    if (event.data?.source !== "SNAPTUDO_MAIN" || event.data?.requestId !== "browser-test") return;
    const buffer = event.data?.data?.buffer;
    document.body.dataset.result = event.data?.success && buffer?.byteLength === 17 ? "ok" : "failed";
    document.body.dataset.size = String(buffer?.byteLength || 0);
  });
  const mediaUrl = URL.createObjectURL(new Blob(["story-ativo-teste"], { type: "video/mp4" }));
  window.postMessage({ source: "SNAPTUDO_CONTENT", action: "FETCH_MEDIA_DATA", requestId: "browser-test", mediaUrl }, "*");
</script>
</body></html>`;

try {
  fs.writeFileSync(fixturePath, fixture, "utf8");
  const output = execFileSync(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profileRoot}`,
    "--allow-file-access-from-files",
    "--virtual-time-budget=3000",
    "--dump-dom",
    pathToFileURL(fixturePath).href
  ], { encoding: "utf8", timeout: 20000 });
  assert.match(output, /data-result="ok"/);
  assert.match(output, /data-size="17"/);
  console.log("story-main-world.browser.test.js: ok");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
