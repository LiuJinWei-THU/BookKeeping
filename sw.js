/* Service Worker：本站静态资源离线缓存（CDN 资源走网络，由浏览器自行缓存） */
const VERSION = 'ledger-v1.0.0';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/categories.js',
  './js/store.js',
  './js/parser.js',
  './js/ocr.js',
  './js/aiocr.js',
  './js/charts.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 仅处理同源导航与静态资源；API/CDN 请求直接放行
  if (url.origin !== self.location.origin) return;

  // 网络优先：保证发版后用户立即拿到新代码；离线时回退缓存
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true }).then(cached => cached ||
        (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    )
  );
});
