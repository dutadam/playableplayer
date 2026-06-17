const DB_NAME = "playable-player-db";
const DB_VERSION = 1;
const PLAYABLE_STORE = "playables";
const FILE_STORE = "files";
const APP_CACHE = "playable-player-shell-v2";

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
    const html = await file.blob.text();
    return new Response(injectBridge(html), {
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

function injectBridge(html) {
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
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${bridge}`);
  }
  return `${bridge}${html}`;
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
