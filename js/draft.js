/* =========================================================================
   draft.js — شبكة أمان: يحفظ الشغل غير المكتمل ويرجّعه لو أُعيد تحميل التطبيق

   أندرويد قد يقتل صفحة التطبيق تحت ضغط الذاكرة — خصوصًا بعد فتح الكاميرا أو
   منتقي الملفات — فيرجع المستخدم فيجد نفسه في شاشة المكتبة وقد ضاعت الصور
   والبيانات. هنا نحفظ (المادة · القسم · الدرس · حقول النموذج · ملفات الصفحات)
   في IndexedDB، وعند الإقلاع نعرض عليه استرجاعها.
   ========================================================================= */

const DRAFT_KEY = 'draft';
const DRAFT_TTL = 12 * 60 * 60 * 1000;      /* ١٢ ساعة */
let _dfT = null;

/** حفظ مؤجَّل — يجمّع التغييرات المتلاحقة في كتابة واحدة */
function draftSoon() {
  clearTimeout(_dfT);
  _dfT = setTimeout(() => { draftSave().catch(() => {}); }, 900);
}

async function draftSave() {
  if (Lib.screen !== 'work' || !Lib.subject) return;
  const d = {
    at: Date.now(),
    subjectId: Lib.subject.id,
    lessonId: Lib.lessonId || null,
    mode: state.mode,
    meta: readMeta(),
    /* الملفات تُحفظ كما هي — IndexedDB يدعم File/Blob */
    files: state.files.slice(0, 12),
    hasResult: !!state.data
  };
  /* لا نحفظ مسودّة فاضية */
  const filled = d.files.length || Object.keys(d.meta).some(k =>
    k !== 'lang' && String(d.meta[k] || '').trim());
  if (!filled) return draftClear();
  await DB.set(DRAFT_KEY, d);
}

async function draftClear() {
  clearTimeout(_dfT);
  try { await DB.set(DRAFT_KEY, null); } catch (_) {}
}

/** يُنادى عند الإقلاع — يعرض على المستخدم استرجاع شغله */
async function draftRestore() {
  let d = null;
  try { d = await DB.get(DRAFT_KEY, null); } catch (_) { return false; }
  if (!d || !d.subjectId) return false;
  if (Date.now() - (d.at || 0) > DRAFT_TTL) { await draftClear(); return false; }

  const sub = await DB.subject(d.subjectId);
  if (!sub) { await draftClear(); return false; }

  const n = (d.files || []).length;
  const what = [
    n ? `${toArabicDigits(n)} ${n === 1 ? 'صفحة مصوّرة' : 'صفحة مصوّرة'}` : null,
    (d.meta && d.meta.lessonNo)
      ? `${d.mode === 'prac' ? 'الموضوع' : 'الدرس'} ${toArabicDigits(d.meta.lessonNo)}` : null
  ].filter(Boolean).join(' · ');

  const ok = await ask(
    `عندك شغل لم يكتمل في مادة «${sub.name}»${what ? ' (' + what + ')' : ''}. ترجع له؟`,
    { title: 'استرجاع شغل غير مكتمل', yes: 'ارجع لشغلي', no: 'ابدأ من جديد', danger: false });

  if (ok !== true) { await draftClear(); return false; }

  Lib.subject = sub;
  await openWork(d.mode || 'prep', d.lessonId || null);
  /* الحقول بعد فتح القسم حتى لا تُطمس بقيم المادة */
  if (d.meta) {
    META_FIELDS.forEach(f => {
      const e = $('#m_' + f.key);
      if (e && d.meta[f.key] != null && d.meta[f.key] !== '') e.value = d.meta[f.key];
    });
    state.meta = d.meta;
  }
  if ((d.files || []).length) { state.files = d.files.slice(); renderFiles(); }
  setStatus('رجّعنا شغلك — أكمل من هنا');
  return true;
}

/** يربط الحفظ التلقائي بأحداث الواجهة */
function bindDraft() {
  /* أي كتابة في حقول التحضير */
  const box = document.querySelector('#metaGrid');
  if (box) box.addEventListener('input', draftSoon);
  /* قبل أن تختفي الصفحة — آخر فرصة للحفظ */
  document.addEventListener('visibilitychange', () => { if (document.hidden) draftSave().catch(() => {}); });
  window.addEventListener('pagehide', () => { draftSave().catch(() => {}); });
}
