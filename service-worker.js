const CACHE_NAME = "offerflow-v4-logo-70";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./supabase-config.js", "./manifest.json", "./logo.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// 采用 stale-while-revalidate 策略：
// 1) 对 HTML 页面使用 network-first，确保用户始终拿到最新版本
// 2) 对静态资源（css/js/svg/png）使用 cache-first，加速加载
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  // 跳过非 GET 请求和跨域请求
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // HTML 页面：网络优先，失败才回退缓存
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }

  // 其他资源：缓存优先，后台更新
  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req)
        .then(resp => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
