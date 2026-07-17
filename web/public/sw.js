const DB_NAME = "playable-player-db";
const DB_VERSION = 1;
const PLAYABLE_STORE = "playables";
const FILE_STORE = "files";
const APP_CACHE = "playable-player-shell-v22";

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

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const relativePath = getScopeRelativePath(url.pathname);
  if (relativePath.startsWith("bundled-playables/")) {
    return;
  }

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
</style>`;
  const bridge = `<script>
(() => {
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
  const createEventBus = () => {
    const listeners = {};
    return {
      on(name, callback) {
        listeners[name] = listeners[name] || [];
        listeners[name].push(callback);
      },
      emit(name, ...args) {
        (listeners[name] || []).forEach((callback) => {
          try { callback(...args); } catch {}
        });
      }
    };
  };
  const adEvents = createEventBus();
  if (!window.mraid) {
    window.mraid = {
      addEventListener: adEvents.on,
      removeEventListener() {},
      getState: () => "default",
      isViewable: () => true,
      open: report,
      close() {},
      useCustomClose() {},
      expand() {},
      playVideo() {},
      getVersion: () => "3.0"
    };
  }
  if (!window.dapi) {
    window.dapi = {
      addEventListener: adEvents.on,
      removeEventListener() {},
      isReady: () => true,
      getScreenSize: () => ({ width: innerWidth, height: innerHeight }),
      openStoreUrl: report,
      open: report
    };
  }
  if (!window.FbPlayableAd) {
    window.FbPlayableAd = {
      logGameLoad() {},
      logLevelComplete() {},
      logLevelFail() {},
      logLevelStart() {},
      onCTAClick: report
    };
  }
  setTimeout(() => {
    adEvents.emit("ready");
    adEvents.emit("viewableChange", true);
    window.dispatchEvent(new Event("luna:resume"));
  }, 0);
  let interactionReported = false;
  const reportInteraction = () => {
    if (interactionReported) return;
    interactionReported = true;
    parent.postMessage({ type: "playable-user-interaction" }, "*");
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
  window.__playablePlayerUnlockAudio = unlockAudio;
  ["pointerdown", "touchend", "keydown", "click"].forEach((eventName) => {
    document.addEventListener(eventName, () => {
      reportInteraction();
      unlockAudio();
    }, { capture: true, passive: true });
  });
  window.addEventListener("blur", () => setTimeout(reportInteraction, 80));
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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", unlockAudio, { once: true });
  } else {
    unlockAudio();
  }
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
