const CACHE_VERSION = "20260317a";
const STATIC_CACHE = `roster-export-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `roster-export-runtime-${CACHE_VERSION}`;

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.mjs?v=20260317a",
  "./rosterParser.mjs",
  "./dta.mjs",
  "./manifest.webmanifest?v=20260317a",
  "./calendar-icon.svg",
  "./calendar-icon.svg?v=20260317a",
  "./calendar-icon-180.png",
  "./calendar-icon-180.png?v=20260317a",
  "./calendar-icon-192.png",
  "./calendar-icon-512.png",
];

const CDN_ASSETS = [
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs",
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll(CORE_ASSETS);

      const runtimeCache = await caches.open(RUNTIME_CACHE);
      await Promise.allSettled(
        CDN_ASSETS.map(async (url) => {
          const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" });
          if (response.ok || response.type === "opaque") {
            await runtimeCache.put(url, response.clone());
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== RUNTIME_CACHE) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    const runtimeCache = await caches.open(RUNTIME_CACHE);
    await runtimeCache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (response.ok || response.type === "opaque") {
        const runtimeCache = await caches.open(RUNTIME_CACHE);
        await runtimeCache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const fresh = await fetchPromise;
  if (fresh) {
    return fresh;
  }

  throw new Error("Request failed and no cache entry found");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCdnAsset = url.origin === "https://cdn.jsdelivr.net";

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const runtimeCache = await caches.open(RUNTIME_CACHE);
          await runtimeCache.put(request, networkResponse.clone());
          return networkResponse;
        } catch {
          return (await caches.match(request)) || (await caches.match("./index.html")) || (await caches.match("./"));
        }
      })()
    );
    return;
  }

  if (isCdnAsset) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isSameOrigin) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
