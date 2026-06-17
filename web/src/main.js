import { clearLibrary, deletePlayable, listPlayables, savePlayable } from "./db.js";
import { importFile } from "./importer.js";
import "./styles.css";

const app = document.querySelector("#app");

const state = {
  playables: [],
  activePlayable: null,
  isBooting: true,
  serviceWorkerReady: false,
  isImporting: false,
  installDismissed: localStorage.getItem("install-dismissed") === "1",
  controlsOpen: false,
  storeIntent: null,
  error: "",
  fullscreenState: "idle",
  reloadNonce: 0
};

let fileInput;
let tripleTapTimes = [];
const basePath = normalizeBasePath(import.meta.env.BASE_URL);
let serviceWorkerPromise;

init();

async function init() {
  window.addEventListener("message", handleFrameMessage);
  window.addEventListener("hashchange", syncRoute);

  serviceWorkerPromise = registerServiceWorker()
    .then(() => {
      state.serviceWorkerReady = true;
      render();
    })
    .catch(() => {
      state.serviceWorkerReady = false;
      state.error = "Player engine is still starting. Try opening the app again if a playable does not load.";
      render();
    });

  try {
    state.playables = await loadSortedPlayables();
  } catch {
    state.error = "Library could not be opened on this device.";
  } finally {
    state.isBooting = false;
    syncRoute();
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register(`${basePath}sw.js`, { scope: basePath });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    registration.update();
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1500);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
}

function syncRoute() {
  const match = location.hash.match(/^#\/player\/([^/]+)$/);
  if (match) {
    state.activePlayable = state.playables.find((item) => item.id === match[1]) || null;
  } else {
    state.activePlayable = null;
    state.controlsOpen = false;
    state.storeIntent = null;
  }
  render();
}

async function refreshLibrary() {
  state.playables = await loadSortedPlayables();
  if (state.activePlayable) {
    state.activePlayable = state.playables.find((item) => item.id === state.activePlayable.id) || null;
  }
  render();
}

async function loadSortedPlayables() {
  return (await listPlayables()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function render() {
  if (state.activePlayable) {
    renderPlayer();
  } else {
    renderLibrary();
  }
}

function renderLibrary() {
  app.className = "app library-shell";
  const installCard = shouldShowInstallCard() ? renderInstallCard() : "";
  const rows = state.playables.map(renderPlayableRow).join("");
  const bootNotice = state.isBooting ? `<section class="status-strip">Opening library...</section>` : "";

  app.innerHTML = `
    <main class="library-page">
      <section class="library-toolbar">
        <div>
          <p class="eyebrow">Mobile PWA</p>
          <h1>Playable Player</h1>
        </div>
        <div class="toolbar-actions">
          <button class="icon-button" data-action="refresh" aria-label="Refresh library">
            <span aria-hidden="true">↻</span>
          </button>
          <button class="primary-button" data-action="pick-file">Import</button>
        </div>
      </section>

      ${installCard}
      ${bootNotice}

      <section class="drop-zone" data-action="pick-file">
        <strong>${state.isImporting ? "Importing..." : "Import HTML or ZIP"}</strong>
        <span>Files stay on this device in browser storage.</span>
      </section>

      <section class="list-section">
        <div class="section-heading">
          <h2>Library</h2>
          ${state.playables.length ? `<button class="quiet-button" data-action="clear-library">Clear</button>` : ""}
        </div>
        ${
          rows ||
          `<div class="empty-state">
            <span class="empty-icon">▣</span>
            <strong>No playables yet</strong>
            <p>Import a single HTML file or a zip that contains index.html.</p>
            <button class="secondary-button" data-action="load-sample">Load sample</button>
          </div>`
        }
      </section>

      ${state.error ? `<div class="toast" role="alert">${escapeHtml(state.error)}</div>` : ""}
      <input class="file-input" type="file" accept=".html,.htm,.zip" multiple />
    </main>
  `;

  fileInput = app.querySelector(".file-input");
  wireLibraryEvents();
}

function renderInstallCard() {
  const platform = detectPlatform();
  const copy = platform === "ios"
    ? "Open this from your Home Screen for the cleanest fullscreen experience."
    : "Install this app for a browser-UI-free player experience.";
  const steps = platform === "ios"
    ? "Share → Add to Home Screen"
    : "Use the browser install prompt or Add to Home Screen.";

  return `
    <section class="install-card">
      <div>
        <h2>Install on this device</h2>
        <p>${copy}</p>
        <strong>${steps}</strong>
      </div>
      <button class="quiet-button" data-action="dismiss-install">Dismiss</button>
    </section>
  `;
}

function renderPlayableRow(item) {
  return `
    <article class="playable-row">
      <button class="row-main" data-action="open-playable" data-id="${item.id}">
        <span class="play-icon">▶</span>
        <span>
          <strong>${escapeHtml(item.name)}</strong>
          <small>${formatDate(item.createdAt)} · ${item.fileCount} files · ${formatBytes(item.byteSize)}</small>
        </span>
      </button>
      <button class="icon-button danger" data-action="delete-playable" data-id="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">
        <span aria-hidden="true">×</span>
      </button>
    </article>
  `;
}

function renderPlayer() {
  const item = state.activePlayable;
  const source = `${basePath}playables/${encodeURIComponent(item.id)}/${encodePath(item.entryPath)}?r=${state.reloadNonce}`;
  app.className = "app player-shell";
  app.innerHTML = `
    <main class="player-page">
      <iframe
        id="player-frame"
        class="player-frame"
        title="${escapeHtml(item.name)}"
        src="${source}"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-orientation-lock"
      ></iframe>
      <button class="secret-corner" data-action="secret-tap" aria-label="Open controls"></button>

      <aside class="control-panel ${state.controlsOpen ? "open" : ""}" aria-hidden="${state.controlsOpen ? "false" : "true"}">
        <div>
          <p class="eyebrow">Now playing</p>
          <h2>${escapeHtml(item.name)}</h2>
        </div>
        <div class="panel-actions">
          <button class="primary-button" data-action="reload-player">Retry</button>
          <button class="secondary-button" data-action="request-fullscreen">Fullscreen</button>
          <button class="secondary-button" data-action="go-home">Home</button>
        </div>
      </aside>

      ${state.storeIntent ? renderStoreModal(state.storeIntent) : ""}
    </main>
  `;

  wirePlayerEvents();
  requestFullscreenSoon();
}

function renderStoreModal(intent) {
  return `
    <section class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Store link detected">
      <div class="store-modal">
        <p class="eyebrow">Store link detected</p>
        <h2>The playable tried to leave the player.</h2>
        <p class="url-preview">${escapeHtml(intent.url || "External app/store URL")}</p>
        <div class="modal-actions">
          <button class="primary-button" data-action="store-retry">Retry</button>
          <button class="secondary-button" data-action="go-home">Home</button>
        </div>
      </div>
    </section>
  `;
}

function wireLibraryEvents() {
  app.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", handleLibraryAction);
  });
  fileInput.addEventListener("change", async () => {
    await importFiles([...fileInput.files]);
    fileInput.value = "";
  });
  const dropZone = app.querySelector(".drop-zone");
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
    await importFiles([...event.dataTransfer.files]);
  });
}

async function handleLibraryAction(event) {
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;

  if (action === "pick-file") fileInput.click();
  if (action === "refresh") await refreshLibrary();
  if (action === "load-sample") await loadSamplePlayable();
  if (action === "dismiss-install") {
    localStorage.setItem("install-dismissed", "1");
    state.installDismissed = true;
    render();
  }
  if (action === "open-playable") {
    await ensurePlayerReady();
    location.hash = `#/player/${id}`;
  }
  if (action === "delete-playable") {
    await deletePlayable(id);
    await refreshLibrary();
  }
  if (action === "clear-library" && confirm("Delete all imported playables on this device?")) {
    await clearLibrary();
    await refreshLibrary();
  }
}

function wirePlayerEvents() {
  app.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", handlePlayerAction);
  });
  const frame = app.querySelector("#player-frame");
  frame.addEventListener("load", () => detectExternalFrameNavigation(frame));
}

function handlePlayerAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === "secret-tap") {
    registerSecretTap();
  }
  if (action === "reload-player" || action === "store-retry") {
    state.storeIntent = null;
    state.controlsOpen = false;
    state.reloadNonce += 1;
    render();
  }
  if (action === "request-fullscreen") {
    requestFullscreen();
  }
  if (action === "go-home") {
    location.hash = "#/";
  }
}

async function importFiles(files) {
  if (!files.length || state.isImporting) return;
  state.isImporting = true;
  state.error = "";
  render();

  try {
    for (const file of files) {
      const imported = await importFile(file);
      await savePlayable(imported.playable, imported.files);
    }
    await refreshLibrary();
  } catch (error) {
    state.error = error.message || "Import failed.";
    render();
  } finally {
    state.isImporting = false;
    render();
  }
}

async function ensurePlayerReady() {
  if (!serviceWorkerPromise) return;
  await Promise.race([
    serviceWorkerPromise,
    new Promise((resolve) => setTimeout(resolve, 1800))
  ]);
}

async function loadSamplePlayable() {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <title>Sample Store Test</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111318; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; touch-action: manipulation; }
    main { display: grid; min-height: 100%; place-items: center; padding: 24px; background: linear-gradient(135deg, #141922, #263445); }
    section { display: grid; gap: 16px; width: min(360px, 100%); text-align: center; }
    h1 { margin: 0; font-size: 34px; }
    button, a { border: 0; border-radius: 8px; padding: 16px; color: #101318; background: #f3c94a; font-size: 18px; font-weight: 800; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>Playable Sample</h1>
      <button id="score">Tap score: 0</button>
      <a href="https://apps.apple.com/us/app/royal-match/id1482155847">Store CTA</a>
    </section>
  </main>
  <script>
    let score = 0;
    document.querySelector("#score").addEventListener("click", () => {
      score += 1;
      document.querySelector("#score").textContent = "Tap score: " + score;
    });
  </script>
</body>
</html>`;

  await savePlayable({
    id,
    name: "Sample Store Test",
    entryPath: "index.html",
    sourceName: "sample-store-test.html",
    fileCount: 1,
    byteSize: html.length,
    createdAt
  }, [{
    key: `${id}/index.html`,
    playableId: id,
    path: "index.html",
    type: "text/html; charset=utf-8",
    blob: new Blob([html], { type: "text/html; charset=utf-8" })
  }]);
  await refreshLibrary();
}

function handleFrameMessage(event) {
  if (event.data?.type !== "playable-store-intent") return;
  state.storeIntent = { url: event.data.url };
  state.controlsOpen = false;
  render();
}

function detectExternalFrameNavigation(frame) {
  try {
    const href = frame.contentWindow.location.href;
    if (href.startsWith(location.origin)) return;
    state.storeIntent = { url: href };
    render();
  } catch {
    state.storeIntent = { url: "External store or browser navigation" };
    render();
  }
}

function registerSecretTap() {
  const now = Date.now();
  tripleTapTimes = [...tripleTapTimes.filter((time) => now - time < 900), now];
  if (tripleTapTimes.length >= 3) {
    state.controlsOpen = true;
    tripleTapTimes = [];
    render();
  }
}

function requestFullscreenSoon() {
  setTimeout(requestFullscreen, 80);
}

async function requestFullscreen() {
  const root = document.documentElement;
  if (!root.requestFullscreen || document.fullscreenElement) return;
  try {
    await root.requestFullscreen({ navigationUI: "hide" });
    state.fullscreenState = "active";
  } catch {
    state.fullscreenState = "blocked";
  }
}

function shouldShowInstallCard() {
  return !state.installDismissed && !isStandaloneMode();
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true;
}

function detectPlatform() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normalizeBasePath(path) {
  if (!path || path === "./") return "/";
  return path.endsWith("/") ? path : `${path}/`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
