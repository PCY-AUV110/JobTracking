const CACHE_NAME = "offerflow-v38-resume-center-pdf-fix";
const ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./admin.js", "./supabase-config.js", "./manifest.json", "./logo.svg"];

self.addEventListener("install", event => {
  // 跳过预缓存，避免把旧资源写入新缓存
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  // 激活时清除所有旧缓存（包括同名之外的，以及上一次预缓存的旧资源）
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  // 立即接管所有客户端
  self.clients.claim();
});

// 统一采用 network-first 策略：所有资源都优先从网络获取最新版本
// 仅在网络不可用时才回退到缓存。这样每次刷新都能拿到最新代码。
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  // 跳过非 GET 请求和跨域请求
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // 网络优先：先尝试从网络获取
  event.respondWith(
    fetch(req)
      .then(resp => {
        // 成功则把响应复制一份写入缓存
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return resp;
      })
      .catch(() => {
        // 网络失败时回退到缓存
        return caches.match(req).then(cached => cached || caches.match("./index.html"));
      })
  );
});
