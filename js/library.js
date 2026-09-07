/* =========================================================================
   library.js — شاشة المكتبة (المواد) وشاشة المادة (الغلاف · الخطة · الدروس)
   ========================================================================= */

const Lib = {
  screen: 'library',
  subject: null,          /* المادة المفتوحة */
  lessonId: null          /* الدرس المفتوح للتعديل، أو null لدرس جديد */
};

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
           <i class="${lessons.length ? 'ok' : ''}">${toArabicDigits(lessons.length)} درس</i>
         </div>
       </div>
       <div class="sj-go">${svgIcon('book', 20)}</div>`;
    card.onclick = () => go('subject', s.id);
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
    `${s.year ? ' · ' + escHtml(s.year) : ''}${s.term ? ' · ' + escHtml(s.term) : ''}</span>`;

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
      const d = el('button', 'tile-del', '×');
      d.title = 'حذف';
      d.onclick = onDelete;
      wrapEl.appendChild(d);
    }
    return wrapEl;
  };

  tiles.appendChild(tile('image', 'غلاف المادة',
    cover ? 'جاهز — اضغط للتعديل أو الطباعة' : 'لم يُجهَّز بعد',
    !!cover, () => openWork('cover'),
    async () => {
      if (!confirm('حذف غلاف هذه المادة؟ يمكنك تجهيزه من جديد في أي وقت.')) return;
      await DB.docDelete('cover', s.id); toast('تم حذف الغلاف'); renderSubject();
    }));

  tiles.appendChild(tile('week', 'الخطة الزمنية',
    plan ? `جاهزة — ${toArabicDigits((plan.payload.rows || []).length)} أسبوع · اضغط للتعديل` : 'لم تُجهَّز بعد',
    !!plan, () => openWork('plan'),
    async () => {
      if (!confirm('حذف الخطة الزمنية لهذه المادة بكل أسابيعها؟')) return;
      await DB.docDelete('plan', s.id); toast('تم حذف الخطة'); renderSubject();
    }));

  /* الدروس */
  const list = $('#lessonList');
  list.innerHTML = '';
  if (!lessons.length) {
    list.appendChild(el('div', 'empty small', '<span>لا توجد دروس محفوظة بعد.</span>'));
  }
  lessons.forEach(l => {
    const row = el('div', 'les');
    row.innerHTML =
      `<span class="n">${toArabicDigits(l.lessonNo || '—')}</span>
       <div class="tx"><b>${escHtml(l.title || 'بدون عنوان')}</b>
         <span>${escHtml(new Date(l.updatedAt).toLocaleDateString('ar-EG'))}</span></div>`;
    const open = el('button', 'ghost tiny', 'فتح');
    open.onclick = () => openWork('prep', l.id);
    const del = el('button', 'les-del', '×');
    del.title = 'حذف الدرس';
    del.onclick = async e => {
      e.stopPropagation();
      if (!confirm(`حذف «${l.title || 'الدرس'}» نهائيًا؟`)) return;
      await DB.lessonDelete(l.id);
      renderSubject();
    };
    row.appendChild(open); row.appendChild(del);
    list.appendChild(row);
  });

  $('#btnTerm').disabled = !(cover || plan || lessons.length);
  $('#termHint').textContent = (cover || plan || lessons.length)
    ? 'يشمل: ' + [cover ? 'الغلاف' : null, plan ? 'الخطة الزمنية' : null,
        lessons.length ? toArabicDigits(lessons.length) + (lessons.length === 1 ? ' درس' : ' دروس') : null]
        .filter(Boolean).join(' + ')
    : 'جهّز الغلاف أو الخطة أو درسًا واحدًا على الأقل أولًا';
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
    if (!confirm(`حذف مادة «${s.name}» بكل دروسها وغلافها وخطتها نهائيًا؟\nهذا لا يمكن الرجوع فيه.`)) return;
    await DB.subjectDelete(s.id);
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
      const replace = confirm(
        `الملف يحتوي ${toArabicDigits(n)} مادة و${toArabicDigits(m)} درس.\n\n` +
        'اضغط «موافق» لاستبدال مكتبتك الحالية بالكامل،\n' +
        'أو «إلغاء» لإضافة محتوى الملف إلى مكتبتك الحالية.');
      await DB.importAll(data, replace ? 'replace' : 'merge');
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
