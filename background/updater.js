/**
 * SnapTudo - Canal de Atualizações via GitHub 🌶️
 *
 * Duas coisas distintas, de propósito:
 *
 * 1. RECEITAS (estilo yt-dlp): `recipes/recipes.json` no repositório contém apenas DADOS
 *    (doc_ids do GraphQL, App ID, endpoints, rótulos de botões, filtros de anúncios...).
 *    Quando o Instagram/Globo mudar algo, basta editar esse JSON no GitHub e todas as
 *    extensões instaladas aplicam a mudança sozinhas (a cada 6h ou no "Verificar agora").
 *    Nunca baixamos/executamos código remoto (proibido no Manifest V3 e inseguro).
 *
 * 2. VERSÃO DO CÓDIGO: consulta a última Release estável do GitHub e avisa no popup quando
 *    há versão nova. Extensões "sem compactação" não podem se auto-substituir; o popup
 *    baixa o ZIP oficial, e o usuário extrai na mesma pasta e recarrega a extensão.
 */

const SNAPTUDO_REPO = {
  owner: "eddysangalli",
  name: "snaptudo",
  branch: "main"
};

const SNAPTUDO_RAW_BASE = `https://raw.githubusercontent.com/${SNAPTUDO_REPO.owner}/${SNAPTUDO_REPO.name}/${SNAPTUDO_REPO.branch}`;
const SNAPTUDO_URLS = {
  recipes: `${SNAPTUDO_RAW_BASE}/recipes/recipes.json`,
  manifest: `${SNAPTUDO_RAW_BASE}/manifest.json`,
  latestReleaseApi: `https://api.github.com/repos/${SNAPTUDO_REPO.owner}/${SNAPTUDO_REPO.name}/releases/latest`,
  repoPage: `https://github.com/${SNAPTUDO_REPO.owner}/${SNAPTUDO_REPO.name}`,
  releasesPage: `https://github.com/${SNAPTUDO_REPO.owner}/${SNAPTUDO_REPO.name}/releases/latest`,
  zipDownload: `https://github.com/${SNAPTUDO_REPO.owner}/${SNAPTUDO_REPO.name}/archive/refs/heads/${SNAPTUDO_REPO.branch}.zip`
};

const UPDATE_ALARM_NAME = "snaptudo-update-check";
const UPDATE_INTERVAL_MINUTES = 360; // 6 horas
const SNAPTUDO_SIDECAR_HOST = "com.eddysangalli.snaptudo";

let snaptudoActiveRecipes = null;

// Comparação numérica de versões ("1.10.0" > "1.9.3", "2026.11.09.10" > "2026.11.09.9")
function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// Validação estrutural mínima: uma receita quebrada nunca deve substituir uma válida
function isValidRecipes(r) {
  if (!r || typeof r !== "object") return false;
  if (r.schema !== 1 || typeof r.recipesVersion !== "string") return false;
  const ig = r.instagram;
  if (!ig || typeof ig.appId !== "string" || !Array.isArray(ig.graphqlDocIds)) return false;
  if (!ig.graphqlDocIds.every(id => typeof id === "string" && /^\d+$/.test(id))) return false;
  if (typeof ig.mediaInfoEndpoint !== "string" || !ig.mediaInfoEndpoint.startsWith("https://www.instagram.com/")) return false;
  if (typeof ig.graphqlEndpoint !== "string" || !ig.graphqlEndpoint.startsWith("https://www.instagram.com/")) return false;
  if (r.sniffer && !Array.isArray(r.sniffer.adAndTrackingPatterns)) return false;
  return true;
}

async function loadBundledRecipes() {
  const resp = await fetch(chrome.runtime.getURL("recipes/recipes.json"));
  const json = await resp.json();
  if (!isValidRecipes(json)) throw new Error("Receita embutida inválida");
  return json;
}

// Receita ativa = a mais nova entre (armazenada do GitHub) e (embutida no pacote)
async function getActiveRecipes() {
  if (snaptudoActiveRecipes) return snaptudoActiveRecipes;

  const bundled = await loadBundledRecipes();
  const { snaptudoRecipes } = await chrome.storage.local.get("snaptudoRecipes");

  if (isValidRecipes(snaptudoRecipes) && compareVersions(snaptudoRecipes.recipesVersion, bundled.recipesVersion) >= 0) {
    snaptudoActiveRecipes = snaptudoRecipes;
  } else {
    snaptudoActiveRecipes = bundled;
    await chrome.storage.local.set({ snaptudoRecipes: bundled });
  }
  return snaptudoActiveRecipes;
}

function getCachedRecipes() {
  return snaptudoActiveRecipes;
}

async function refreshRemoteRecipes() {
  const currentVersion = chrome.runtime.getManifest().version;
  const resp = await fetch(`${SNAPTUDO_URLS.recipes}?t=${Date.now()}`, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Receitas: HTTP ${resp.status}`);

  const remote = await resp.json();
  if (!isValidRecipes(remote)) throw new Error("Receita remota com formato inválido (ignorada)");

  // Receita que exige código mais novo não é aplicada (evita quebrar versões antigas)
  if (remote.minExtensionVersion && compareVersions(currentVersion, remote.minExtensionVersion) < 0) {
    return { applied: false, reason: `requer SnapTudo ${remote.minExtensionVersion}+`, remoteVersion: remote.recipesVersion };
  }

  const active = await getActiveRecipes();
  if (compareVersions(remote.recipesVersion, active.recipesVersion) > 0) {
    snaptudoActiveRecipes = remote;
    await chrome.storage.local.set({ snaptudoRecipes: remote });
    return { applied: true, remoteVersion: remote.recipesVersion };
  }
  return { applied: false, reason: "já atualizada", remoteVersion: remote.recipesVersion };
}

function getInstalledSidecar() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(SNAPTUDO_SIDECAR_HOST, { action: "ping" }, (response) => {
        const error = chrome.runtime.lastError;
        if (error || !response?.success) {
          resolve({
            installed: false,
            version: null,
            error: error?.message || response?.error || "Sidecar não instalado."
          });
          return;
        }
        resolve({
          installed: true,
          version: String(response.version || "0"),
          ytDlpVersion: response.ytDlpVersion || null
        });
      });
    } catch (error) {
      resolve({ installed: false, version: null, error: error.message || String(error) });
    }
  });
}

function findSidecarPackage(assets) {
  for (const asset of assets) {
    const name = String(asset?.name || "");
    const match = name.match(/^snaptudo-sidecar-v([0-9]+(?:\.[0-9]+){2,3})-win-x64\.zip$/i);
    if (match) {
      return {
        version: match[1],
        name,
        downloadUrl: asset.browser_download_url || null,
        sha256: typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
          ? asset.digest.slice("sha256:".length)
          : null
      };
    }
  }
  return null;
}

async function checkExtensionUpdate() {
  const currentVersion = chrome.runtime.getManifest().version;

  // Releases são o canal de código: somente a última release não-prévia e não-rascunho.
  const releaseResp = await fetch(`${SNAPTUDO_URLS.latestReleaseApi}?t=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" }
  });

  if (releaseResp.ok) {
    const release = await releaseResp.json();
    const latestVersion = String(release.tag_name || "0").replace(/^v/i, "");
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const expectedName = `snaptudo-v${latestVersion}.zip`.toLowerCase();
    const packageAsset = assets.find(asset => String(asset.name || "").toLowerCase() === expectedName)
      || assets.find(asset => /^snaptudo-v[\w.-]+\.zip$/i.test(String(asset.name || "")));
    const sidecarPackage = findSidecarPackage(assets);
    const installedSidecar = await getInstalledSidecar();
    const sidecarUpdateAvailable = !!(
      installedSidecar.installed
      && sidecarPackage?.version
      && compareVersions(sidecarPackage.version, installedSidecar.version) > 0
    );

    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      downloadUrl: packageAsset?.browser_download_url || release.zipball_url || SNAPTUDO_URLS.releasesPage,
      releaseUrl: release.html_url || SNAPTUDO_URLS.releasesPage,
      sha256: typeof packageAsset?.digest === "string" && packageAsset.digest.startsWith("sha256:")
        ? packageAsset.digest.slice("sha256:".length)
        : null,
      sidecar: {
        installed: installedSidecar.installed,
        installedVersion: installedSidecar.version,
        latestVersion: sidecarPackage?.version || null,
        updateAvailable: sidecarUpdateAvailable,
        downloadUrl: sidecarPackage?.downloadUrl || release.html_url || SNAPTUDO_URLS.releasesPage,
        sha256: sidecarPackage?.sha256 || null,
        error: installedSidecar.error || null
      },
      source: "github-release"
    };
  }

  // Antes da primeira Release existir, o manifest da branch principal ainda serve como fallback.
  if (releaseResp.status === 404) {
    const manifestResp = await fetch(`${SNAPTUDO_URLS.manifest}?t=${Date.now()}`, { cache: "no-store" });
    if (!manifestResp.ok) throw new Error(`Manifest remoto: HTTP ${manifestResp.status}`);
    const remoteManifest = await manifestResp.json();
    const latestVersion = String(remoteManifest.version || "0");
    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      downloadUrl: SNAPTUDO_URLS.zipDownload,
      releaseUrl: SNAPTUDO_URLS.repoPage,
      sha256: null,
      sidecar: {
        installed: false,
        installedVersion: null,
        latestVersion: null,
        updateAvailable: false,
        downloadUrl: SNAPTUDO_URLS.releasesPage,
        sha256: null
      },
      source: "main-fallback"
    };
  }

  throw new Error(`Release do GitHub: HTTP ${releaseResp.status}`);
}

// Ciclo completo: receitas + versão. Erros são registrados no status (visíveis no popup), nunca engolidos.
async function runUpdateCycle() {
  const [recipesResult, versionResult] = await Promise.allSettled([
    refreshRemoteRecipes(),
    checkExtensionUpdate()
  ]);

  const active = await getActiveRecipes();
  const version = versionResult.status === "fulfilled"
    ? versionResult.value
    : {
        currentVersion: chrome.runtime.getManifest().version,
        latestVersion: chrome.runtime.getManifest().version,
        updateAvailable: false,
        downloadUrl: SNAPTUDO_URLS.releasesPage,
        releaseUrl: SNAPTUDO_URLS.releasesPage,
        sha256: null,
        sidecar: {
          installed: false,
          installedVersion: null,
          latestVersion: null,
          updateAvailable: false,
          downloadUrl: SNAPTUDO_URLS.releasesPage,
          sha256: null
        },
        error: versionResult.reason?.message || String(versionResult.reason)
      };
  const checkedAt = new Date().toISOString();
  const status = {
    checkedAt,
    // Nomes planos são o contrato consumido pelo popup.
    currentVersion: chrome.runtime.getManifest().version,
    latestVersion: version.latestVersion,
    updateAvailable: version.updateAvailable,
    downloadUrl: version.downloadUrl,
    releaseUrl: version.releaseUrl,
    sha256: version.sha256,
    sidecarInstalled: version.sidecar?.installed === true,
    sidecarInstalledVersion: version.sidecar?.installedVersion || null,
    sidecarLatestVersion: version.sidecar?.latestVersion || null,
    sidecarUpdateAvailable: version.sidecar?.updateAvailable === true,
    sidecarDownloadUrl: version.sidecar?.downloadUrl || SNAPTUDO_URLS.releasesPage,
    sidecarSha256: version.sidecar?.sha256 || null,
    recipesVersion: active.recipesVersion,
    recipes: recipesResult.status === "fulfilled"
      ? recipesResult.value
      : { applied: false, error: recipesResult.reason?.message || String(recipesResult.reason) },
    version,
    urls: SNAPTUDO_URLS
  };

  if (recipesResult.status === "rejected") console.warn("[SnapTudo] Falha ao atualizar receitas:", recipesResult.reason);
  if (versionResult.status === "rejected") console.warn("[SnapTudo] Falha ao checar versão:", versionResult.reason);

  await chrome.storage.local.set({ snaptudoUpdateStatus: status });
  return status;
}

function ensureUpdateAlarm() {
  chrome.alarms.get(UPDATE_ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(UPDATE_ALARM_NAME, { delayInMinutes: 1, periodInMinutes: UPDATE_INTERVAL_MINUTES });
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) runUpdateCycle();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureUpdateAlarm();
  runUpdateCycle();
});

chrome.runtime.onStartup.addListener(() => {
  ensureUpdateAlarm();
  runUpdateCycle();
});

// API de mensagens do canal de atualização (retorna false para ações que não são deste módulo)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;

  if (action === "getRecipes") {
    getActiveRecipes()
      .then(recipes => sendResponse({ success: true, recipes }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (action === "getUpdateStatus") {
    chrome.storage.local.get("snaptudoUpdateStatus").then(({ snaptudoUpdateStatus }) => {
      sendResponse({ success: true, status: snaptudoUpdateStatus || null, urls: SNAPTUDO_URLS });
    });
    return true;
  }

  if (action === "checkUpdatesNow") {
    runUpdateCycle()
      .then(status => sendResponse({ success: true, status }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  return false;
});

// Aquecer o cache da receita assim que o service worker sobe
getActiveRecipes().catch(err => console.warn("[SnapTudo] Receitas indisponíveis:", err));
ensureUpdateAlarm();

self.SnapTudoUpdater = { getActiveRecipes, getCachedRecipes, runUpdateCycle, compareVersions, SNAPTUDO_URLS };

