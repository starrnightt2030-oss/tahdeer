/* =========================================================================
   app.js — منطق التطبيق
   ========================================================================= */
const LS = {
  key: 'thd.apiKey', model: 'thd.model', id: 'thd.identity',
  meta: 'thd.meta', pmeta: 'thd.pmeta', last: 'thd.last',
  plan: 'thd.plan', planRows: 'thd.planRows', cover: 'thd.cover'
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
  mode: 'prep',             /* prep | plan | cover */
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

/* ---------------- نموذج حقول عام ---------------- */
function buildForm(containerSel, fields, prefix, savedKey) {
  const g = $(containerSel);
  const saved = store.get(savedKey, {});
  g.innerHTML = '';
  fields.forEach(f => {
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
      if (f.remember && saved[f.key] != null) inp.value = saved[f.key];
      if (f.key === 'startDate' && !inp.value) inp.value = new Date().toISOString().slice(0, 10);
      if (f.key === 'weeks' && !inp.value) inp.value = 15;
    }
    inp.id = prefix + f.key;
    inp.addEventListener('input', () => inp.classList.remove('err'));
    lab.appendChild(inp);
    g.appendChild(lab);
  });
}

function readForm(fields, prefix, savedKey) {
  const m = {};
  fields.forEach(f => { const e = $(prefix + f.key); m[f.key] = e ? (e.value || '').trim() : ''; });
  if (savedKey) {
    const keep = store.get(savedKey, {});
    fields.filter(f => f.remember).forEach(f => { keep[f.key] = m[f.key]; });
    store.set(savedKey, keep);
  }
  return m;
}

function validateForm(fields, prefix, m) {
  let ok = true;
  fields.filter(f => f.req).forEach(f => {
    if (!m[f.key]) { const e = $(prefix + f.key); if (e) e.classList.add('err'); ok = false; }
  });
  return ok;
}

/* ---------------- 1) نموذج بيانات الحصة ---------------- */
/* حقول القسم الحالي: النظري أم العملي */
function metaFields() {
  return (state.mode === 'prac') ? PRAC_FIELDS : META_FIELDS;
}
function isPrac() { return state.mode === 'prac'; }

function buildMetaForm() {
  const g = $('#metaGrid');
  const saved = store.get(isPrac() ? LS.pmeta : LS.meta, {});
  g.innerHTML = '';
  $('#cardMetaTitle').textContent = isPrac() ? 'بيانات جلسة التدريب' : 'بيانات الحصة';
  $('#metaHint').placeholder = isPrac()
    ? 'مثال: التمرين يُنفّذ في مجموعتين، أو ركّز على القياس'
    : 'مثال: ركّز على التطبيق العملي، أو الدرس يُشرح في حصتين';
  metaFields().forEach(f => {
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
  metaFields().forEach(f => { const e = $('#m_' + f.key); if (e) m[f.key] = (e.value || '').trim(); });
  m.hint = ($('#metaHint').value || '').trim();
  if (m.date) {
    const d = new Date(m.date + 'T00:00:00');
    m.dateText = toArabicDigits(
      d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
    );
  }
  const keep = {};
  metaFields().filter(f => f.remember).forEach(f => { keep[f.key] = m[f.key]; });
  store.set(isPrac() ? LS.pmeta : LS.meta, keep);
  return m;
}

function validateMeta(m) {
  let ok = true;
  metaFields().filter(f => f.req).forEach(f => {
    const e = $('#m_' + f.key);
    if (e && !m[f.key]) { e.classList.add('err'); ok = false; }
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
  if (!state.files.length) {
    setStatus(isPrac() ? 'ارفع صفحات الموضوع العملي أولًا' : 'ارفع ملف الدرس أولًا', true); return;
  }
  const apiKey = store.get(LS.key, '');
  if (!apiKey) { setStatus('أدخل مفتاح Gemini من الإعدادات', true); openSettings(); return; }

  state.meta = meta;
  setStatus('');
  busy(true, isPrac() ? 'جارٍ تجهيز صفحات الموضوع…' : 'جارٍ تجهيز صفحات الدرس…');

  try {
    state.pages = await filesToPages(state.files, m => busy(true, m));
    const data = await generateTahdeer({
      apiKey, model: currentModel(), kind: isPrac() ? 'prac' : 'prep',
      pages: state.pages, meta, onProgress: m => busy(true, m)
    });
    busy(true, 'جارٍ قصّ الأشكال التوضيحية وتنسيق الورقة…');
    data.figures = buildFigures(data.figures, state.pages);
    state.data = data;
    await saveLesson();
    showResult();
    await draftClear();
    toast(isPrac() ? 'تم إنشاء تحضير التدريب العملي وحفظه' : 'تم إنشاء التحضير وحفظه في المادة');
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
  const n = (state.mode === 'prac')
    ? renderPractical($('#paper'), state.data, state.meta, state.id)
    : renderDocument($('#paper'), state.data, state.meta, state.id);
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
      clearTimeout(bindEdits._sv);
      bindEdits._sv = setTimeout(saveLesson, 1200);
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

/* ---------------- الوظائف الثلاث ---------------- */
const MODE_TITLE = { prep: 'تحضير نظري وفق النموذج المعتمد',
  prac: 'تحضير تدريب عملي وفق النموذج المعتمد',
  plan: 'الخطة الزمنية للفصل الدراسي', cover: 'غلاف المادة' };

/* مقاس الورق تحدده الصفحات المسمّاة في paper.css:
   .page → @page pv (عمودي) و .page.land → @page ls (عرضي).
   ممنوع حقن قاعدة @page عامة هنا — وجودها يُلغي أثر الصفحات المسمّاة
   فتُطبع الخطة العرضية على ورق عمودي داخل ملف الترم. */
function setPageSize() { /* لا شيء — محفوظة للتوافق */ }

function setMode(m, skipLoad) {
  state.mode = m;
  /* النظري والعملي يتشاركان نفس الواجهة (#modePrep) بحقول مختلفة */
  $('#modePrep').hidden = !(m === 'prep' || m === 'prac');
  ['plan', 'cover'].forEach(k => {
    const sec = $('#mode' + k[0].toUpperCase() + k.slice(1));
    if (sec) sec.hidden = (k !== m);
  });
  if (m === 'prep' || m === 'prac') {
    buildMetaForm();
    $('#cardFilesTitle').textContent = (m === 'prac') ? 'صفحات الموضوع العملي' : 'ملف الدرس';
    state.files = []; renderFiles();
  }
  document.querySelectorAll('#tabs .tab').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  const sub = document.querySelector('.brand-txt span');
  if (sub) sub.textContent = MODE_TITLE[m];

  /* أزرار شريط الأدوات حسب الوظيفة */
  document.querySelectorAll('.only-prep').forEach(e => { e.hidden = !(m === 'prep' || m === 'prac'); });
  document.querySelectorAll('.only-doc').forEach(e => { e.hidden = (m === 'cover'); });

  /* كل وظيفة لها معاينتها — نُخلي الورقة عند التبديل */
  $('#paper').innerHTML = '';
  $('#resultWrap').hidden = true;
  setPageSize(m === 'plan');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (typeof setTopbar === 'function') setTopbar();
  if (!skipLoad) loadSection(m);
}

/* ---------------- فتح قسم داخل المادة ---------------- */
async function openWork(mode, lessonId) {
  Lib.lessonId = lessonId || null;
  await go('work');
  setMode(mode, true);
  await loadSection(mode);
}

/* يجهّز القسم من بيانات المادة والمكتبة */
async function loadSection(mode) {
  const sub = Lib.subject;
  if (!sub) return;
  const teacher = await DB.get('teacher', '');

  if (mode === 'prep' || mode === 'prac') {
    /* الحقول المشتركة من المادة */
    const pre = { subject: sub.name, grade: sub.grade, dept: sub.dept, teacher };
    Object.keys(pre).forEach(k => { const e = $('#m_' + k); if (e && !e.value) e.value = pre[k] || ''; });
    if (Lib.lessonId) {
      const les = await DB.lesson(Lib.lessonId);
      if (les) {
        state.data = les.data; state.meta = les.meta || {};
        metaFields().forEach(f => { const e = $('#m_' + f.key); if (e && state.meta[f.key] != null) e.value = state.meta[f.key]; });
        state.files = []; renderFiles();
        showResult();
        setStatus(mode === 'prac' ? 'موضوع محفوظ — عدّل ما تشاء أو اطبعه'
                                  : 'درس محفوظ — عدّل ما تشاء أو اطبعه');
        return;
      }
    }
    /* جديد: الرقم التالي داخل نفس النوع تلقائيًا */
    const ls = (await DB.lessons(sub.id)).filter(l => (l.kind || 'prep') === mode);
    const nextNo = ls.reduce((m, l) => Math.max(m, parseInt(l.lessonNo, 10) || 0), 0) + 1;
    if ($('#m_lessonNo') && !$('#m_lessonNo').value) $('#m_lessonNo').value = nextNo;
    state.data = null; state.files = []; renderFiles();
    setStatus('');
  }

  if (mode === 'plan') {
    const doc = await DB.doc('plan', sub.id);
    const base = { subject: sub.name, grade: sub.grade, dept: sub.dept, teacher,
      year: sub.year, term: sub.term };
    const m = doc ? Object.assign({}, base, doc.payload.meta) : base;
    PLAN_FIELDS.forEach(f => { const e = $('#p_' + f.key); if (e && m[f.key]) e.value = m[f.key]; });
    plan.meta = readForm(PLAN_FIELDS, '#p_', null);
    plan.rows = (doc && doc.payload.rows) ? doc.payload.rows : plan.rows;
    planEnsureRows(plan.meta.weeks);
    planRenderEditor();
    if (doc) makePlan();
  }

  if (mode === 'cover') {
    const doc = await DB.doc('cover', sub.id);
    const base = { subject: sub.name, grade: sub.grade, dept: sub.dept, teacher,
      year: sub.year, term: sub.term };
    const m = Object.assign({}, base, doc ? doc.payload : {});
    COVER_FIELDS.forEach(f => { const e = $('#c_' + f.key); if (e && m[f.key]) e.value = m[f.key]; });
    if (doc) makeCover();
  }
}

/* ---------------- حفظ الأقسام في المكتبة ---------------- */
async function saveLesson() {
  if (!Lib.subject || !state.data) return;
  const prac = (state.mode === 'prac');
  const rec = {
    subjectId: Lib.subject.id,
    kind: prac ? 'prac' : 'prep',
    lessonNo: state.meta.lessonNo || '',
    title: (prac ? state.data.topicTitle : state.data.lessonTitle) || '',
    meta: state.meta, data: state.data
  };
  if (Lib.lessonId) rec.id = Lib.lessonId;
  const saved = await DB.lessonSave(rec);
  Lib.lessonId = saved.id;
  renderBackupBar();
}

/* ---------- الخطة الزمنية ---------- */
function planSync() {
  plan.meta = readForm(PLAN_FIELDS, '#p_', LS.plan);
  planEnsureRows(plan.meta.weeks);
  planRenderEditor();
  store.set(LS.planRows, plan.rows);
}

function buildPlanUI() {
  buildForm('#planGrid', PLAN_FIELDS, '#p_'.slice(1), LS.plan);
  const saved = store.get(LS.planRows, null);
  if (Array.isArray(saved) && saved.length) plan.rows = saved;
  plan.meta = readForm(PLAN_FIELDS, '#p_', null);
  planEnsureRows(plan.meta.weeks);
  planRenderEditor();
  ['weeks', 'startDate'].forEach(k => {
    const e = $('#p_' + k);
    if (e) e.addEventListener('change', planSync);
    if (e) e.addEventListener('input', () => { clearTimeout(planSync._t); planSync._t = setTimeout(planSync, 400); });
  });
}

function makePlan() {
  plan.meta = readForm(PLAN_FIELDS, '#p_', LS.plan);
  const st = $('#planStatus');
  if (!validateForm(PLAN_FIELDS, '#p_', plan.meta)) {
    st.textContent = 'أكمل الحقول المطلوبة أولًا'; st.className = 'status err'; return;
  }
  planEnsureRows(plan.meta.weeks);
  store.set(LS.planRows, plan.rows);
  const filled = plan.rows.filter(r => r.items.some(i => (i.name || '').trim())).length;
  if (!filled) {
    st.textContent = 'اكتب اسم درس واحد على الأقل في محتوى الأسابيع'; st.className = 'status err'; return;
  }
  $('#resultWrap').hidden = false;
  state.zoom = null;
  const n = renderPlan($('#paper'), plan, state.id);
  bindPlainEdits();
  fitPaper();
  $('#resultWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  st.textContent = `الخطة جاهزة في ${toArabicDigits(n)} ${n === 1 ? 'صفحة' : 'صفحات'}`;
  st.className = 'status';
  if (Lib.subject) { DB.docSave('plan', Lib.subject.id, { meta: plan.meta, rows: plan.rows }).then(renderBackupBar); }
}

/* ---------- غلاف المادة ---------- */
function buildCoverUI() { buildForm('#coverGrid', COVER_FIELDS, '#c_'.slice(1), LS.cover); }

function makeCover() {
  const m = readForm(COVER_FIELDS, '#c_', LS.cover);
  const st = $('#coverStatus');
  if (!validateForm(COVER_FIELDS, '#c_', m)) {
    st.textContent = 'أكمل الحقول المطلوبة أولًا'; st.className = 'status err'; return;
  }
  state.cover = m;
  $('#resultWrap').hidden = false;
  state.zoom = null;
  renderCover($('#paper'), m, state.id);
  bindPlainEdits();
  fitPaper();
  $('#resultWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  st.textContent = 'الغلاف جاهز — يمكنك تعديل أي نص عليه قبل الطباعة';
  st.className = 'status';
  if (Lib.subject) { DB.docSave('cover', Lib.subject.id, m).then(renderBackupBar); }
}

/* تحرير حر داخل الخطة/الغلاف (بدون ربط ببيانات) */
function bindPlainEdits() {
  $('#paper').querySelectorAll('[contenteditable]').forEach(n => {
    n.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text'));
    });
  });
}

/* ---------------- ملف الترم الكامل ---------------- */
async function printTerm() {
  const sub = Lib.subject;
  if (!sub) return;
  busy(true, 'جارٍ تجهيز ملف الترم…');
  try {
    const [cover, planDoc, lessons] = await Promise.all([
      DB.doc('cover', sub.id), DB.doc('plan', sub.id), DB.lessons(sub.id)
    ]);
    const teacher = await DB.get('teacher', '');
    const paper = $('#paper');
    paper.innerHTML = '';
    state.mode = 'term';
    state.zoom = null;
    setPageSize(false);                       /* الأساس عمودي، والخطة تأخذ صفحتها العرضية */
    document.querySelectorAll('.only-prep,.only-doc').forEach(e => { e.hidden = true; });
    $('#resultWrap').hidden = false;

    /* حاوية قياس داخل الصفحة — بدونها تكون الأبعاد صفرًا فلا يحدث ترقيم صحيح */
    const tmp = el('div', 'paper');
    tmp.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
    document.body.appendChild(tmp);

    if (cover) {
      renderCover(tmp, cover.payload, state.id);
      while (tmp.firstChild) paper.appendChild(tmp.firstChild);
    }
    if (planDoc) {
      const pm = Object.assign({ teacher }, planDoc.payload.meta || {});
      renderPlan(tmp, { meta: pm, rows: planDoc.payload.rows || [] }, state.id);
      while (tmp.firstChild) paper.appendChild(tmp.firstChild);
    }
    /* الدروس النظرية أولًا ثم مواضيع التدريب العملي */
    const ordered = lessons.slice().sort((a, b) =>
      ((a.kind || 'prep') === (b.kind || 'prep')) ? 0 : ((a.kind || 'prep') === 'prep' ? -1 : 1));
    for (const les of ordered) {
      const meta = Object.assign({ teacher }, les.meta || {});
      if ((les.kind || 'prep') === 'prac') renderPractical(tmp, les.data, meta, state.id);
      else renderDocument(tmp, les.data, meta, state.id);
      while (tmp.firstChild) paper.appendChild(tmp.firstChild);
    }

    tmp.remove();
    const n = paper.querySelectorAll('.page').length;
    if (!n) { toast('لا يوجد ما يُطبع في هذه المادة', true); return; }
    bindPlainEdits();
    fitPaper();
    $('#resultWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(`ملف الترم جاهز: ${toArabicDigits(n)} صفحة — اضغط طباعة/حفظ PDF`);
  } catch (e) {
    console.error(e); toast('تعذّر تجهيز ملف الترم', true);
  } finally { busy(false); }
}

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

async function openSettings() {
  buildSettings();
  $('#setTeacher').value = await DB.get('teacher', '');
  await renderStorageBox();
  $('#settingsBack').hidden = false;
}

/* صندوق حالة التخزين والنسخ الاحتياطي داخل الإعدادات */
async function renderStorageBox() {
  const b = $('#storeBox');
  const u = await Persist.usage();
  const mb = v => (v / 1048576).toFixed(v > 10485760 ? 0 : 1) + ' م.ب';
  const persistTxt = Persist.state === 'granted'
    ? '<b class="g">مُفعَّل ✓</b> — المتصفح لن يحذف شغلك تلقائيًا'
    : (Persist.state === 'unsupported'
      ? '<b class="w">غير مدعوم في هذا المتصفح</b>'
      : '<b class="w">غير مُفعَّل</b> — ثبّت التطبيق على الشاشة الرئيسية ليُفعَّل');
  const bkTxt = {
    ready: '<b class="g">مُفعَّل ✓</b>' + (Backup.lastAt ? ' — آخر نسخة ' + new Date(Backup.lastAt).toLocaleString('ar-EG') : ''),
    needPermission: '<b class="w">يحتاج تأكيد الإذن</b>',
    error: '<b class="r">تعذّر الكتابة</b> — ' + escHtml(Backup.lastError || ''),
    unsupported: '<b class="w">غير مدعوم</b> — استخدم التصدير اليدوي',
    off: '<b class="w">غير مُفعَّل</b> — شغلك على هذا الجهاز فقط'
  }[Backup.status] || '';

  b.innerHTML =
    `<div class="sr"><span>التخزين الدائم</span><div>${persistTxt}</div></div>` +
    `<div class="sr"><span>نسخة احتياطية تلقائية</span><div>${bkTxt}</div></div>` +
    (u ? `<div class="sr"><span>المستخدم من مساحة الجهاز</span><div><b>${mb(u.used)}</b>${u.quota ? ' من ' + mb(u.quota) : ''}</div></div>` : '');

  const row = el('div', 'store-btns');
  const mk = (label, cls, fn) => { const x = el('button', cls, label); x.onclick = fn; return x; };
  if (Backup.status === 'ready') {
    row.appendChild(mk('نسخ الآن', 'ghost', async () => { await Backup.run(true); await renderStorageBox(); renderBackupBar(); toast('تم تحديث النسخة'); }));
    row.appendChild(mk('تغيير المجلد', 'ghost', async () => { try { await Backup.choose(); } catch (_) {} await renderStorageBox(); renderBackupBar(); }));
    row.appendChild(mk('إيقاف', 'ghost danger', async () => { await Backup.disable(); await renderStorageBox(); renderBackupBar(); }));
  } else if (Backup.supported()) {
    row.appendChild(mk(Backup.status === 'needPermission' ? 'تأكيد الإذن' : 'اختيار مجلد النسخ', 'primary',
      async () => { await backupAction(); await renderStorageBox(); }));
  }
  row.appendChild(mk('تصدير نسخة', 'ghost', exportBackup));
  row.appendChild(mk('استيراد نسخة', 'ghost', importBackup));
  b.appendChild(row);
}
function closeSettings() { $('#settingsBack').hidden = true; }

async function saveSettings() {
  store.set(LS.key, $('#apiKey').value.trim());
  store.set(LS.model, $('#modelSel').value);
  ID_FIELDS.forEach(f => { state.id[f.k] = ($('#id_' + f.k).value || '').trim(); });
  store.set(LS.id, state.id);
  await DB.set('identity', state.id);
  await DB.set('teacher', ($('#setTeacher').value || '').trim());
  closeSettings();
  toast('تم حفظ الإعدادات');
  if (state.data && Lib.screen === 'work') showResult();
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
  let t;
  if (state.mode === 'plan') t = 'الخطة الزمنية - ' + (plan.meta.subject || '');
  else if (state.mode === 'cover') t = 'غلاف - ' + ((state.cover || {}).subject || '');
  else t = 'تحضير - ' + ((state.data && state.data.lessonTitle) || '');
  return t.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80);
}

function doPrint() {
  const p = $('#paper'), box = p.parentElement;
  /* اسم صفحة الجذر = نوع أول ورقة، وإلا خرجت صفحة فارغة في البداية */
  const first = p.querySelector('.page');
  document.documentElement.classList.toggle('first-land', !!(first && first.classList.contains('land')));
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
  state.files = []; state.pages = []; state.data = null; state.zoom = null;
  Lib.lessonId = null;
  renderFiles();
  $('#paper').innerHTML = '';
  $('#resultWrap').hidden = true;
  $('#metaHint').value = '';

  /* الحقول المتكرّرة تبقى، والخاصة بالدرس تُخلى */
  metaFields().forEach(f => {
    const inp = $('#m_' + f.key);
    if (!inp || f.remember) return;
    if (f.key === 'date') inp.value = new Date().toISOString().slice(0, 10);
    else inp.value = '';
    inp.classList.remove('err');
  });

  setStatus('جاهز لتحضير درس جديد — أدخل رقم الدرس وارفع صفحاته');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadSection('prep');
}

function doWord() {
  try {
    const blob = (state.mode === 'plan') ? buildPlanDocx(plan, state.id)
      : (state.mode === 'prac') ? buildPracDocx(state.data, state.meta, state.id)
      : buildDocx(state.data, state.meta, state.id);
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

  buildPlanUI();
  buildCoverUI();
  bindCamera();
  bindDraft();
  document.querySelectorAll('#tabs .tab').forEach(b => {
    b.onclick = () => setMode(b.dataset.mode);
  });
  $('#btnPlan').onclick = makePlan;
  $('#btnCover').onclick = makeCover;

  /* ---- المكتبة ---- */
  $('#btnBack').onclick = () => {
    if (Lib.screen === 'work') go('subject', Lib.subject && Lib.subject.id);
    else go('library');
  };
  $('#btnAddSubj').onclick = () => subjectDialog(null);
  $('#btnEditSubj').onclick = () => subjectDialog(Lib.subject);
  $('#btnDelSubj').onclick = async () => {
    const s = Lib.subject; if (!s) return;
    const ok = await ask(
      `حذف مادة «${s.name}» بكل دروسها وغلافها وخطتها نهائيًا؟ لا يمكن الرجوع في هذا.`,
      { title: 'حذف مادة' });
    if (ok !== true) return;
    if (!await tryDo(() => DB.subjectDelete(s.id), 'تم حذف المادة')) return;
    go('library');
  };
  $('#btnNewLesson').onclick = () => openWork('prep');
  $('#btnNewPrac').onclick   = () => openWork('prac');
  $('#btnTerm').onclick = printTerm;
  $('#btnExport').onclick = exportBackup;
  $('#btnImport').onclick = importBackup;
  $('#subjDlg').addEventListener('click', e => { if (e.target.id === 'subjDlg') $('#subjDlg').hidden = true; });

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
  $('#btnReset').onclick = async () => {
    const ok = await ask('سيتم مسح المفتاح والإعدادات المحفوظة على هذا الجهاز. متابعة؟',
      { title: 'مسح الإعدادات', yes: 'مسح' });
    if (ok !== true) return;
    Object.values(LS).forEach(store.del);
    location.reload();
  };
  $('#btnInstall').onclick = async () => {
    if (!deferredPrompt) return toast('استخدم قائمة المتصفح ← «تثبيت التطبيق»');
    deferredPrompt.prompt(); await deferredPrompt.userChoice;
    deferredPrompt = null; $('#btnInstall').hidden = true;
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  boot();
}

/* ---------------- التهيئة غير المتزامنة ---------------- */
async function boot() {
  try {
    await dbOpen();
    await Persist.ensure();
    await Backup.init();

    const idn = await DB.get('identity', null);
    if (idn) state.id = Object.assign({}, IDENTITY_DEFAULT, idn);
    else await DB.set('identity', state.id);

    await migrateLegacy();
    await go('library');
    await draftRestore();
  } catch (e) {
    console.error(e);
    toast('تعذّر فتح المكتبة على هذا الجهاز', true);
  }
  if (!store.get(LS.key, '')) setTimeout(openSettings, 800);
}

/* ينقل الشغل المحفوظ في النسخة القديمة (localStorage) إلى المكتبة مرة واحدة */
async function migrateLegacy() {
  if (await DB.get('migrated', false)) return;
  const last = store.get(LS.last, null);
  const pMeta = store.get(LS.plan, null);
  const pRows = store.get(LS.planRows, null);
  const cMeta = store.get(LS.cover, null);
  const remembered = store.get(LS.meta, {});
  const teacher = (last && last.meta && last.meta.teacher) || remembered.teacher || '';
  if (teacher) await DB.set('teacher', teacher);

  const name = (last && last.meta && last.meta.subject) || (pMeta && pMeta.subject) ||
               (cMeta && cMeta.subject) || remembered.subject;
  if (!name) { await DB.set('migrated', true); return; }

  const sub = await DB.subjectSave({
    name,
    grade: (last && last.meta && last.meta.grade) || (pMeta && pMeta.grade) || remembered.grade || '',
    dept:  (last && last.meta && last.meta.dept)  || (pMeta && pMeta.dept)  || remembered.dept || '',
    year:  (pMeta && pMeta.year) || (cMeta && cMeta.year) || '',
    term:  (pMeta && pMeta.term) || (cMeta && cMeta.term) || 'الفصل الدراسي الأول'
  });

  if (last && last.data) {
    await DB.lessonSave({
      subjectId: sub.id,
      lessonNo: (last.meta && last.meta.lessonNo) || '1',
      title: last.data.lessonTitle || '',
      meta: last.meta || {}, data: last.data
    });
  }
  if (pMeta && Array.isArray(pRows) && pRows.length) {
    await DB.docSave('plan', sub.id, { meta: pMeta, rows: pRows });
  }
  if (cMeta && cMeta.subject) await DB.docSave('cover', sub.id, cMeta);

  await DB.set('migrated', true);
  toast('تم نقل شغلك السابق إلى المكتبة');
}

document.addEventListener('DOMContentLoaded', init);
