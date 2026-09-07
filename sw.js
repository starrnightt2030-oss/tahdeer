/* عامل الخدمة — يجعل التطبيق يعمل بدون إنترنت بعد أول فتح */
const CACHE = 'tahdeer-v7';
const ASSETS = [
  './', './index.html',
  './css/app.css', './css/paper.css',
  './js/db.js', './js/schema.js', './js/icons.js', './js/zip.js', './js/docx.js',
  './js/pages.js', './js/gemini.js', './js/render.js',
  './js/sheet.js', './js/plan.js', './js/cover.js', './js/library.js', './js/app.js',
  './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* طلبات Gemini والخطوط لا تُخزَّن كملفات تطبيق */
  if (url.hostname.includes('generativelanguage')) return;

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        fetch(req).then(r => { if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r.clone())); }).catch(() => {});
        return hit;
      }
      return fetch(req)
        .then(r => {
          if (r && r.ok && url.origin === location.origin) {
            const cl = r.clone();
            caches.open(CACHE).then(c => c.put(req, cl));
          }
          return r;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
