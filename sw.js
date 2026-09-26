/* عامل الخدمة — يجعل التطبيق يعمل بدون إنترنت بعد أول فتح */
const CACHE = 'tahdeer-v15-flat';
const ASSETS = [
  './', './index.html',
  './tahdeer.css', './tahdeer.js',
  './pdf.min.mjs', './pdf.worker.min.mjs',
  './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];

/* لا نستدعي skipWaiting هنا عمدًا: النسخة الجديدة تنتظر حتى يضغط المدرّس
   «حدّث الآن»، فلا يُسحب التطبيق من تحته وهو في منتصف تحضير درس. */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
  );
});

/* الصفحة تطلب التفعيل عند ضغط زر التحديث */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
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
