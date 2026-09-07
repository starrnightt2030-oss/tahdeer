/* =========================================================================
   library.js — شاشة المكتبة (المواد) وشاشة المادة (الغلاف · الخطة · الدروس)
   ========================================================================= */

const Lib = {
  screen: 'library',
  subject: null,          /* المادة المفتوحة */
  lessonId: null          /* الدرس المفتوح للتعديل، أو null لدرس جديد */
};

/* =========================================================================
   نافذة تأكيد داخل التطبيق — بديل confirm() الأصلية
   السبب: التطبيق المثبَّت على أندرويد (وبعض المتصفحات بعد أن يفعّل المستخدم
   «منع هذه الصفحة من إنشاء نوافذ إضافية») يكتم النوافذ الأصلية فترجع false
   صامتة، فيبدو زر الحذف كأنه لا يعمل. هذه النافذة من عناصر الصفحة نفسها فلا
   يمكن كتمها.
   الإرجاع: true = نعم · false = الزر الثاني · null = إغلاق/تراجع
   ========================================================================= */
function ask(msg, opts) {
  const o = opts || {};
  const back = document.querySelector('#askDlg');
  if (!back) return Promise.resolve(window.confirm(msg));   /* احتياطي فقط */

  document.querySelector('#askTitle').textContent = o.title || 'تأكيد الحذف';
  document.querySelector('#askMsg').textContent = msg;
  const yes = document.querySelector('#askYes');
  const no  = document.querySelector('#askNo');
  const cnc = document.querySelector('#askCancel');
  const x   = document.querySelector('#askX');
  yes.textContent = o.yes || 'حذف نهائيًا';
  no.textContent  = o.no  || 'إلغاء';
  yes.classList.toggle('danger', o.danger !== false);
  cnc.hidden = !o.cancel;
  if (o.cancel) cnc.textContent = o.cancel;
  back.hidden = false;

  return new Promise(res => {
    const done = v => {
      back.hidden = true;
      yes.onclick = no.onclick = cnc.onclick = x.onclick = back.onclick = null;
      document.removeEventListener('keydown', onKey);
      res(v);
    };
    const onKey = e => { if (e.key === 'Escape') done(null); };
    yes.onclick = () => done(true);
    no.onclick  = () => done(false);
    cnc.onclick = () => done(null);
    x.onclick   = () => done(null);
    back.onclick = e => { if (e.target === back) done(null); };
    document.addEventListener('keydown', onKey);
  });
}

/* ينفّذ عملية ويُظهر سبب الفشل بدل أن يفشل صامتًا */
async function tryDo(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    console.error(e);
    toast('تعذّر التنفيذ: ' + ((e && e.message) || e), true);
    return false;
  }
}

/* ---------------- التنقل ---------------- */
async function go(screen, arg) {
  Lib.screen = screen;
  ['Library', 'Subject', 'Work'].forEach(k => {
    const e = document.querySelector('#screen' + k);
    if (e) e.hidden = (k.toLowerCase() !== screen);
  });
  $('#resultWrap').hidden = true;
  $('#paper').innerHTML = '';

  const back = $('#btnBack');
  back.hidden = (screen === 'library');

  if (screen === 'library') { Lib.subject = null; await renderLibrary(); }
  if (screen === 'subject') {
    if (arg != null) Lib.subject = await DB.subject(arg);
    await renderSubject();
  }
  window.scrollTo({ top: 0 });
  setTopbar();
}

function setTopbar() {
  const t = $('#topTitle'), s = $('#topSub');
  if (Lib.screen === 'library') { t.textContent = 'محضّر الدروس'; s.textContent = 'مكتبة موادك'; }
  else if (Lib.screen === 'subject') { t.textContent = Lib.subject ? Lib.subject.name : ''; s.textContent = Lib.subject ? (Lib.subject.grade || '') : ''; }
  else { t.textContent = Lib.subject ? Lib.subject.name : 'محضّر الدروس'; s.textContent = MODE_TITLE[state.mode] || ''; }
}

/* ---------------- شاشة المكتبة ---------------- */
async function renderLibrary() {
  const box = $('#subjList');
  const subs = await DB.subjects();
  box.innerHTML = '';

  if (!subs.length) {
    box.appendChild(el('div', 'empty',
      '<b>مكتبتك فاضية</b><span>أضف مادة لتبدأ: الغلاف والخطة الزمنية ودروس الترم كلها تُحفظ داخلها.</span>'));
  }

  for (const s of subs) {
    const lessons = await DB.lessons(s.id);
    const cover = await DB.doc('cover', s.id);
    const plan  = await DB.doc('plan', s.id);
    const card = el('div', 'subj');
    card.innerHTML =
      `<div class="sj-main">
         <b>${escHtml(s.name)}</b>
         <span>${escHtml(s.grade || '')}${s.dept ? ' · ' + escHtml(s.dept) : ''}</span>
         <div class="chips">
           <i class="${cover ? 'ok' : ''}">${cover ? '✓' : '—'} غلاف</i>
           <i class="${plan ? 'ok' : ''}">${plan ? '✓' : '—'} خطة</i>
           <i class="${lessons.filter(l => (l.kind || 'prep') === 'prep').length ? 'ok' : ''}">${toArabicDigits(lessons.filter(l => (l.kind || 'prep') === 'prep').length)} نظري</i>
           <i class="${lessons.filter(l => l.kind === 'prac').length ? 'ok' : ''}">${toArabicDigits(lessons.filter(l => l.kind === 'prac').length)} عملي</i>
         </div>
       </div>
       <div class="sj-go">${svgIcon('book', 20)}</div>`;
    card.onclick = () => go('subject', s.id);

    /* حذف المادة من المكتبة مباشرة */
    const del = el('button', 'sj-del');
    del.innerHTML = svgIcon('trash', 16, 'ico');
    del.title = 'حذف المادة';
    del.setAttribute('aria-label', 'حذف المادة');
    del.onclick = async e => {
      e.stopPropagation();
      const ok = await ask(
        `حذف مادة «${s.name}» بكل دروسها وغلافها وخطتها نهائيًا؟ لا يمكن الرجوع في هذا.`,
        { title: 'حذف مادة' });
      if (ok !== true) return;
      if (await tryDo(() => DB.subjectDelete(s.id), 'تم حذف المادة')) renderLibrary();
    };
    card.appendChild(del);

    box.appendChild(card);
  }
  renderBackupBar();
}

/* ---------------- شاشة المادة ---------------- */
async function renderSubject() {
  const s = Lib.subject;
  if (!s) return go('library');

  const head = $('#subjHead');
  head.innerHTML =
    `<b>${escHtml(s.name)}</b>
     <span>${escHtml(s.grade || '')}${s.dept ? ' · ' + escHtml(s.dept) : ''}` +
    `${s.year ? ' · <bdi>' + escHtml(s.year) + '</bdi>' : ''}${s.term ? ' · ' + escHtml(s.term) : ''}</span>`;

  const cover = await DB.doc('cover', s.id);
  const plan  = await DB.doc('plan', s.id);
  const lessons = await DB.lessons(s.id);

  const tiles = $('#subjTiles');
  tiles.innerHTML = '';
  const tile = (icon, label, sub, done, onClick, onDelete) => {
    const wrapEl = el('div', 'tile' + (done ? ' done' : ''));
    const main = el('button', 'tile-main');
    main.innerHTML = `<div class="ic">${svgIcon(icon, 20)}</div>` +
      `<div class="tx"><b>${escHtml(label)}</b><span>${escHtml(sub)}</span></div>` +
      `<div class="mk">${done ? '✓' : '＋'}</div>`;
    main.onclick = onClick;
    wrapEl.appendChild(main);
    if (done && onDelete) {
      const d = el('button', 'tile-del');
      d.innerHTML = svgIcon('trash', 17, 'ico') + '<span>حذف</span>';
      d.title = 'حذف';
      d.onclick = onDelete;
      wrapEl.appendChild(d);
    }
    return wrapEl;
  };

  tiles.appendChild(tile('image', 'غلاف المادة',
    cover ? 'جاهز — اضغط لفتحه وتعديله أو طباعته' : 'لم يُجهَّز بعد — اضغط للتجهيز',
    !!cover, () => openWork('cover'),
    async () => {
      const ok = await ask('حذف غلاف هذه المادة؟ يمكنك تجهيزه من جديد في أي وقت.',
        { title: 'حذف الغلاف' });
      if (ok !== true) return;
      if (await tryDo(() => DB.docDelete('cover', s.id), 'تم حذف الغلاف')) renderSubject();
    }));

  tiles.appendChild(tile('week', 'الخطة الزمنية',
    plan ? `جاهزة — ${toArabicDigits((plan.payload.rows || []).length)} أسبوع · اضغط لتعديلها` : 'لم تُجهَّز بعد — اضغط للتجهيز',
    !!plan, () => openWork('plan'),
    async () => {
      const ok = await ask('حذف الخطة الزمنية لهذه المادة بكل أسابيعها؟',
        { title: 'حذف الخطة الزمنية' });
      if (ok !== true) return;
      if (await tryDo(() => DB.docDelete('plan', s.id), 'تم حذف الخطة')) renderSubject();
    }));

  /* الدروس — نظري وعملي في قائمتين */
  const prepLs = lessons.filter(l => (l.kind || 'prep') === 'prep');
  const pracLs = lessons.filter(l => l.kind === 'prac');

  const fillList = (sel, arr, mode, empty) => {
    const list = $(sel);
    if (!list) return;
    list.innerHTML = '';
    if (!arr.length) { list.appendChild(el('div', 'empty small', `<span>${empty}</span>`)); return; }
    arr.forEach(l => {
      const row = el('div', 'les');
      row.innerHTML =
        `<span class="n">${toArabicDigits(l.lessonNo || '—')}</span>
         <div class="tx"><b>${escHtml(l.title || 'بدون عنوان')}</b>
           <span>${escHtml(new Date(l.updatedAt).toLocaleDateString('ar-EG'))}</span></div>`;
      const open = el('button', 'ghost tiny');
      open.innerHTML = svgIcon('edit', 14, 'ico') + '<span>فتح وتعديل</span>';
      open.onclick = () => openWork(mode, l.id);
      const del = el('button', 'les-del');
      del.innerHTML = svgIcon('trash', 16, 'ico');
      del.title = 'حذف';
      del.onclick = async e => {
        e.stopPropagation();
        const what = (mode === 'prac') ? 'موضوع' : 'درس';
        const ok = await ask(`حذف ${what} «${l.title || 'بدون عنوان'}» نهائيًا؟`,
          { title: 'حذف ' + what });
        if (ok !== true) return;
        if (await tryDo(() => DB.lessonDelete(l.id), 'تم الحذف')) renderSubject();
      };
      row.appendChild(open); row.appendChild(del);
      list.appendChild(row);
    });
  };

  fillList('#lessonList', prepLs, 'prep', 'لا توجد دروس نظرية محفوظة بعد.');
  fillList('#pracList',   pracLs, 'prac', 'لا توجد مواضيع تدريب عملي محفوظة بعد.');
  const cnt = (n, one, many) => n ? `${toArabicDigits(n)} ${n === 1 ? one : many}` : '';
  if ($('#cntPrep')) $('#cntPrep').textContent = cnt(prepLs.length, 'درس', 'دروس');
  if ($('#cntPrac')) $('#cntPrac').textContent = cnt(pracLs.length, 'موضوع', 'مواضيع');

  $('#btnTerm').disabled = !(cover || plan || lessons.length);
  $('#termHint').textContent = (cover || plan || lessons.length)
    ? 'يشمل: ' + [cover ? 'الغلاف' : null, plan ? 'الخطة الزمنية' : null,
        cnt(prepLs.length, 'درس نظري', 'دروس نظرية') || null,
        cnt(pracLs.length, 'موضوع عملي', 'مواضيع عملية') || null]
        .filter(Boolean).join(' + ')
    : 'جهّز الغلاف أو الخطة أو تحضيرًا واحدًا على الأقل أولًا';
}

/* ---------------- إضافة / تعديل مادة ---------------- */
function subjectDialog(existing) {
  const back = $('#subjDlg');
  back.hidden = false;
  const f = k => $('#sd_' + k);
  const s = existing || {};
  f('name').value = s.name || '';
  f('grade').value = s.grade || '';
  f('dept').value = s.dept || '';
  f('year').value = s.year || '';
  f('term').value = s.term || 'الفصل الدراسي الأول';
  $('#sdTitle').textContent = existing ? 'تعديل بيانات المادة' : 'إضافة مادة';
  $('#sdDelete').hidden = !existing;

  $('#sdSave').onclick = async () => {
    const name = f('name').value.trim(), grade = f('grade').value.trim();
    if (!name) { f('name').classList.add('err'); return; }
    if (!grade) { f('grade').classList.add('err'); return; }
    const rec = Object.assign({}, s, {
      name, grade, dept: f('dept').value.trim(),
      year: f('year').value.trim(), term: f('term').value
    });
    const saved = await DB.subjectSave(rec);
    back.hidden = true;
    if (Lib.screen === 'subject') { Lib.subject = saved; renderSubject(); setTopbar(); }
    else go('subject', saved.id);
  };
  $('#sdDelete').onclick = async () => {
    const ok = await ask(
      `حذف مادة «${s.name}» بكل دروسها وغلافها وخطتها نهائيًا؟ لا يمكن الرجوع في هذا.`,
      { title: 'حذف مادة' });
    if (ok !== true) return;
    if (!await tryDo(() => DB.subjectDelete(s.id), 'تم حذف المادة')) return;
    back.hidden = true;
    go('library');
  };
  $('#sdCancel').onclick = () => { back.hidden = true; };
}

/* ---------------- شريط حالة الأمان ---------------- */
function renderBackupBar() {
  const b = $('#backupBar');
  if (!b) return;
  const p = Persist.state === 'granted';
  let cls = 'bk', txt = '', act = '';

  if (Backup.status === 'ready') {
    cls += ' ok';
    txt = 'النسخ الاحتياطي التلقائي مُفعَّل' +
      (Backup.lastAt ? ' · آخر نسخة ' + new Date(Backup.lastAt).toLocaleString('ar-EG') : '');
  } else if (Backup.status === 'needPermission') {
    cls += ' warn'; txt = 'مجلد النسخ الاحتياطي يحتاج تأكيد الإذن'; act = 'تأكيد';
  } else if (Backup.status === 'error') {
    cls += ' bad'; txt = 'تعذّر الكتابة في مجلد النسخ الاحتياطي'; act = 'إعادة الاختيار';
  } else if (Backup.status === 'unsupported') {
    cls += ' warn'; txt = 'متصفحك لا يدعم النسخ التلقائي — استخدم «تصدير نسخة» يدويًا'; act = 'تصدير';
  } else {
    cls += ' warn'; txt = 'شغلك محفوظ على هذا الجهاز فقط — فعّل نسخة احتياطية تلقائية'; act = 'تفعيل';
  }

  b.className = cls;
  b.innerHTML = `<span class="t">${escHtml(txt)}</span>` +
    (p ? '' : '<span class="p">التخزين الدائم غير مُفعَّل</span>');
  if (act) {
    const btn = el('button', 'bk-act', act);
    btn.onclick = backupAction;
    b.appendChild(btn);
  }
}

async function backupAction() {
  try {
    if (Backup.status === 'needPermission') { await Backup.regrant(); }
    else if (Backup.status === 'unsupported') { return exportBackup(); }
    else { await Backup.choose(); }
    toast(Backup.status === 'ready' ? 'تم تفعيل النسخ الاحتياطي' : 'لم يتم التفعيل', Backup.status !== 'ready');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast(e.message || 'تعذّر تفعيل النسخ الاحتياطي', true);
  }
  renderBackupBar();
}

function onBackupState() { renderBackupBar(); }

/* ---------------- تصدير / استيراد يدوي ---------------- */
async function exportBackup() {
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const d = new Date();
  download(blob, `tahdeer-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`);
  toast('تم تصدير نسخة احتياطية');
}

function importBackup() {
  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = 'application/json,.json';
  fi.onchange = async () => {
    const f = fi.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const n = (data.subjects || []).length, m = (data.lessons || []).length;
      const r = await ask(
        `الملف يحتوي ${toArabicDigits(n)} مادة و${toArabicDigits(m)} درس. ` +
        'هل تستبدل مكتبتك الحالية بالكامل، أم تضيف محتوى الملف إليها؟',
        { title: 'استيراد نسخة احتياطية', yes: 'استبدال المكتبة',
          no: 'إضافة إلى المكتبة', cancel: 'تراجع' });
      if (r === null) return;
      await DB.importAll(data, r ? 'replace' : 'merge');
      const idn = await DB.get('identity', null);
      if (idn) { state.id = Object.assign({}, IDENTITY_DEFAULT, idn); }
      toast('تم استيراد النسخة الاحتياطية');
      go('library');
    } catch (e) {
      console.error(e); toast(e.message || 'الملف غير صالح', true);
    }
  };
  fi.click();
}
