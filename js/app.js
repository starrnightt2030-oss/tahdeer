/* =========================================================================
   app.js — منطق التطبيق
   ========================================================================= */
const LS = {
  key: 'thd.apiKey', model: 'thd.model', id: 'thd.identity',
  meta: 'thd.meta', last: 'thd.last'
};
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} }
};

/* النموذج المختار — يُعاد للافتراضي إن كان محفوظًا باسم لم يعد موجودًا */
function currentModel() {
  const m = store.get(LS.model, DEFAULT_MODEL);
  return GEMINI_MODELS.some(x => x.id === m) ? m : DEFAULT_MODEL;
}

const state = {
  meta: {},
  files: [],
  pages: [],
  data: null,
  zoom: null,               /* null = ملء العرض */
  id: Object.assign({}, IDENTITY_DEFAULT, store.get(LS.id, {}))
};

/* ---------------- أدوات واجهة ---------------- */
let toastT;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
}
function busy(on, msg) {
  $('#overlay').hidden = !on;
  if (msg) $('#overlayMsg').textContent = msg;
}
function setStatus(msg, err) {
  const s = $('#status');
  s.textContent = msg || '';
  s.className = 'status' + (err ? ' err' : '');
}

/* ---------------- 1) نموذج بيانات الحصة ---------------- */
function buildMetaForm() {
  const g = $('#metaGrid');
  const saved = store.get(LS.meta, {});
  g.innerHTML = '';
  META_FIELDS.forEach(f => {
    const lab = document.createElement('label');
    lab.className = 'field';
    lab.innerHTML = `<span>${f.label}${(f.req || f.type === 'select') ? '' : ' <em>(اختياري)</em>'}</span>`;
    let inp;
    if (f.type === 'select') {
      inp = document.createElement('select');
      inp.innerHTML = f.options.map(o => `<option value="${o.v}">${o.t}</option>`).join('');
      inp.value = (f.remember && saved[f.key]) || f.options[0].v;
    } else {
      inp = document.createElement('input');
      inp.type = f.type; inp.placeholder = f.ph || '';
      if (f.remember && saved[f.key]) inp.value = saved[f.key];
      if (f.key === 'date' && !inp.value) inp.value = new Date().toISOString().slice(0, 10);
    }
    inp.id = 'm_' + f.key;
    inp.addEventListener('input', () => inp.classList.remove('err'));
    lab.appendChild(inp);
    g.appendChild(lab);
  });
}

function readMeta() {
  const m = {};
  META_FIELDS.forEach(f => { m[f.key] = ($('#m_' + f.key).value || '').trim(); });
  m.hint = ($('#metaHint').value || '').trim();
  if (m.date) {
    const d = new Date(m.date + 'T00:00:00');
    m.dateText = toArabicDigits(
      d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
    );
  }
  const keep = {};
  META_FIELDS.filter(f => f.remember).forEach(f => { keep[f.key] = m[f.key]; });
  store.set(LS.meta, keep);
  return m;
}

function validateMeta(m) {
  let ok = true;
  META_FIELDS.filter(f => f.req).forEach(f => {
    if (!m[f.key]) { $('#m_' + f.key).classList.add('err'); ok = false; }
  });
  return ok;
}

/* ---------------- 2) الملفات ---------------- */
function addFiles(list) {
  const ok = [...list].filter(f =>
    (f.type || '').startsWith('image/') || (f.type || '').includes('pdf') || /\.pdf$/i.test(f.name));
  if (!ok.length) return toast('اختر ملف PDF أو صورًا فقط', true);
  ok.forEach(f => { if (!state.files.some(x => x.name === f.name && x.size === f.size)) state.files.push(f); });
  renderFiles();
}

function renderFiles() {
  const ul = $('#fileList');
  ul.innerHTML = '';
  state.files.forEach((f, i) => {
    const li = document.createElement('li');
    const isImg = (f.type || '').startsWith('image/');
    if (isImg) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.onload = () => URL.revokeObjectURL(img.src);
      li.appendChild(img);
    } else {
      const s = document.createElement('span');
      s.innerHTML = svgIcon('book', 22);
      li.appendChild(s);
    }
    const nm = document.createElement('span');
    nm.className = 'nm'; nm.textContent = f.name;
    const sz = document.createElement('span');
    sz.className = 'sz'; sz.textContent = (f.size / 1024 / 1024).toFixed(1) + ' م.ب';
    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '×'; rm.title = 'إزالة';
    rm.onclick = () => { state.files.splice(i, 1); renderFiles(); };
    li.append(nm, sz, rm);
    ul.appendChild(li);
  });
}

/* ---------------- 3) التوليد ---------------- */
async function generate() {
  const meta = readMeta();
  if (!validateMeta(meta)) { setStatus('أكمل الحقول المطلوبة أولًا', true); return; }
  if (!state.files.length) { setStatus('ارفع ملف الدرس أولًا', true); return; }
  const apiKey = store.get(LS.key, '');
  if (!apiKey) { setStatus('أدخل مفتاح Gemini من الإعدادات', true); openSettings(); return; }

  state.meta = meta;
  setStatus('');
  busy(true, 'جارٍ تجهيز صفحات الدرس…');

  try {
    state.pages = await filesToPages(state.files, m => busy(true, m));
    const data = await generateTahdeer({
      apiKey, model: currentModel(),
      pages: state.pages, meta, onProgress: m => busy(true, m)
    });
    busy(true, 'جارٍ قصّ الأشكال التوضيحية وتنسيق الورقة…');
    data.figures = buildFigures(data.figures, state.pages);
    state.data = data;
    store.set(LS.last, { data, meta, at: Date.now() });
    showResult();
    toast('تم إنشاء التحضير');
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'حدث خطأ غير متوقع', true);
    toast(e.message || 'حدث خطأ', true);
  } finally {
    busy(false);
  }
}

/* ---------------- 4) العرض والتحرير ---------------- */
function showResult() {
  const wrap = $('#resultWrap');
  wrap.hidden = false;
  const n = renderDocument($('#paper'), state.data, state.meta, state.id);
  bindEdits();
  fitPaper();
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus(`التحضير جاهز في ${toArabicDigits(n)} ${n === 1 ? 'صفحة' : 'صفحات'}`);
}

let reflowT;
function bindEdits() {
  $('#paper').querySelectorAll('[data-bind]').forEach(node => {
    node.addEventListener('input', () => {
      const p = node.dataset.bind;
      const v = node.innerText.trim();
      if (p.startsWith('meta.')) setPath(state.meta, p.slice(5), v);
      else setPath(state.data, p, v);
      store.set(LS.last, { data: state.data, meta: state.meta, at: Date.now() });
    });
    node.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text'));
    });
  });
  /* إعادة التقسيم عند الحاجة بعد توقّف الكتابة */
  $('#paper').addEventListener('input', () => {
    clearTimeout(reflowT);
    reflowT = setTimeout(() => {
      const over = [...$('#paper').querySelectorAll('.flow')].some(f => f.scrollHeight > f.clientHeight + 2);
      if (over) { const n = renderDocument($('#paper'), state.data, state.meta, state.id); bindEdits(); fitPaper(); }
    }, 900);
  });
}

/* ---------------- مقياس عرض الورقة ---------------- */
function fitScale() {
  const p = $('#paper');
  const pg = p.querySelector('.page');
  const pageW = pg ? pg.offsetWidth : 794;
  return Math.min(1, (p.parentElement.clientWidth - 2) / pageW);
}

function fitPaper() {
  const p = $('#paper');
  const box = p.parentElement;
  const pg = p.querySelector('.page');
  if (!pg) return;

  const pageW = pg.offsetWidth;          // 210mm بالبكسل
  const fit = fitScale();
  const s = state.zoom || fit;

  /* الحاوية تُقاس بعرض الصفحة الحقيقي، والتصغير من الزاوية العليا اليسرى */
  p.style.width = pageW + 'px';
  p.style.height = '';
  p.style.transform = (Math.abs(s - 1) > 0.001) ? `scale(${s})` : '';

  box.style.height = Math.ceil(p.scrollHeight * s) + 'px';
  box.style.overflowX = (s > fit + 0.001) ? 'auto' : 'hidden';

  const lvl = $('#btnZoomFit');
  if (lvl) lvl.textContent = state.zoom ? Math.round(s * 100) + '٪' : 'ملء العرض';
}

function setZoom(z) {
  const fit = fitScale();
  if (z == null) state.zoom = null;
  else state.zoom = Math.max(0.35, Math.min(2.5, z));
  fitPaper();
  if (state.zoom && state.zoom > fit) {
    /* عند التكبير ابدأ من أعلى يمين الورقة (اتجاه القراءة) */
    const box = $('#paper').parentElement;
    box.scrollLeft = box.scrollWidth;
  }
}

window.addEventListener('resize', () => { if (state.data) fitPaper(); });
window.addEventListener('orientationchange', () => { if (state.data) setTimeout(fitPaper, 250); });

/* ---------------- 5) الإعدادات ---------------- */
const ID_FIELDS = [
  { k: 'org',       l: 'اسم الجهة' },
  { k: 'dept1',     l: 'الإدارة العامة' },
  { k: 'dept2',     l: 'الإدارة / القسم' },
  { k: 'formCode',  l: 'رقم النموذج' },
  { k: 'edition',   l: 'الإصدار' },
  { k: 'revision',  l: 'التعديل' },
  { k: 'issueDate', l: 'تاريخ الإصدار' }
];

function buildSettings() {
  const sel = $('#modelSel');
  sel.innerHTML = GEMINI_MODELS.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
  sel.value = currentModel();
  $('#apiKey').value = store.get(LS.key, '');

  const g = $('#idGrid');
  g.innerHTML = '';
  ID_FIELDS.forEach(f => {
    const lab = document.createElement('label');
    lab.className = 'field';
    lab.innerHTML = `<span>${f.l}</span>`;
    const i = document.createElement('input');
    i.type = 'text'; i.id = 'id_' + f.k; i.value = state.id[f.k] || '';
    lab.appendChild(i); g.appendChild(lab);
  });

  const row = $('#logoRow');
  row.className = 'logo-row';
  row.innerHTML = `<div class="prev" id="logoPrev">${state.id.logo ? `<img src="${state.id.logo}">` : svgIcon('image', 22)}</div>`;
  const b = document.createElement('button');
  b.className = 'ghost'; b.textContent = 'رفع شعار الجهة';
  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = 'image/*'; fi.hidden = true;
  b.onclick = () => fi.click();
  fi.onchange = () => {
    const f = fi.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      state.id.logo = String(r.result);
      $('#logoPrev').innerHTML = `<img src="${state.id.logo}">`;
    };
    r.readAsDataURL(f);
  };
  row.append(b, fi);
}

function openSettings() { buildSettings(); $('#settingsBack').hidden = false; }
function closeSettings() { $('#settingsBack').hidden = true; }

function saveSettings() {
  store.set(LS.key, $('#apiKey').value.trim());
  store.set(LS.model, $('#modelSel').value);
  ID_FIELDS.forEach(f => { state.id[f.k] = ($('#id_' + f.k).value || '').trim(); });
  store.set(LS.id, state.id);
  closeSettings();
  toast('تم حفظ الإعدادات');
  if (state.data) showResult();
}

/* ---------------- 6) التصدير ---------------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

function fileBase() {
  const t = (state.data && state.data.lessonTitle) || 'تحضير';
  return `تحضير - ${t}`.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
}

function doPrint() {
  const p = $('#paper'), box = p.parentElement;
  const st = { t: p.style.transform, w: p.style.width, h: box.style.height, o: box.style.overflowX };
  p.style.transform = ''; p.style.width = '';
  box.style.height = ''; box.style.overflowX = '';
  window.print();
  setTimeout(() => {
    p.style.transform = st.t; p.style.width = st.w;
    box.style.height = st.h; box.style.overflowX = st.o;
  }, 600);
}

/* ---------------- تحضير درس جديد ---------------- */
function newLesson() {
  if (state.data && !confirm('سيتم إخلاء التحضير الحالي والملفات المرفوعة للبدء من جديد.\nتأكد أنك حفظت النسخة (PDF أو Word) قبل المتابعة. متابعة؟')) return;

  state.files = []; state.pages = []; state.data = null; state.zoom = null;
  store.del(LS.last);
  renderFiles();
  $('#paper').innerHTML = '';
  $('#resultWrap').hidden = true;
  $('#metaHint').value = '';

  /* الحقول المتكرّرة تبقى، والخاصة بالدرس تُخلى */
  META_FIELDS.forEach(f => {
    const inp = $('#m_' + f.key);
    if (!inp || f.remember) return;
    if (f.key === 'date') inp.value = new Date().toISOString().slice(0, 10);
    else inp.value = '';
    inp.classList.remove('err');
  });

  setStatus('جاهز لتحضير درس جديد — أدخل رقم الدرس وارفع صفحاته');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const first = $('#m_lessonNo'); if (first) setTimeout(() => first.focus(), 400);
}

function doWord() {
  try {
    const blob = buildDocx(state.data, state.meta, state.id);
    download(blob, fileBase() + '.docx');
    toast('تم تنزيل ملف Word');
  } catch (e) {
    console.error(e); toast('تعذّر إنشاء ملف Word', true);
  }
}

/* ---------------- 7) التثبيت كتطبيق ---------------- */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e; $('#btnInstall').hidden = false;
});
window.addEventListener('appinstalled', () => { $('#btnInstall').hidden = true; });

/* ---------------- 8) الربط ---------------- */
function init() {
  buildMetaForm();

  const drop = $('#dropZone'), fi = $('#fileInput'), cam = $('#cameraInput');
  drop.onclick = () => fi.click();
  $('#btnPick').onclick = () => fi.click();
  $('#btnCamera').onclick = () => cam.click();
  fi.onchange = () => { addFiles(fi.files); fi.value = ''; };
  cam.onchange = () => { addFiles(cam.files); cam.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  $('#btnGenerate').onclick = generate;
  $('#btnRegen').onclick = generate;
  $('#btnPrint').onclick = doPrint;
  $('#btnWord').onclick = doWord;
  $('#btnNew').onclick = newLesson;
  $('#btnZoomIn').onclick = () => setZoom((state.zoom || fitScale()) + 0.2);
  $('#btnZoomOut').onclick = () => setZoom((state.zoom || fitScale()) - 0.2);
  $('#btnZoomFit').onclick = () => setZoom(null);

  $('#btnSettings').onclick = openSettings;
  $('#btnCloseSettings').onclick = closeSettings;
  $('#settingsBack').addEventListener('click', e => { if (e.target.id === 'settingsBack') closeSettings(); });
  $('#btnSaveSettings').onclick = saveSettings;
  $('#btnReset').onclick = () => {
    if (!confirm('سيتم مسح المفتاح والبيانات المحفوظة على هذا الجهاز. متابعة؟')) return;
    Object.values(LS).forEach(store.del);
    location.reload();
  };
  $('#btnInstall').onclick = async () => {
    if (!deferredPrompt) return toast('استخدم قائمة المتصفح ← «تثبيت التطبيق»');
    deferredPrompt.prompt(); await deferredPrompt.userChoice;
    deferredPrompt = null; $('#btnInstall').hidden = true;
  };

  /* استعادة آخر تحضير */
  const last = store.get(LS.last, null);
  if (last && last.data) {
    state.data = last.data; state.meta = last.meta || {};
    META_FIELDS.forEach(f => { if (state.meta[f.key] && $('#m_' + f.key)) $('#m_' + f.key).value = state.meta[f.key]; });
    showResult();
    setStatus('تم استرجاع آخر تحضير — يمكنك التعديل أو توليد تحضير جديد');
  }

  if (!store.get(LS.key, '')) setTimeout(openSettings, 600);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
