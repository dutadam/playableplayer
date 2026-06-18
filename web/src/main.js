import { clearLibrary, deletePlayable, listPlayables, savePlayable, updatePlayable } from "./db.js";
import { importFile } from "./importer.js";
import "./styles.css";

const app = document.querySelector("#app");

const GAME_OPTIONS = ["Royal Match", "Royal Kingdom", "Other"];
const CREATIVE_TYPES = ["Gameplay", "Meta", "Rewarded", "Minigame", "Storefront", "Other"];
const LANGUAGE_OPTIONS = ["English", "Turkish", "German", "French", "Spanish", "Italian", "Portuguese", "Arabic", "Japanese", "Korean", "Chinese", "Unknown"];
const QUICK_TAGS = ["cta", "tutorial", "booster", "fail-state", "win-state", "seasonal", "character", "level", "offer", "luna"];

const state = {
  playables: [],
  activePlayable: null,
  isBooting: true,
  serviceWorkerReady: false,
  isImporting: false,
  installDismissed: localStorage.getItem("install-onboarding-dismissed") === "1",
  controlsOpen: false,
  storeIntent: null,
  pendingMetadata: null,
  editingPlayableId: null,
  settingsOpen: false,
  gameFilter: localStorage.getItem("game-filter") || "All",
  languageFilter: localStorage.getItem("language-filter") || "All",
  error: "",
  fullscreenState: "idle",
  reloadNonce: 0
};

let fileInput;
let tripleTapTimes = [];
const basePath = normalizeBasePath(import.meta.env.BASE_URL);
let serviceWorkerPromise;
let deferredInstallPrompt;

init();

async function init() {
  window.addEventListener("message", handleFrameMessage);
  window.addEventListener("hashchange", syncRoute);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    render();
  });

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
  return (await listPlayables())
    .map(normalizePlayable)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function render() {
  if (state.activePlayable) {
    renderPlayer();
  } else if (shouldShowInstallOnboarding()) {
    renderInstallOnboarding();
  } else {
    renderLibrary();
  }
}

function renderLibrary() {
  document.body.classList.remove("player-active");
  app.className = "app library-shell";
  const filteredItems = getFilteredPlayables();
  const rows = filteredItems.map(renderPlayableRow).join("");
  const bootNotice = state.isBooting ? `<section class="status-strip">Opening library...</section>` : "";
  const royalMatchTheme = gameTheme("Royal Match");
  const royalKingdomTheme = gameTheme("Royal Kingdom");

  app.innerHTML = `
    <main class="library-page">
      <section class="library-hero">
        <div class="brand-row">
          ${renderDreamLogo()}
          <button class="icon-button" data-action="open-settings" aria-label="Open settings">
            <span aria-hidden="true">☰</span>
          </button>
        </div>
        <div class="hero-copy">
          <p class="eyebrow">Playable QA</p>
          <h1>Creative library and fullscreen player.</h1>
        </div>
      </section>

      ${bootNotice}

      <section class="library-summary">
        <button class="summary-card ${state.gameFilter === "All" ? "active" : ""}" data-action="set-game-filter" data-game="All">
          <strong>${state.playables.length}</strong>
          <span>Total</span>
        </button>
        <button class="summary-card ${state.gameFilter === "Royal Match" ? "active" : ""}" style="--game-color: ${royalMatchTheme.primary}; --game-soft: ${royalMatchTheme.soft}" data-action="set-game-filter" data-game="Royal Match">
          <strong>${countByGame("Royal Match")}</strong>
          <span>Royal Match</span>
        </button>
        <button class="summary-card ${state.gameFilter === "Royal Kingdom" ? "active" : ""}" style="--game-color: ${royalKingdomTheme.primary}; --game-soft: ${royalKingdomTheme.soft}" data-action="set-game-filter" data-game="Royal Kingdom">
          <strong>${countByGame("Royal Kingdom")}</strong>
          <span>Royal Kingdom</span>
        </button>
      </section>

      <section class="list-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Library</p>
            <h2>${state.gameFilter === "All" ? "All playables" : state.gameFilter}</h2>
          </div>
          <div class="filter-group">
            <select class="filter-select" data-action="filter-language" aria-label="Filter by language">
              ${["All", ...LANGUAGE_OPTIONS].map((language) => `<option value="${language}" ${state.languageFilter === language ? "selected" : ""}>${language === "All" ? "All languages" : language}</option>`).join("")}
            </select>
          </div>
        </div>
        ${
          rows ||
          `<div class="empty-state">
            <button class="primary-button load-button" data-action="load-demos">Load Playable</button>
          </div>`
        }
      </section>

      ${state.error ? `<div class="toast" role="alert">${escapeHtml(state.error)}</div>` : ""}
      ${state.settingsOpen ? renderSettingsSheet() : ""}
      ${state.pendingMetadata || state.editingPlayableId ? renderMetadataSheet() : ""}
      <input class="file-input" type="file" accept=".html,.htm,.zip" multiple />
    </main>
  `;

  fileInput = app.querySelector(".file-input");
  wireLibraryEvents();
}

function renderInstallOnboarding() {
  const platform = detectPlatform();
  const steps = platform === "ios"
    ? ["Tap Safari's share button", "Choose Add to Home Screen", "Launch from the new icon"]
    : ["Tap Install or open Share", "Choose Add to Home Screen", "Launch from the new icon"];
  const canShare = platform !== "ios" && typeof navigator.share === "function";
  const hasInstallPrompt = Boolean(deferredInstallPrompt);
  const actionLabel = hasInstallPrompt ? "Install app" : "Open share sheet";

  document.body.classList.remove("player-active");
  app.className = "app onboarding-shell";
  fileInput = null;
  app.innerHTML = `
    <main class="onboarding-page">
      <section class="onboarding-hero">
        <div class="brand-row">
          ${renderDreamLogo()}
        </div>
        <div class="onboarding-copy">
          <p class="eyebrow">One-time setup</p>
          <h1>Add Playable Player to Home Screen.</h1>
          <p>Fullscreen testing works best after the app opens from its own Home Screen icon. The library will unlock after this step.</p>
        </div>
        ${platform === "ios" ? renderShareHint() : ""}
        <ol class="onboarding-steps">
          ${steps.map((step) => `<li>${step}</li>`).join("")}
        </ol>
        <div class="onboarding-actions">
          ${canShare || hasInstallPrompt ? `<button class="primary-button" data-action="open-share">${actionLabel}</button>` : ""}
          <button class="secondary-button" data-action="mark-installed">I added it</button>
        </div>
        <p class="onboarding-note">${platform === "ios" ? "iOS only shows Add to Home Screen from Safari's own share menu. After adding it, tap I added it." : "After this, the setup screen stays hidden on this device."}</p>
      </section>
      ${state.error ? `<div class="toast" role="alert">${escapeHtml(state.error)}</div>` : ""}
    </main>
  `;
  wireLibraryEvents();
}

function renderShareHint() {
  return `
    <div class="share-hint" aria-label="Safari share button">
      <svg class="share-arrow" viewBox="0 0 72 44" aria-hidden="true">
        <path d="M5 22h52" />
        <path d="M45 10l12 12-12 12" />
      </svg>
      <span>Point this at Safari's share icon</span>
    </div>
  `;
}

function renderPlayableRow(item) {
  const tags = getDisplayTags(item);
  const game = item.game || "Unassigned";
  const creativeType = item.creativeType || "Uncategorized";
  const language = item.language || "Unknown";
  const theme = gameTheme(game);
  return `
    <article class="playable-row" style="--game-color: ${theme.primary}; --game-accent: ${theme.accent}; --game-soft: ${theme.soft}; --game-ink: ${theme.ink}">
      <button class="row-main" data-action="open-playable" data-id="${item.id}">
        <span class="play-icon">▶</span>
        <span class="playable-copy">
          <strong>${escapeHtml(getDisplayName(item))}</strong>
          <small>${escapeHtml(game)} · ${escapeHtml(creativeType)} · ${escapeHtml(language)} · ${item.fileCount} files · ${formatBytes(item.byteSize)}</small>
          <span class="row-tags">${tags.slice(0, 4).map((tag) => `<em>${escapeHtml(tag)}</em>`).join("")}</span>
        </span>
      </button>
      <div class="row-actions">
        <button class="icon-button subtle" data-action="edit-playable" data-id="${item.id}" aria-label="Edit ${escapeHtml(item.name)}">
          <span aria-hidden="true">⋯</span>
        </button>
        <button class="icon-button danger subtle" data-action="delete-playable" data-id="${item.id}" aria-label="Delete ${escapeHtml(item.name)}">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </article>
  `;
}

function renderSettingsSheet() {
  return `
    <section class="modal-backdrop metadata-backdrop" role="dialog" aria-modal="true" aria-label="Library settings">
      <div class="metadata-sheet settings-sheet">
        <div class="sheet-head">
          <div>
            <p class="eyebrow">Settings</p>
            <h2>Library tools</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-settings" aria-label="Close">×</button>
        </div>
        <div class="settings-actions">
          <button class="primary-button" data-action="load-demos">Load Playable</button>
          <button class="secondary-button" data-action="pick-file">Import HTML or ZIP</button>
          <button class="secondary-button" data-action="refresh">Refresh library</button>
          ${state.playables.length ? `<button class="secondary-button danger-action" data-action="clear-library">Clear library</button>` : ""}
        </div>
      </div>
    </section>
  `;
}

function renderDreamLogo() {
  return `
    <div class="dream-logo" aria-label="Dream Games">
      <svg viewBox="0 0 197 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M183.289 26.6111C184.612 20.1188 189.712 15.0185 196.205 13.6949C196.513 13.6379 196.513 13.2043 196.205 13.1472C189.712 11.8237 184.612 6.72337 183.289 0.231054C183.232 -0.0770178 182.798 -0.0770178 182.741 0.231054C181.417 6.72337 176.317 11.8237 169.825 13.1472C169.517 13.2043 169.517 13.6379 169.825 13.6949C176.317 15.0185 181.417 20.1188 182.741 26.6111C182.798 26.9192 183.232 26.9192 183.289 26.6111Z" fill="currentColor"/>
        <path d="M178.348 31.8383C178.348 23.8171 171.845 17.3247 163.835 17.3247C159.864 17.3247 156.27 18.9221 153.657 21.5008C151.033 18.9221 147.438 17.3247 143.479 17.3247C135.458 17.3247 128.966 23.8285 128.966 31.8383V51.4408C128.966 51.7374 129.205 51.9885 129.513 51.9885H136.633C136.93 51.9999 137.181 51.7603 137.181 51.4522V31.4047C137.181 28.1757 139.999 25.54 143.228 25.54C146.457 25.54 149.504 28.1529 149.504 31.3933V51.4408C149.504 51.7374 149.743 51.9885 150.051 51.9885H157.228C157.525 51.9885 157.776 51.7489 157.776 51.4408V31.3933C157.776 28.1643 160.868 25.54 164.097 25.54C167.326 25.54 170.133 28.1529 170.133 31.3933V51.4408C170.133 51.7374 170.373 51.9885 170.681 51.9885H177.812C178.109 51.9885 178.36 51.7489 178.36 51.4408V31.8383H178.348Z" fill="currentColor"/>
        <path d="M109.857 17.3336C100.284 17.3336 92.5253 25.0924 92.5253 34.6655C92.5253 44.2385 100.284 51.9974 109.857 51.9974C113.018 51.9974 115.973 51.153 118.517 49.6697V51.4497C118.517 51.7463 118.757 51.9974 119.065 51.9974H126.641C126.938 51.9974 127.189 51.7577 127.189 51.4497V34.6655C127.189 25.0924 119.43 17.3336 109.857 17.3336ZM109.857 43.7707C104.837 43.7707 100.752 39.6859 100.752 34.6655C100.752 29.6451 104.837 25.5603 109.857 25.5603C114.878 25.5603 118.962 29.6451 118.962 34.6655C118.962 39.6859 114.878 43.7707 109.857 43.7707Z" fill="currentColor"/>
        <path d="M91.5801 40.188L86.1603 38.1227C85.5099 37.8717 84.7683 38.1456 84.4602 38.7617C82.9655 41.7283 79.8962 43.7593 76.3477 43.7593C74.5107 43.7593 73.4495 43.3371 73.0388 43.1774C72.5709 42.9948 72.0917 42.721 71.7608 42.5156C71.5897 42.4129 71.5897 42.1505 71.7608 42.0478L85.4072 34.1634L89.3665 31.8814C91.6143 30.5807 92.4016 27.6597 91.021 25.469C90.3934 24.4649 89.6632 23.5293 88.8531 22.6849C85.7039 19.3874 81.2654 17.3336 76.3477 17.3336C66.7746 17.3336 59.0158 25.0924 59.0158 34.6655C59.0158 36.3542 59.2668 37.9744 59.7118 39.5148C60.4991 42.2304 61.9368 44.6607 63.8308 46.646C66.98 49.9435 71.4185 51.9974 76.3363 51.9974C83.4105 51.9974 89.4806 47.7528 92.1734 41.6713C92.4244 41.1008 92.1506 40.4276 91.5687 40.1994L91.5801 40.188ZM67.2539 34.6997C67.231 33.901 67.3337 32.1553 68.4633 30.1357C68.8855 29.3712 71.3272 25.5603 76.3591 25.5603C78.0249 25.5603 79.5881 26.0167 80.9231 26.7925C81.1057 26.8952 81.1057 27.1577 80.9231 27.2718L67.6646 34.9279C67.4821 35.0306 67.2653 34.9051 67.2539 34.6997Z" fill="currentColor"/>
        <path d="M62.2765 19.5814C59.7663 18.1551 56.8681 17.3336 53.7646 17.3336C44.1916 17.3336 36.4327 25.0924 36.4327 34.6655V51.4497C36.4327 51.7463 36.6723 51.9974 36.9804 51.9974H44.5567C44.8534 51.9974 45.1044 51.7577 45.1044 51.4497V34.6655C45.1044 29.8847 48.9838 26.0053 53.7646 26.0053C55.0539 26.0053 56.2862 26.2905 57.393 26.804C57.7581 26.9751 58.1803 26.8724 58.4199 26.5415L62.5389 20.7795C62.8242 20.3801 62.6987 19.8324 62.2765 19.5928V19.5814Z" fill="currentColor"/>
        <path d="M34.1161 0.00438849H26.5398C26.2431 0.00438849 25.9921 0.244 25.9921 0.552071V19.6639C23.4477 18.192 20.481 17.3363 17.3319 17.3363C7.75883 17.3363 0 25.0951 0 34.6681C0 44.2412 7.75883 52 17.3319 52C26.9049 52 34.6637 44.2412 34.6637 34.6681V0.552071C34.6637 0.25541 34.4241 0.00438849 34.1161 0.00438849ZM17.3319 43.7619C12.3114 43.7619 8.23806 39.6886 8.23806 34.6681C8.23806 29.6477 12.3114 25.5743 17.3319 25.5743C22.3523 25.5743 26.4257 29.6477 26.4257 34.6681C26.4257 39.6886 22.3523 43.7619 17.3319 43.7619Z" fill="currentColor"/>
      </svg>
    </div>
  `;
}

function renderPlayer() {
  document.body.classList.add("player-active");
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
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-orientation-lock allow-popups allow-popups-to-escape-sandbox"
      ></iframe>
      <button class="secret-zone secret-top-left" data-action="secret-tap" aria-label="Open controls"></button>
      <button class="secret-zone secret-top-right" data-action="secret-tap" aria-label="Open controls"></button>
      <button class="secret-zone secret-bottom-left" data-action="secret-tap" aria-label="Open controls"></button>
      <button class="secret-zone secret-bottom-right" data-action="secret-tap" aria-label="Open controls"></button>

      <aside class="control-panel ${state.controlsOpen ? "open" : ""}" aria-hidden="${state.controlsOpen ? "false" : "true"}">
        <div>
          <p class="eyebrow">Now playing</p>
          <h2>${escapeHtml(item.name)}</h2>
        </div>
        <div class="panel-actions">
          <button class="primary-button" data-action="reload-player">Retry</button>
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

function renderMetadataSheet() {
  const item = state.pendingMetadata || state.playables.find((playable) => playable.id === state.editingPlayableId);
  if (!item) return "";
  const tags = getPlayableTags(item);
  const tagText = tags.join(", ");

  return `
    <section class="modal-backdrop metadata-backdrop" role="dialog" aria-modal="true" aria-label="Playable details">
      <form class="metadata-sheet" data-playable-id="${item.id}">
        <div class="sheet-head">
          <div>
            <p class="eyebrow">${state.pendingMetadata ? "New import" : "Playable details"}</p>
            <h2>${escapeHtml(item.name)}</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-metadata" aria-label="Close">×</button>
        </div>

        <label>
          <span>Game</span>
          <select name="game">
            ${GAME_OPTIONS.map((game) => `<option value="${game}" ${(item.game || "Royal Match") === game ? "selected" : ""}>${game}</option>`).join("")}
          </select>
        </label>

        <label>
          <span>Playable type</span>
          <select name="creativeType">
            ${CREATIVE_TYPES.map((type) => `<option value="${type}" ${(item.creativeType || "Gameplay") === type ? "selected" : ""}>${type}</option>`).join("")}
          </select>
        </label>

        <label>
          <span>Language</span>
          <select name="language">
            ${LANGUAGE_OPTIONS.map((language) => `<option value="${language}" ${(item.language || "Unknown") === language ? "selected" : ""}>${language}</option>`).join("")}
          </select>
        </label>

        <label>
          <span>Tags</span>
          <input name="tags" value="${escapeHtml(tagText)}" placeholder="cta, tutorial, booster" />
        </label>

        <div class="quick-tags">
          ${QUICK_TAGS.map((tag) => `<button type="button" data-action="quick-tag" data-tag="${tag}">${tag}</button>`).join("")}
        </div>

        <div class="sheet-actions">
          <button class="secondary-button" type="button" data-action="close-metadata">Later</button>
          <button class="primary-button" type="button" data-action="save-metadata">Save</button>
        </div>
      </form>
    </section>
  `;
}

function wireLibraryEvents() {
  app.querySelectorAll("[data-action]").forEach((element) => {
    if (element.matches("select")) return;
    element.addEventListener("click", handleLibraryAction);
  });
  app.querySelectorAll("select[data-action='filter-language']").forEach((element) => {
    element.addEventListener("change", handleLibraryAction);
  });
  fileInput?.addEventListener("change", async () => {
    await importFiles([...fileInput.files]);
    fileInput.value = "";
  });
}

async function handleLibraryAction(event) {
  const action = event.currentTarget.dataset.action;
  const id = event.currentTarget.dataset.id;

  if (action === "pick-file") fileInput.click();
  if (action === "refresh") await refreshLibrary();
  if (action === "load-demos") await loadDemoPlayables();
  if (action === "open-share") await openShareSheet();
  if (action === "filter-game") {
    state.gameFilter = event.currentTarget.value;
    localStorage.setItem("game-filter", state.gameFilter);
    render();
  }
  if (action === "set-game-filter") {
    state.gameFilter = event.currentTarget.dataset.game || "All";
    localStorage.setItem("game-filter", state.gameFilter);
    render();
  }
  if (action === "filter-language") {
    state.languageFilter = event.currentTarget.value;
    localStorage.setItem("language-filter", state.languageFilter);
    render();
  }
  if (action === "open-settings") {
    state.settingsOpen = true;
    render();
  }
  if (action === "close-settings") {
    state.settingsOpen = false;
    render();
  }
  if (action === "mark-installed") {
    localStorage.setItem("install-onboarding-dismissed", "1");
    state.installDismissed = true;
    render();
  }
  if (action === "open-playable") {
    await requestFullscreen();
    await ensurePlayerReady();
    location.hash = `#/player/${id}`;
  }
  if (action === "edit-playable") {
    state.pendingMetadata = null;
    state.editingPlayableId = id;
    render();
  }
  if (action === "close-metadata") {
    state.pendingMetadata = null;
    state.editingPlayableId = null;
    state.settingsOpen = false;
    render();
  }
  if (action === "quick-tag") {
    addQuickTag(event.currentTarget.dataset.tag);
  }
  if (action === "save-metadata") {
    await saveMetadataFromSheet();
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
      const context = await buildMetadataContext(imported);
      const inferred = inferPlayableMetadata(context);
      imported.playable = {
        ...imported.playable,
        ...inferred,
        name: createSmartPlayableName(imported.playable, inferred, state.playables)
      };
      await savePlayable(imported.playable, imported.files);
      state.pendingMetadata = imported.playable;
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

async function openShareSheet() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (choice?.outcome === "accepted") {
      localStorage.setItem("install-onboarding-dismissed", "1");
      state.installDismissed = true;
    }
    render();
    return;
  }

  if (typeof navigator.share !== "function") {
    state.error = "Use the browser share button, then choose Add to Home Screen.";
    render();
    return;
  }

  try {
    await navigator.share({
      title: "Playable Player",
      text: "Add Playable Player to your Home Screen.",
      url: location.href.split("#")[0]
    });
  } catch (error) {
    if (error?.name !== "AbortError") {
      state.error = "Share sheet could not be opened. Use the browser share button manually.";
      render();
    }
  }
}

async function ensurePlayerReady() {
  if (!serviceWorkerPromise) return;
  await Promise.race([
    serviceWorkerPromise,
    new Promise((resolve) => setTimeout(resolve, 1800))
  ]);
}

async function loadDemoPlayables() {
  state.error = "";
  const demos = [
    {
      name: "King Richard Luna Preview",
      sourceName: "luna-royal-kingdom-preview.html",
      game: "Royal Kingdom",
      creativeType: "Gameplay",
      language: "English",
      tags: ["luna", "remote-preview", "gameplay", "landscape", "store-cta", "lang-english"],
      htmlPath: `${basePath}luna/royal-kingdom-luna-preview.html`
    },
    {
      name: "King Robert Luna Preview",
      sourceName: "luna-royal-match-preview.html",
      game: "Royal Match",
      creativeType: "Gameplay",
      language: "English",
      tags: ["luna", "remote-preview", "gameplay", "portrait", "store-cta", "lang-english"],
      htmlPath: `${basePath}luna/royal-match-luna-preview.html`
    }
  ];

  const existingBySource = new Map(state.playables.map((item) => [item.sourceName, item]));
  for (const demo of demos) {
    const existing = existingBySource.get(demo.sourceName);
    const id = existing?.id || crypto.randomUUID();
    const createdAt = existing?.createdAt || new Date().toISOString();
    const html = demo.html || await loadBundledHtml(demo.htmlPath);
    const blob = new Blob([html], { type: "text/html; charset=utf-8" });
    await savePlayable({
      ...existing,
      id,
      name: demo.name,
      entryPath: "index.html",
      sourceName: demo.sourceName,
      fileCount: 1,
      byteSize: blob.size,
      createdAt,
      game: demo.game,
      creativeType: demo.creativeType,
      language: demo.language,
      tags: demo.tags
    }, [{
      key: `${id}/index.html`,
      playableId: id,
      path: "index.html",
      type: "text/html; charset=utf-8",
      blob
    }]);
  }

  await refreshLibrary();
}

async function loadBundledHtml(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error("Bundled playable could not be loaded.");
  }
  return response.text();
}

async function saveMetadataFromSheet() {
  const sheet = app.querySelector(".metadata-sheet");
  if (!sheet) return;
  const id = sheet.dataset.playableId;
  const playable = state.playables.find((item) => item.id === id) || state.pendingMetadata;
  if (!playable) return;

  const formData = new FormData(sheet);
  const updated = {
    ...playable,
    game: String(formData.get("game") || "Other"),
    creativeType: String(formData.get("creativeType") || "Other"),
    language: String(formData.get("language") || "Unknown"),
    tags: parseTags(String(formData.get("tags") || ""))
  };

  await updatePlayable(updated);
  state.pendingMetadata = null;
  state.editingPlayableId = null;
  await refreshLibrary();
}

function addQuickTag(tag) {
  const input = app.querySelector(".metadata-sheet input[name='tags']");
  if (!input || !tag) return;
  const tags = new Set(parseTags(input.value));
  tags.add(tag);
  input.value = [...tags].join(", ");
}

async function buildMetadataContext(imported) {
  const entry = imported.files.find((file) => file.path === imported.playable.entryPath) || imported.files.find((file) => /html?$/i.test(file.path));
  const html = entry ? await entry.blob.text().catch(() => "") : "";
  return [imported.playable.sourceName, imported.playable.name, html.slice(0, 120000)].filter(Boolean).join("\n");
}

function inferPlayableMetadata(input) {
  const source = String(input || "").toLowerCase();
  const tags = new Set();
  let game = "Other";
  let creativeType = "Gameplay";
  let language = inferLanguage(source);

  if (/\b(royal[\s_-]*kingdom|kingdom|rk)\b/.test(source)) game = "Royal Kingdom";
  if (/\b(royal[\s_-]*match|match|rm)\b/.test(source)) game = "Royal Match";
  if (game === "Other" && source.includes("royal kingdom")) game = "Royal Kingdom";
  if (game === "Other" && source.includes("royal match")) game = "Royal Match";
  if (source.includes("cta") || source.includes("store")) {
    tags.add("cta");
    creativeType = "Storefront";
  }
  if (source.includes("reward")) creativeType = "Rewarded";
  if (source.includes("meta")) creativeType = "Meta";
  if (source.includes("mini")) creativeType = "Minigame";
  if (creativeType === "Gameplay") tags.add("gameplay");
  if (source.includes("tutorial")) tags.add("tutorial");
  if (source.includes("booster")) tags.add("booster");
  if (source.includes("win")) tags.add("win-state");
  if (source.includes("fail") || source.includes("lose")) tags.add("fail-state");
  if (source.includes("season") || source.includes("event")) tags.add("seasonal");
  if (source.includes("portrait") || source.includes("dik") || source.includes("vertical")) tags.add("portrait");
  if (source.includes("landscape") || source.includes("yatay") || source.includes("horizontal")) tags.add("landscape");
  if (source.includes("puzzle")) tags.add("puzzle");
  if (source.includes("builder")) tags.add("builder");
  if (source.includes("king robert") || source.includes("robert")) tags.add("king-robert");
  if (source.includes("king richard") || source.includes("richard")) tags.add("king-richard");
  if (source.includes("princess")) tags.add("princess");
  if (source.includes("luna")) tags.add("luna");
  if (source.includes("playground")) tags.add("remote-preview");
  if (language !== "Unknown") tags.add(`lang-${language.toLowerCase()}`);

  return { game, creativeType, language, tags: [...tags] };
}

function inferLanguage(source) {
  const languageRules = [
    ["Turkish", /\b(tr|turkish|turkce|türkçe|turkiye|türkiye)\b|oyna|devam|mükemmel|mukemmel|seviye/],
    ["English", /\b(en|eng|english|us|uk)\b|play now|harder than you think|amazing|level/],
    ["German", /\b(de|deu|german|deutsch)\b|spielen|weiter/],
    ["French", /\b(fr|fre|french|français|francais)\b|jouer|niveau/],
    ["Spanish", /\b(es|spa|spanish|español|espanol)\b|jugar|nivel/],
    ["Italian", /\b(it|ita|italian|italiano)\b|gioca|livello/],
    ["Portuguese", /\b(pt|por|portuguese|português|portugues)\b|jogar|nível|nivel/],
    ["Arabic", /\b(ar|ara|arabic)\b|العب|لعبة/],
    ["Japanese", /\b(ja|jpn|japanese)\b|プレイ|ゲーム/],
    ["Korean", /\b(ko|kor|korean)\b|플레이|게임/],
    ["Chinese", /\b(zh|cn|chi|chinese)\b|游戏|立即/]
  ];
  return languageRules.find(([, pattern]) => pattern.test(source))?.[0] || "Unknown";
}

function createSmartPlayableName(playable, inferred, existingItems) {
  const contextName = cleanupName(playable.sourceName || playable.name);
  const parts = [contextName, inferred.creativeType, inferred.language !== "Unknown" ? inferred.language : ""]
    .filter(Boolean);
  const base = dedupeNameParts(parts).join(" · ") || contextName || "Playable";
  const existingNames = new Set(existingItems.map((item) => item.name));
  if (!existingNames.has(base)) return base;
  let index = 2;
  while (existingNames.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function cleanupName(value) {
  return String(value || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(playable|preview|final|export|build|html|zip)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dedupeNameParts(parts) {
  const seen = new Set();
  return parts.filter((part) => {
    const key = part.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePlayable(item) {
  const inferred = inferPlayableMetadata(item.sourceName || item.name);
  const language = item.language || inferred.language;
  const tags = new Set(getPlayableTags(item).length ? getPlayableTags(item) : inferred.tags);
  if (language && language !== "Unknown") tags.add(`lang-${language.toLowerCase()}`);
  return {
    ...item,
    game: item.game || inferred.game,
    creativeType: item.creativeType || inferred.creativeType,
    language,
    tags: [...tags]
  };
}

function getFilteredPlayables() {
  return state.playables.filter((item) => {
    const gameMatches = state.gameFilter === "All" || (item.game || "Unassigned") === state.gameFilter;
    const languageMatches = state.languageFilter === "All" || (item.language || "Unknown") === state.languageFilter;
    return gameMatches && languageMatches;
  });
}

function countByGame(game) {
  return state.playables.filter((item) => item.game === game).length;
}

function getPlayableTags(item) {
  return Array.isArray(item.tags) ? item.tags : [];
}

function getDisplayTags(item) {
  const hidden = new Set(["demo", "preview", "remote-assets"]);
  const labels = {
    "lang-english": "English",
    "lang-turkish": "Turkish",
    "remote-preview": "Remote preview",
    "store-cta": "Store CTA",
    "win-state": "Win state",
    "fail-state": "Fail state",
    "king-robert": "King Robert",
    "king-richard": "King Richard",
    gameplay: "Gameplay",
    luna: "Luna"
  };
  return getPlayableTags(item)
    .filter((tag) => !hidden.has(tag))
    .map((tag) => labels[tag] || titleCaseTag(tag))
    .filter((tag, index, list) => list.indexOf(tag) === index);
}

function getDisplayName(item) {
  const game = item.game || "";
  let name = cleanupName(item.name || item.sourceName || "Playable");
  if (game) {
    const gamePattern = new RegExp(`\\b${escapeRegExp(game)}\\b`, "ig");
    name = name.replace(gamePattern, "").replace(/\s+/g, " ").trim();
  }
  name = name
    .replace(/\bRoyal\b\s*/gi, "")
    .replace(/\bPreview\b\s+\bPreview\b/gi, "Preview")
    .replace(/\s+/g, " ")
    .trim();
  return name || "Playable Variant";
}

function titleCaseTag(tag) {
  return String(tag || "")
    .replace(/^lang-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function gameColor(game) {
  return gameTheme(game).primary;
}

function gameTheme(game) {
  if (game === "Royal Match") {
    return { primary: "#2050d0", accent: "#f0c010", soft: "#eef4ff", ink: "#162b83" };
  }
  if (game === "Royal Kingdom") {
    return { primary: "#900020", accent: "#f0c000", soft: "#fff3f2", ink: "#6f001e" };
  }
  return { primary: "#657184", accent: "#d9dee8", soft: "#f3f5f8", ink: "#374151" };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTags(value) {
  return [...new Set(
    value
      .split(/[,\n]/)
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function handleFrameMessage(event) {
  const data = parseFrameMessage(event.data);
  if (data?.type !== "playable-store-intent") return;
  state.storeIntent = { url: data.url };
  state.controlsOpen = false;
  render();
}

function parseFrameMessage(data) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data;
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

function shouldShowInstallOnboarding() {
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
