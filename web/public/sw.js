const DB_NAME = "playable-player-db";
const DB_VERSION = 1;
const PLAYABLE_STORE = "playables";
const FILE_STORE = "files";
const APP_CACHE = "playable-player-shell-v16";

const STORE_HOSTS = [
  "apps.apple.com",
  "itunes.apple.com",
  "play.google.com",
  "market.android.com"
];

const SCOPE_PATH = new URL(self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      deleteOldCaches(),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const relativePath = getScopeRelativePath(url.pathname);
  if (relativePath.startsWith("playables/")) {
    event.respondWith(servePlayableFile(relativePath));
    return;
  }

  if (event.request.method === "GET") {
    event.respondWith(serveAppShell(event.request));
  }
});

async function serveAppShell(request) {
  const cache = await caches.open(APP_CACHE);

  if (request.mode === "navigate") {
    try {
      const response = await fetch(request);
      cache.put(request, response.clone());
      cache.put(new URL("./", self.registration.scope).toString(), response.clone());
      return response;
    } catch {
      return (await cache.match(request)) ||
        (await cache.match(new URL("./", self.registration.scope).toString())) ||
        new Response("Playable Player is offline.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
    }
  }

  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}

async function deleteOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("playable-player-shell-") && key !== APP_CACHE)
      .map((key) => caches.delete(key))
  );
}

async function servePlayableFile(relativePath) {
  const parts = decodeURIComponent(relativePath).split("/").filter(Boolean);
  const playableId = parts[1];
  const filePath = normalizePath(parts.slice(2).join("/") || "index.html");

  if (!playableId || !filePath) {
    return new Response("Not found", { status: 404 });
  }

  const file = await getFile(`${playableId}/${filePath}`);
  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  if (isHtmlPath(filePath)) {
    const html = normalizeRemoteLunaIframe(await file.blob.text());
    const playable = await getPlayable(playableId);
    return new Response(injectBridge(html, playable), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  return new Response(file.blob, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Cache-Control": "no-store"
    }
  });
}

function getScopeRelativePath(pathname) {
  if (pathname.startsWith(SCOPE_PATH)) {
    return pathname.slice(SCOPE_PATH.length).replace(/^\/+/, "");
  }
  return pathname.replace(/^\/+/, "");
}

function injectBridge(html, playable = {}) {
  const safeName = escapeHtml(playable?.name || playable?.sourceName || "Playable");
  const safeGame = escapeHtml(playable?.game || "Playable");
  const logoPath = getGameLogoPath(playable?.game);
  const fitStyles = `<style id="playable-player-fit">
html, body {
  margin: 0 !important;
  width: 100% !important;
  height: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
  overscroll-behavior: none !important;
  touch-action: manipulation;
  background: #000;
}
#playable-player-stage {
  position: absolute !important;
  top: 50% !important;
  left: 50% !important;
  transform-origin: center center !important;
}
canvas, video {
  max-width: 100vw !important;
  max-height: 100dvh !important;
}
#playable-player-audio-start {
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  display: grid !important;
  place-items: center !important;
  align-content: center !important;
  gap: 16px !important;
  border: 0 !important;
  padding: 32px !important;
  color: #101623 !important;
  background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(246,248,255,.98)) !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  text-align: center !important;
  touch-action: manipulation !important;
  pointer-events: none !important;
  transition: opacity 280ms ease !important;
}
#playable-player-audio-start.hide {
  opacity: 0 !important;
}
#playable-player-audio-start img {
  display: block !important;
  max-width: min(168px, 54vw) !important;
  max-height: 112px !important;
  object-fit: contain !important;
}
#playable-player-audio-start strong {
  display: block !important;
  color: #101623 !important;
  font-size: 32px !important;
  font-weight: 900 !important;
  line-height: 1.1 !important;
}
#playable-player-audio-start span {
  display: block !important;
  max-width: 300px !important;
  color: #637084 !important;
  font-size: 16px !important;
  font-weight: 700 !important;
  line-height: 1.35 !important;
}
</style>`;
  const bridge = `<script>
(() => {
  const playableName = ${JSON.stringify(safeName)};
  const playableGame = ${JSON.stringify(safeGame)};
  const playableLogo = ${JSON.stringify(logoPath)};
  const storeHosts = ${JSON.stringify(STORE_HOSTS)};
  const storeSchemes = ["itms-apps:", "itmss:", "market:"];
  const isStoreUrl = (raw) => {
    try {
      const url = new URL(raw, location.href);
      return storeSchemes.includes(url.protocol) || storeHosts.includes(url.hostname);
    } catch {
      return /^\\s*(itms-apps|itmss|market):/i.test(String(raw));
    }
  };
  const report = (raw) => {
    parent.postMessage({ type: "playable-store-intent", url: String(raw) }, "*");
  };
  const audioContexts = new Set();
  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  if (NativeAudioContext) {
    function PlayablePlayerAudioContext(...args) {
      const context = new NativeAudioContext(...args);
      audioContexts.add(context);
      return context;
    }
    PlayablePlayerAudioContext.prototype = NativeAudioContext.prototype;
    Object.setPrototypeOf(PlayablePlayerAudioContext, NativeAudioContext);
    window.AudioContext = PlayablePlayerAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = PlayablePlayerAudioContext;
  }
  const allowAudioFrames = () => {
    document.querySelectorAll("iframe").forEach((frame) => {
      const allow = frame.getAttribute("allow") || "";
      if (!/\\bautoplay\\b/i.test(allow)) {
        frame.setAttribute("allow", [allow, "autoplay; fullscreen; gamepad; accelerometer; gyroscope; encrypted-media"].filter(Boolean).join("; "));
      }
    });
  };
  const unlockAudio = () => {
    document.querySelectorAll("audio, video").forEach((media) => {
      media.muted = false;
    });
    audioContexts.forEach((context) => {
      if (context.resume) {
        context.resume().catch(() => {});
      }
    });
    allowAudioFrames();
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        frame.contentWindow?.postMessage({ type: "playable-audio-unlock" }, "*");
      } catch {}
    });
  };
  const primeAudio = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(0);
      oscillator.stop(context.currentTime + 0.04);
      context.resume?.();
      setTimeout(() => context.close?.(), 250);
    } catch {}
  };
  const removeAudioStart = () => {
    document.getElementById("playable-player-audio-start")?.remove();
    window.dispatchEvent(new CustomEvent("playable-player-start"));
  };
  const createAudioStart = () => {
    if (document.body?.dataset.playablePlayerNoStart === "1") return;
    if (!document.body || document.getElementById("playable-player-audio-start")) return;
    const prompt = document.createElement("div");
    prompt.id = "playable-player-audio-start";
    prompt.setAttribute("aria-label", "Start " + playableName + " with sound");
    prompt.innerHTML =
      (playableLogo ? '<img src="' + playableLogo + '" alt="' + playableGame + '">' : '<span>' + playableGame + '</span>') +
      '<strong>Tap game to start</strong>' +
      '<span>' + playableName + '</span>';
    document.body.appendChild(prompt);
    setTimeout(() => {
      prompt.classList.add("hide");
      setTimeout(removeAudioStart, 320);
    }, 5500);
  };
  let audioStartScheduled = false;
  const isLoadingVisible = () => {
    const nodes = document.querySelectorAll("#luna-loading, .loading, .loader, [data-loading='true'], [aria-busy='true']");
    return [...nodes].some((node) => {
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    });
  };
  const loadingSettleDelay = () => document.getElementById("luna-loading") ? 2200 : 0;
  const scheduleAudioStart = (delay = 250) => {
    if (audioStartScheduled || document.getElementById("playable-player-audio-start")) return;
    audioStartScheduled = true;
    setTimeout(() => {
      audioStartScheduled = false;
      if (isLoadingVisible()) {
        if (document.body) delete document.body.dataset.playablePlayerLoadingReadyAt;
        scheduleAudioStart(300);
        return;
      }
      const settleDelay = loadingSettleDelay();
      if (settleDelay && document.body) {
        const readyAt = Number(document.body.dataset.playablePlayerLoadingReadyAt || 0);
        if (!readyAt) {
          document.body.dataset.playablePlayerLoadingReadyAt = String(Date.now());
          scheduleAudioStart(300);
          return;
        }
        const remaining = settleDelay - (Date.now() - readyAt);
        if (remaining > 0) {
          scheduleAudioStart(Math.min(remaining, 500));
          return;
        }
      }
      createAudioStart();
    }, delay);
  };
  const shouldWaitForReadySignal = () => document.body?.dataset.playablePlayerWaitReady === "1";
  window.__playablePlayerUnlockAudio = unlockAudio;
  ["pointerdown", "touchend", "keydown", "click"].forEach((eventName) => {
    document.addEventListener(eventName, unlockAudio, { capture: true, passive: true });
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "playable-audio-unlock") unlockAudio();
  });
  const originalOpen = window.open;
  window.open = function(url, ...rest) {
    if (url && isStoreUrl(url)) {
      report(url);
      return null;
    }
    return originalOpen.call(window, url, ...rest);
  };
  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor || !isStoreUrl(anchor.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    report(anchor.href);
  }, true);
  document.addEventListener("submit", (event) => {
    const action = event.target && event.target.action;
    if (!action || !isStoreUrl(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    report(action);
  }, true);
  const ensureStage = () => {
    const body = document.body;
    if (!body || body.dataset.playablePlayerFit === "manual") return null;
    let stage = document.getElementById("playable-player-stage");
    if (!stage) {
      stage = document.createElement("div");
      stage.id = "playable-player-stage";
      body.appendChild(stage);
    }
    absorbBodyChildren(stage);
    return stage;
  };
  const absorbBodyChildren = (stage) => {
    const body = document.body;
    if (!body) return;
    [...body.childNodes].forEach((node) => {
      if (node !== stage && node.id !== "playable-player-audio-start") stage.appendChild(node);
    });
  };
  const observeStage = () => {
    const body = document.body;
    const stage = ensureStage();
    if (!body || !stage || body.dataset.playablePlayerObserver === "1") return;
    body.dataset.playablePlayerObserver = "1";
    new MutationObserver(() => {
      absorbBodyChildren(stage);
      unlockAudio();
      requestAnimationFrame(fitPlayable);
    }).observe(body, { childList: true, subtree: true });
  };
  const measureStage = (stage) => {
    stage.style.transform = "translate(-50%, -50%) scale(1)";
    stage.style.width = "";
    stage.style.height = "";
    const previousOverflow = stage.style.overflow;
    stage.style.overflow = "visible";
    const rect = stage.getBoundingClientRect();
    const width = Math.max(stage.scrollWidth, stage.offsetWidth, Math.ceil(rect.width));
    const height = Math.max(stage.scrollHeight, stage.offsetHeight, Math.ceil(rect.height));
    stage.style.overflow = previousOverflow;
    return { width, height };
  };
  const fitPlayable = () => {
    const stage = ensureStage();
    if (!stage) return;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const measured = measureStage(stage);
    const contentWidth = measured.width;
    const contentHeight = measured.height;
    if (!viewportWidth || !viewportHeight || !contentWidth || !contentHeight) return;
    const scale = Math.min(1, viewportWidth / contentWidth, viewportHeight / contentHeight);
    stage.style.width = contentWidth + "px";
    stage.style.height = contentHeight + "px";
    stage.style.transform = "translate(-50%, -50%) scale(" + scale + ")";
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      observeStage();
      fitPlayable();
    }, { once: true });
  } else {
    observeStage();
    fitPlayable();
  }
  window.addEventListener("load", () => {
    observeStage();
    if (!shouldWaitForReadySignal()) scheduleAudioStart();
    fitPlayable();
  });
  window.addEventListener("playable-player-ready", () => scheduleAudioStart(50));
  window.addEventListener("resize", fitPlayable);
  window.addEventListener("orientationchange", () => setTimeout(fitPlayable, 250));
  setTimeout(fitPlayable, 50);
  setTimeout(fitPlayable, 500);
})();
</script>`;

  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${fitStyles}${bridge}`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${fitStyles}${bridge}`);
  }
  return `${fitStyles}${bridge}${html}`;
}

function isHtmlPath(path) {
  return path.toLowerCase().endsWith(".html") || path.toLowerCase().endsWith(".htm");
}

function normalizePath(path) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function normalizeRemoteLunaIframe(html) {
  if (!/assets\.lunalabs\.io\/uploads\/apps\/app\//i.test(html)) return html;
  let nextHtml = html;
  if (!nextHtml.includes("playableReadySent")) {
    nextHtml = nextHtml
      .replace(
        "let bannerTimeout;",
        `let bannerTimeout;
        let playgroundFrameLoaded = false;
        let playableReadySent = false;`
      )
      .replace(
        "function onMessage( event ) {\n            const data = event.data;",
        `function onMessage( event ) {
            const data = event.data;
            maybeMarkPlayableReady(event, data);`
      )
      .replace(
        "function showBanner( title ) {",
        `function maybeMarkPlayableReady(event, data) {
            var iframe = document.getElementById("iframe");
            if (playableReadySent || !playgroundFrameLoaded || !iframe || event.source !== iframe.contentWindow) return;
            if (data && data.type === 'success') return;
            playableReadySent = true;
            window.dispatchEvent(new CustomEvent("playable-player-ready"));
        }

        function showBanner( title ) {`
      )
      .replace(
        "function iframeLoaded() {\n            var loading = document.getElementById(\"luna-loading\");",
        `function iframeLoaded() {
            playgroundFrameLoaded = true;
            var loading = document.getElementById("luna-loading");`
      );
  }
  nextHtml = nextHtml.replace(
    /<body data-playable-player-fit="manual"(?![^>]*data-playable-player-wait-ready)/,
    `<body data-playable-player-fit="manual" data-playable-player-wait-ready="1"`
  );
  return nextHtml.replace(
    /(<iframe id="iframe" onload="iframeLoaded\(\)" allow="[^"]+") data-src="([^"]+)"/g,
    `$1 src="$2"`
  );
}

function getGameLogoPath(game) {
  if (game === "Royal Match") return new URL("game-logos/royal-match.png", self.registration.scope).toString();
  if (game === "Royal Kingdom") return new URL("game-logos/royal-kingdom.png", self.registration.scope).toString();
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PLAYABLE_STORE)) {
        db.createObjectStore(PLAYABLE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getFile(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, "readonly");
    const request = tx.objectStore(FILE_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function getPlayable(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAYABLE_STORE, "readonly");
    const request = tx.objectStore(PLAYABLE_STORE).get(id);
    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
