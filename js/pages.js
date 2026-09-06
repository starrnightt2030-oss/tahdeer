/* =========================================================================
   pages.js — تحويل ملفات الدرس (PDF / صور) إلى صور صفحات في الذاكرة
   ثم قصّ الأشكال التوضيحية منها حسب إحداثيات يرجعها النموذج.
   ========================================================================= */

let _pdfjs = null;
async function pdfLib() {
  if (_pdfjs) return _pdfjs;
  const base = document.baseURI;
  const m = await import(new URL('vendor/pdf.min.mjs', base).href);
  m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', base).href;
  _pdfjs = m;
  return m;
}

const MAX_SIDE = 1600;     // أقصى بُعد للصورة المرسلة للنموذج
const MAX_PAGES = 8;

function canvasFromImage(img) {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('تعذّر فتح الصورة'));
    i.src = src;
  });
}

/** يحوّل قائمة الملفات إلى [{canvas, dataUrl}] */
async function filesToPages(files, onProgress) {
  const out = [];
  for (const f of files) {
    if (out.length >= MAX_PAGES) break;

    if ((f.type || '').startsWith('image/')) {
      onProgress && onProgress(`تجهيز الصورة: ${f.name}`);
      const url = URL.createObjectURL(f);
      try {
        const img = await loadImage(url);
        out.push(canvasFromImage(img));
      } finally { URL.revokeObjectURL(url); }

    } else if ((f.type || '').includes('pdf') || /\.pdf$/i.test(f.name)) {
      onProgress && onProgress('قراءة صفحات ملف PDF…');
      const pdfjs = await pdfLib();
      const buf = await f.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const n = Math.min(doc.numPages, MAX_PAGES - out.length);
      for (let p = 1; p <= n; p++) {
        onProgress && onProgress(`تحويل صفحة ${p} من ${doc.numPages}…`);
        const page = await doc.getPage(p);
        const v1 = page.getViewport({ scale: 1 });
        const scale = Math.min(2.2, MAX_SIDE / Math.max(v1.width, v1.height));
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        out.push(c);
      }
    }
  }
  if (!out.length) throw new Error('لم يتم العثور على صفحات صالحة في الملفات المرفوعة.');
  return out;
}

/** يقصّ منطقة من صفحة حسب box_2d القادم من النموذج (قيم 0..1000: y1,x1,y2,x2) */
function cropFromPage(canvas, box, pad) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const [y1, x1, y2, x2] = box.map(Number);
  const P = pad == null ? 0.012 : pad;
  let l = Math.max(0, (Math.min(x1, x2) / 1000 - P)) * canvas.width;
  let t = Math.max(0, (Math.min(y1, y2) / 1000 - P)) * canvas.height;
  let r = Math.min(1, (Math.max(x1, x2) / 1000 + P)) * canvas.width;
  let b = Math.min(1, (Math.max(y1, y2) / 1000 + P)) * canvas.height;
  const w = Math.round(r - l), h = Math.round(b - t);
  if (w < 40 || h < 30) return null;

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(canvas, Math.round(l), Math.round(t), w, h, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.88);
}

/** يبني الأشكال النهائية من مخرجات النموذج */
function buildFigures(rawFigures, pages) {
  const out = [];
  (rawFigures || []).forEach(f => {
    const pi = Math.max(0, Math.min(pages.length - 1, (parseInt(f.page, 10) || 1) - 1));
    const src = cropFromPage(pages[pi], f.box_2d);
    if (src) out.push({ caption: f.caption || 'الرسم التوضيحي', src });
  });
  return out;
}

function canvasToPart(canvas) {
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { inline_data: { mime_type: 'image/jpeg', data: url.split(',')[1] } };
}
