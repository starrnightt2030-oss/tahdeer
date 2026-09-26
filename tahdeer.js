/* tahdeer.js — كل ملفات التطبيق مدموجة (نسخة الرفع من الموبايل) */

/* ===== js/db.js ===== */
/* =========================================================================
   db.js — التخزين الدائم (IndexedDB) + النسخ الاحتياطي إلى مجلد حقيقي
   البنية: مادة ← { غلاف · خطة زمنية · دروس }
   ========================================================================= */

const DB_NAME = 'tahdeer';
const DB_VER  = 1;
let _db = null;

function dbOpen() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, DB_VER);
    rq.onupgradeneeded = e => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('subjects'))
        d.createObjectStore('subjects', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('lessons')) {
        const s = d.createObjectStore('lessons', { keyPath: 'id', autoIncrement: true });
        s.createIndex('by_subject', 'subjectId');
      }
      if (!d.objectStoreNames.contains('docs'))
        d.createObjectStore('docs', { keyPath: 'id' });          /* 'cover:3' | 'plan:3' */
      if (!d.objectStoreNames.contains('kv'))
        d.createObjectStore('kv', { keyPath: 'k' });
    };
    rq.onsuccess = () => { _db = rq.result; res(_db); };
    rq.onerror = () => rej(rq.error);
  });
}

function tx(store, mode) {
  return dbOpen().then(d => d.transaction(store, mode || 'readonly').objectStore(store));
}
const wrap = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

/* ---------------- المواد ---------------- */
const DB = {
  async subjects() {
    const s = await tx('subjects');
    const all = await wrap(s.getAll());
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async subject(id) { return wrap((await tx('subjects')).get(+id)); },
  async subjectSave(sub) {
    sub.updatedAt = Date.now();
    if (!sub.createdAt) sub.createdAt = sub.updatedAt;
    const s = await tx('subjects', 'readwrite');
    const id = await wrap(s.put(sub));
    sub.id = id;
    backupSoon();
    return sub;
  },
  async subjectDelete(id) {
    id = +id;
    const ls = await DB.lessons(id);
    const d = await dbOpen();
    await new Promise((res, rej) => {
      const t = d.transaction(['subjects', 'lessons', 'docs'], 'readwrite');
      t.objectStore('subjects').delete(id);
      ls.forEach(l => t.objectStore('lessons').delete(l.id));
      t.objectStore('docs').delete('cover:' + id);
      t.objectStore('docs').delete('plan:' + id);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    backupSoon();
  },

  /* ---------------- الدروس ---------------- */
  async lessons(subjectId) {
    const s = await tx('lessons');
    const all = await wrap(s.index('by_subject').getAll(+subjectId));
    return all.sort((a, b) => (parseInt(a.lessonNo, 10) || 0) - (parseInt(b.lessonNo, 10) || 0)
      || (a.createdAt || 0) - (b.createdAt || 0));
  },
  async lesson(id) { return wrap((await tx('lessons')).get(+id)); },
  async lessonSave(les) {
    les.updatedAt = Date.now();
    if (!les.createdAt) les.createdAt = les.updatedAt;
    const s = await tx('lessons', 'readwrite');
    les.id = await wrap(s.put(les));
    const sub = await DB.subject(les.subjectId);
    if (sub) await DB.subjectSave(sub);          /* يحدّث وقت المادة */
    backupSoon();
    return les;
  },
  async lessonDelete(id) {
    const s = await tx('lessons', 'readwrite');
    await wrap(s.delete(+id));
    backupSoon();
  },

  /* ---------------- الغلاف والخطة ---------------- */
  async doc(kind, subjectId) { return wrap((await tx('docs')).get(kind + ':' + subjectId)); },
  async docSave(kind, subjectId, payload) {
    const s = await tx('docs', 'readwrite');
    await wrap(s.put({ id: kind + ':' + subjectId, kind, subjectId: +subjectId, payload, updatedAt: Date.now() }));
    const sub = await DB.subject(subjectId);
    if (sub) await DB.subjectSave(sub);
    backupSoon();
  },

  async docDelete(kind, subjectId) {
    const s = await tx('docs', 'readwrite');
    await wrap(s.delete(kind + ':' + subjectId));
    backupSoon();
  },

  /* ---------------- إعدادات ---------------- */
  async get(k, dflt) {
    const r = await wrap((await tx('kv')).get(k));
    return r ? r.v : dflt;
  },
  async set(k, v) {
    const s = await tx('kv', 'readwrite');
    await wrap(s.put({ k, v }));
  },

  /* ---------------- تصدير / استيراد ---------------- */
  async exportAll() {
    const [subjects, docsAll] = await Promise.all([
      DB.subjects(),
      wrap((await tx('docs')).getAll())
    ]);
    const lessons = await wrap((await tx('lessons')).getAll());
    return {
      app: 'tahdeer', version: 1, exportedAt: new Date().toISOString(),
      identity: await DB.get('identity', null),
      teacher: await DB.get('teacher', ''),
      subjects, lessons, docs: docsAll
    };
    /* المفتاح لا يُصدَّر أبدًا لأمانه */
  },

  async importAll(data, mode) {
    if (!data || data.app !== 'tahdeer') throw new Error('الملف ليس نسخة احتياطية صالحة لهذا التطبيق.');
    const d = await dbOpen();
    return new Promise((res, rej) => {
      const t = d.transaction(['subjects', 'lessons', 'docs', 'kv'], 'readwrite');
      const S = t.objectStore('subjects'), L = t.objectStore('lessons'), C = t.objectStore('docs');
      if (mode === 'replace') { S.clear(); L.clear(); C.clear(); }
      const map = {};
      (data.subjects || []).forEach(s => {
        const old = s.id; const copy = Object.assign({}, s);
        if (mode !== 'replace') delete copy.id;
        const rq = S.put(copy);
        rq.onsuccess = () => { map[old] = rq.result; };
      });
      t.oncomplete = async () => {
        /* الدروس والوثائق بعد معرفة معرّفات المواد الجديدة */
        const d2 = await dbOpen();
        const t2 = d2.transaction(['lessons', 'docs'], 'readwrite');
        (data.lessons || []).forEach(l => {
          const copy = Object.assign({}, l);
          copy.subjectId = map[l.subjectId] != null ? map[l.subjectId] : l.subjectId;
          if (mode !== 'replace') delete copy.id;
          t2.objectStore('lessons').put(copy);
        });
        (data.docs || []).forEach(c => {
          const sid = map[c.subjectId] != null ? map[c.subjectId] : c.subjectId;
          t2.objectStore('docs').put(Object.assign({}, c, { id: c.kind + ':' + sid, subjectId: sid }));
        });
        t2.oncomplete = async () => {
          if (data.identity) await DB.set('identity', data.identity);
          if (data.teacher) await DB.set('teacher', data.teacher);
          res(true);
        };
        t2.onerror = () => rej(t2.error);
      };
      t.onerror = () => rej(t.error);
    });
  }
};

/* =========================================================================
   التخزين الدائم
   ========================================================================= */
const Persist = {
  state: 'unknown',      /* granted | denied | unsupported */
  async ensure() {
    try {
      if (!navigator.storage || !navigator.storage.persist) { Persist.state = 'unsupported'; return Persist.state; }
      let ok = await navigator.storage.persisted();
      if (!ok) ok = await navigator.storage.persist();
      Persist.state = ok ? 'granted' : 'denied';
    } catch (_) { Persist.state = 'unsupported'; }
    return Persist.state;
  },
  async usage() {
    try {
      const e = await navigator.storage.estimate();
      return { used: e.usage || 0, quota: e.quota || 0 };
    } catch (_) { return null; }
  }
};

/* =========================================================================
   النسخ الاحتياطي إلى مجلد حقيقي على الجهاز
   ========================================================================= */
const BACKUP_FILE = 'tahdeer-backup.json';
/* =========================================================================
   النسخ الاحتياطي إلى مجلد على الجهاز

   ملاحظة مهمة عن الإذن:
   إذن الوصول لمجلد لا يدوم بين الجلسات إلا في التطبيق **المثبَّت** على
   الشاشة الرئيسية (كروم يُديمه تلقائيًا)، أو إن اختار المستخدم
   «السماح في كل زيارة» في نافذة الإذن. وفي تبويب متصفّح عادي يعود الإذن
   إلى «prompt» مع كل فتح.

   لذلك **لا نطلب الإذن عند فتح التطبيق** — كان يظهر شريط تأكيد في كل مرة
   حتى لو لم يُنجز المدرّس شيئًا. نؤجّل الطلب إلى لحظة وجود شغل يستحق
   الحفظ فعلًا (حالة armed)، فيُسأل مرة واحدة وقت الحاجة لا مع كل فتح.
   ========================================================================= */
const Backup = {
  dir: null,
  /* off | armed | ready | needPermission | error | unsupported */
  status: 'off',
  pending: false,       /* يوجد شغل ينتظر النسخ */
  lastAt: 0,
  lastError: '',

  supported() {
    return typeof window.showDirectoryPicker === 'function';
  },

  async init() {
    if (!Backup.supported()) { Backup.status = 'unsupported'; return; }
    const h = await DB.get('backupDir', null);
    if (!h) { Backup.status = 'off'; return; }
    Backup.dir = h;
    try {
      const p = await h.queryPermission({ mode: 'readwrite' });
      /* «armed» = المجلد مختار والإذن سيُطلب عند أول حفظ، لا الآن */
      Backup.status = (p === 'granted') ? 'ready' : 'armed';
    } catch (_) { Backup.status = 'armed'; }
    Backup.lastAt = await DB.get('backupAt', 0);
  },

  /** يفتح منتقي المجلدات — يحتاج لمسة من المستخدم */
  async choose() {
    if (!Backup.supported()) throw new Error('متصفحك لا يدعم اختيار مجلد. استخدم «تصدير نسخة» بدلًا منه.');
    const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'tahdeerBackup' });
    Backup.dir = h;
    await DB.set('backupDir', h);
    Backup.status = 'ready';
    await Backup.run(true);
    return h;
  },

  /** يعيد طلب الإذن — يحتاج لمسة من المستخدم */
  async regrant() {
    if (!Backup.dir) return false;
    const p = await Backup.dir.requestPermission({ mode: 'readwrite' });
    Backup.status = (p === 'granted') ? 'ready' : 'needPermission';
    if (Backup.status === 'ready') await Backup.run(true);
    return Backup.status === 'ready';
  },

  async disable() {
    Backup.dir = null; Backup.status = 'off'; Backup.pending = false;
    await DB.set('backupDir', null);
  },

  async run(force) {
    if (!Backup.dir) return false;
    try {
      const p = await Backup.dir.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') {
        /* الآن فقط نُظهر طلب التأكيد — لأن هناك شغلًا ينتظر */
        Backup.status = 'needPermission';
        Backup.pending = true;
        return false;
      }
      const fh = await Backup.dir.getFileHandle(BACKUP_FILE, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(await DB.exportAll()));
      await w.close();
      Backup.status = 'ready';
      Backup.pending = false;
      Backup.lastAt = Date.now();
      Backup.lastError = '';
      await DB.set('backupAt', Backup.lastAt);
      return true;
    } catch (e) {
      Backup.status = 'error';
      Backup.lastError = e && e.message ? e.message : String(e);
      return false;
    }
  }
};

/* نسخة مؤجّلة بعد كل حفظ — تجميع التغييرات في كتابة واحدة */
let _bkT = null;
function backupSoon() {
  if (!Backup.dir) return;
  clearTimeout(_bkT);
  _bkT = setTimeout(() => {
    Backup.run().then(() => { if (typeof onBackupState === 'function') onBackupState(); });
  }, 2500);
}

/* ===== js/schema.js ===== */
/* =========================================================================
   schema.js — مصدر الحقيقة الوحيد لقالب التحضير
   النموذج + برومبت الذكاء الاصطناعي + المعاينة + ملف Word كلها تُبنى من هنا.
   ========================================================================= */

const IDENTITY_DEFAULT = {
  org:        'شركة ترسانة الإسكندرية',
  dept1:      'الإدارة العامة لمركز التدريب',
  dept2:      'إدارة التعليم النظري',
  formCode:   'F-TH-04',
  edition:    '١',
  revision:   '٠',
  issueDate:  '٢٠٢٤/١/١',
  navy:       '#16295C',
  navyDark:   '#0E1C41',
  red:        '#C8102E',
  logo:       ''            // يضعه المستخدم من الإعدادات (data URL)
};

/* =========================================================================
   ستايلات الورقة — ثلاثة أشكال للنموذج المعتمد نفسه

   الهيكل واحد في الثلاثة: نفس الحقول وترتيبها ونفس التوقيعات ونفس رقم
   النموذج. ما يتغيّر هو المعالجة البصرية فقط، فلا يخرج أي ستايل عن
   النموذج المعتمد من الجودة.
   ========================================================================= */
const SHEET_THEMES = [
  { id: 'official', cls: '',           name: 'رسمي',
    desc: 'ألواح كحلية ممتلئة وشريطان عريضان — الشكل المعتمد الحالي.' },
  { id: 'classic',  cls: 't-classic',  name: 'كلاسيكي',
    desc: 'خطوط رفيعة على أبيض وعناوين مفرّدة — أنيق ويوفّر حبر الطابعة.' },
  { id: 'compact',  cls: 't-compact',  name: 'مضغوط',
    desc: 'سطور أكثف وحواف حادّة — محتوى أكثر في الورقة ودروس أقصر صفحاتٍ.' }
];
const THEME_DEFAULT = 'official';
function themeClass(id) {
  const t = SHEET_THEMES.find(x => x.id === id);
  return t ? t.cls : '';
}

/* ---------- بيانات يدخلها المعلّم ---------- */
const META_FIELDS = [
  { key: 'lessonNo', label: 'رقم الدرس', type: 'text', ph: 'مثال: ٤',                       remember: false, req: true },
  /* يُملأ من الخطة الزمنية؛ وإن تُرك فارغًا يستخرجه النموذج من صفحات الكتاب */
  { key: 'title',    label: 'عنوان الدرس', type: 'text', ph: 'يُملأ من الخطة تلقائيًا',      remember: false, noPrint: true },
  { key: 'date',     label: 'التاريخ',   type: 'date', ph: '',                               remember: false },
  { key: 'week',     label: 'الأسبوع',   type: 'text', ph: 'مثال: ٤',                       remember: false },
  { key: 'period',   label: 'الحصة',     type: 'text', ph: 'مثال: ٤',                       remember: false },
  { key: 'duration', label: 'الزمن',     type: 'text', ph: '٤٥ دقيقة',                       remember: true  },
  { key: 'unit',     label: 'الوحدة',    type: 'text', ph: 'الأولى',                         remember: true  },
  { key: 'subject',  label: 'المادة',    type: 'text', ph: 'أساسيات الهندسة الكهربائية',      remember: true, req: true },
  { key: 'grade',    label: 'الصف',      type: 'text', ph: 'الصف الأول الثانوي الصناعي',      remember: true, req: true },
  { key: 'dept',     label: 'القسم',     type: 'text', ph: 'التركيبات الكهربائية',            remember: true  },
  { key: 'teacher',  label: 'اسم المدرس', short: 'المدرس', type: 'text',
    ph: 'الاسم كما يُكتب في التوقيع', remember: true },
  { key: 'lang',     label: 'لغة المحتوى', type: 'select', remember: true, noPrint: true,
    options: [
      { v: 'auto', t: 'تلقائي حسب المادة' },
      { v: 'ar',   t: 'عربي' },
      { v: 'en',   t: 'إنجليزي' }
    ] }
];

/* الحقول التي تظهر في شريط المعلومات العلوي (بالترتيب من اليمين) */
const STRIP_FIELDS = ['date', 'week', 'period', 'duration', 'unit'];
/* الصفوف الثلاثة تحت الشريط */
const ROW_FIELDS   = ['subject', 'grade', 'dept', 'teacher'];

/* ---------- أقسام يولّدها الذكاء الاصطناعي ---------- */
/* kind:
   text      → نص
   list      → قائمة نقاط
   groups    → مجموعات معنونة، كل مجموعة قائمة
   items     → عناصر مرقّمة (عنوان + فقرة + نقاط + جدول)  ← جسم عرض الدرس
   checklist → قائمة بمربعات تأشير
   qa        → أسئلة بمساحة إجابة
   drills    → جدول تدريبات بعمود إجابة فارغ
*/
const SECTIONS = [
  { key: 'lessonTitle', label: 'عنوان الدرس', kind: 'text', place: 'title',
    ai: 'عنوان الدرس كما ورد في الكتاب — كلمات قليلة دقيقة.' },

  { key: 'objectives', label: 'الأهداف السلوكية', kind: 'groups', icon: 'target', place: 'intro',
    groups: [
      { key: 'cognitive', label: 'معرفية' },
      { key: 'skill',     label: 'مهارية' },
      { key: 'affective', label: 'وجدانية' }
    ],
    ai: 'أهداف سلوكية قابلة للقياس تبدأ بـ«أن يَـ...»: معرفية (٣–٤)، مهارية (٢–٣)، وجدانية (١–٢).' },

  { key: 'prerequisites', label: 'المتطلبات السابقة', kind: 'list', icon: 'link', place: 'trio',
    ai: '٢–٣ نقاط: ما يجب أن يتقنه الطالب قبل الدرس.' },

  { key: 'resources', label: 'الوسائل والمعينات', kind: 'list', icon: 'tools', place: 'trio',
    ai: '٣–٥ وسائل مطلوبة فعليًا لهذا الدرس تحديدًا.' },

  { key: 'strategies', label: 'استراتيجيات التدريس', kind: 'list', icon: 'bulb', place: 'trio',
    ai: '٢–٤ استراتيجيات مناسبة لطبيعة الدرس.' },

  { key: 'warmup', label: 'التمهيد والتهيئة', kind: 'text', icon: 'play', place: 'intro',
    ai: 'سطران أو ثلاثة: ربط بخبرة سابقة أو موقف واقعي + سؤال افتتاحي محدد.' },

  { key: 'content', label: 'عرض الدرس / خطوات سير الدرس', kind: 'items', icon: 'book', place: 'main',
    contLabel: 'استكمال المحتوى / خطوات سير الدرس',
    ai: 'قلب التحضير: من ٥ إلى ٩ عناصر مرقّمة تغطي الدرس كاملًا بالترتيب. ' +
        'كل عنصر: عنوان قصير ينتهي بنقطتين، ثم شرح مركّز (سطر أو سطران) و/أو نقاط، ' +
        'وجدول عند الحاجة (مثل جداول القيم أو المقارنات). ' +
        'أدرج الأمثلة المحلولة والقوانين والرموز والأرقام كما وردت في الدرس بالضبط.' },

  { key: 'drills', label: 'تدريبات سريعة', kind: 'drills', icon: 'pencil', place: 'row1',
    ai: 'جدول تدريب صفّي قصير: عمود «المطلوب» فيه ٣–٤ حالات من الدرس، وعمود إجابة يُترك فارغًا للطالب. ' +
        'اكتب أيضًا جملة تعليمات قصيرة فوق الجدول.' },

  { key: 'activities', label: 'أنشطة صفية', kind: 'checklist', icon: 'group', place: 'row1',
    ai: '٣ أنشطة صفية تطبيقية قصيرة من صلب الدرس، كل نشاط في سطر واحد.' },

  { key: 'assessment', label: 'التقويم', kind: 'qa', icon: 'quiz', place: 'row1',
    ai: 'سؤالان تقويميان حقيقيان من الدرس: أحدهما مباشر والآخر عكسي/تطبيقي، بصيغتهما الكاملة مع الأرقام.' },

  { key: 'warning', label: 'تنبيه', kind: 'text', icon: 'warn', place: 'row2', tone: 'red',
    ai: 'تنبيه واحد مهم (٢–٣ أسطر) عن خطأ شائع أو اشتراط سلامة في هذا الدرس تحديدًا.' },

  { key: 'homework', label: 'الواجب المنزلي', kind: 'checklist', icon: 'home', place: 'row2', numbered: true,
    ai: 'تكليفان محددان من الدرس بأرقام وقيم حقيقية، كل تكليف في سطر.' }
];

/* لوحة تُترك فارغة للكتابة اليدوية */
const BLANK_PANELS = [
  { key: 'teacherNotes', label: 'ملاحظات المعلم', icon: 'clip', place: 'row2', lines: 5 }
];

const SIGNATURES = [
  { label: 'المدرس',                              nameFrom: 'teacher' },
  { label: 'مدير إدارة التعليم النظري' },
  { label: 'مدير إدارة جودة وتكنولوجيا التعليم' }
];

/* =========================================================================
   التحضير العملي — نموذج إدارة التدريب العملي (F-PR-03)
   مبنيّ على «التحضير العملى ٣.docx» المعتمد: نفس الأقسام وترتيبها ونفس
   التوقيعات. استمارة التقييم بأسماء الطلاب ليست جزءًا من التحضير — تُطبع
   منفصلة وتُرفق بعد الطباعة.
   ========================================================================= */

/* الهوية تتغيّر في العملي: اسم الإدارة ورقم النموذج */
const IDENTITY_PRAC = { dept2: 'إدارة التدريب العملي', formCode: 'F-PR-03' };

const PRAC_FIELDS = [
  { key: 'lessonNo', label: 'رقم الموضوع', type: 'text', ph: 'مثال: ٣', remember: false, req: true },
  { key: 'title',    label: 'اسم الموضوع', type: 'text', ph: 'يُملأ من الخطة تلقائيًا', remember: false, noPrint: true },
  { key: 'date',     label: 'التاريخ',      type: 'date', remember: false },
  { key: 'period',   label: 'الحصة',        type: 'text', ph: 'مثال: ٣', remember: false },
  { key: 'duration', label: 'زمن التنفيذ',  type: 'text', ph: '٩٠ دقيقة', remember: true },
  { key: 'group',    label: 'المجموعة',     type: 'text', ph: 'مثال: أ', remember: true },
  { key: 'subject',  label: 'المادة / الورشة', type: 'text', ph: 'ورشة التركيبات الكهربائية', remember: true, req: true },
  { key: 'grade',    label: 'الصف / الفرقة', type: 'text', ph: 'الصف الأول الثانوي الصناعي', remember: true, req: true },
  { key: 'dept',     label: 'التخصص',       type: 'text', ph: 'التركيبات الكهربائية', remember: true },
  { key: 'teacher',  label: 'اسم المدرب', short: 'المدرب', type: 'text',
    ph: 'الاسم كما يُكتب في التوقيع', remember: true },
  { key: 'kind',     label: 'نوع الموضوع', type: 'select', remember: false, noPrint: true,
    options: [
      { v: 'exercise',  t: 'تمرين — يُنفّذه الطالب' },
      { v: 'operation', t: 'شرح عملية / عدة وأدوات' }
    ] },
  { key: 'lang',     label: 'لغة المحتوى', type: 'select', remember: true, noPrint: true,
    options: [
      { v: 'auto', t: 'تلقائي حسب المادة' },
      { v: 'ar',   t: 'عربي' },
      { v: 'en',   t: 'إنجليزي' }
    ] }
];

const PRAC_STRIP_FIELDS = ['date', 'period', 'duration', 'group'];
const PRAC_ROW_FIELDS   = ['subject', 'grade', 'dept', 'teacher'];

/* kinds إضافية للعملي:
   pairs → جدول عمودين مرقّمين (م | العدد والأدوات) × ٢
   draw  → مربع الرسم: صورة مقصوصة من الكتاب أو رسم بديل، وإلا إطار فارغ
*/
const PRAC_SECTIONS = [
  { key: 'topicTitle', label: 'اسم الموضوع', kind: 'text', place: 'title',
    ai: 'اسم الموضوع/التمرين كما ورد في الكتاب — كلمات قليلة دقيقة.' },

  { key: 'purpose', label: 'الغرض من الموضوع', kind: 'list', icon: 'target', place: 'intro',
    ai: '٣–٤ نقاط: الغرض من تنفيذ هذا الموضوع، كل نقطة تبدأ بفعل أدائي ' +
        '(أن يكتسب مهارة… أن يتمكّن من…) وتصف مهارة عملية لا معرفة نظرية.' },

  { key: 'elements', label: 'عناصر الموضوع', kind: 'list', icon: 'book', place: 'intro',
    ai: '٣–٥ عناصر: رؤوس الموضوعات التي يغطيها التمرين بالترتيب، عنصر في كل سطر.' },

  { key: 'materials', label: 'الخامات المطلوبة', kind: 'list', icon: 'clip', place: 'trio2',
    ai: '٣–٦ خامات مستهلكة فعلية لهذا التمرين بالمقاسات والكميات كما في الكتاب ' +
        '(مثال: سلك نحاس مرن ١×١.٥ مم² — ٣ متر).' },

  { key: 'tools', label: 'العدد والأدوات اللازمة', kind: 'pairs', icon: 'tools', place: 'main',
    ai: 'من ٦ إلى ١٠ عدد وأدوات وأجهزة قياس لازمة فعلًا لتنفيذ هذا التمرين، ' +
        'كل واحدة باسمها الفني الدقيق ومقاسها إن ذُكر. سطر واحد لكل أداة.' },

  { key: 'drawing', label: 'رسم التمرين', kind: 'draw', icon: 'image', place: 'main',
    ai: 'وصف الرسم المطلوب: لو الموضوع تمرين فهو شكل التمرين المنفَّذ ' +
        '(الدائرة أو التوصيل أو القطعة بأبعادها)، ولو شرح عملية فهو رسم العدة/الأداة ' +
        'أو مراحل العملية. سطران يوصفان ما يجب أن يظهر في الرسم.' },

  { key: 'steps', label: 'طريقة تنفيذ التمرين', kind: 'items', icon: 'play', place: 'main',
    contLabel: 'تابع طريقة تنفيذ التمرين',
    ai: 'قلب التحضير: من ٦ إلى ١٠ خطوات تنفيذ مرقّمة بالترتيب الفعلي على الطبيعة. ' +
        'كل خطوة: عنوان قصير ينتهي بنقطتين ثم وصف تنفيذي مباشر بصيغة الأمر ' +
        '(قِس… ثبّت… أوصل…) مع المقاسات والقيم والعِدد المستخدمة في الخطوة. ' +
        'أضف تحذيرًا فنيًا في الخطوة التي تحتاجه.' },

  { key: 'safety', label: 'قواعد الأمن الصناعي', kind: 'list', icon: 'warn', place: 'row1', tone: 'red',
    ai: '٤–٦ قواعد أمن صناعي مرتبطة بهذا التمرين تحديدًا وبالعِدد المستخدمة فيه، ' +
        'لا قواعد عامة مرسلة.' },

  { key: 'ppe', label: 'مهمات الوقاية الشخصية', kind: 'checklist', icon: 'group', place: 'row1',
    ai: '٣–٥ مهمات وقاية شخصية يلزم استخدامها في هذا التمرين (نظارة واقية، قفاز عازل…).' }
];

const PRAC_BLANK_PANELS = [
  { key: 'trainerNotes', label: 'ملاحظات المدرب', icon: 'clip', place: 'row1', lines: 4 }
];

const PRAC_SIGNATURES = [
  { label: 'مدرب المجموعة', nameFrom: 'teacher' },
  { label: 'رئيس قسم متابعة التدريب العملي' },
  { label: 'مدير إدارة التدريب العملي' }
];

/* ---------- حقول الخطة الزمنية ---------- */
const PLAN_FIELDS = [
  { key: 'subject',   label: 'المادة',            type: 'text', ph: 'أساسيات الهندسة الكهربائية', remember: true, req: true },
  { key: 'grade',     label: 'الصف',              type: 'text', ph: 'الصف الأول الثانوي الصناعي', remember: true, req: true },
  { key: 'dept',      label: 'القسم',             type: 'text', ph: 'التركيبات الكهربائية',       remember: true },
  { key: 'teacher',   label: 'اسم المدرس',        type: 'text', ph: '',                            remember: true },
  { key: 'year',      label: 'العام الدراسي',     type: 'text', ph: '٢٠٢٦ / ٢٠٢٧',                remember: true },
  { key: 'term',      label: 'الفصل الدراسي',     type: 'select', remember: true,
    options: [{ v: 'الفصل الدراسي الأول', t: 'الفصل الدراسي الأول' },
              { v: 'الفصل الدراسي الثاني', t: 'الفصل الدراسي الثاني' }] },
  { key: 'startDate', label: 'بداية الدراسة',     type: 'date', ph: '',                            remember: false, req: true },
  { key: 'weeks',     label: 'عدد الأسابيع',      type: 'number', ph: '١٥',                        remember: true, req: true }
];

/* أعمدة جدول الخطة — بالملّيمتر على ورقة A4 **طولية**
   المجموع = ١٩٦مم = عرض الورقة ٢١٠ ناقص هامشي الصفحة ٧مم لكل جهة.
   الورق كله في التطبيق مقاس واحد (طولي) لأن متصفح الموبايل يفرض مقاسًا
   واحدًا على الملف كله، فالصفحة العرضية كانت تُقصّ داخل ملف الترم. */
const PLAN_CONTENT_MM = 196;
const PLAN_COLUMNS = [
  { key: 'no',    label: 'م',          w: 9,  align: 'center' },
  { key: 'week',  label: 'الأسبوع',    w: 22, align: 'center' },
  { key: 'date',  label: 'التاريخ',    w: 22, align: 'center' },
  { key: 'unit',  label: 'الوحدة',     w: 26, align: 'center' },
  { key: 'items', label: 'المحتوى',    w: 86, align: 'right' },
  { key: 'notes', label: 'الملاحظات',  w: 31, align: 'right' }
];

/* أسباب الأسبوع الذي لا يُدرَّس فيه — يتخطّاه ترقيم الدروس تلقائيًا.
   آخر خيار يفتح خانة كتابة حرّة لسبب من عند المدرّس. */
const PLAN_OFF_OTHER = 'سبب آخر — اكتبه بنفسك';
const PLAN_OFF_REASONS = [
  'اختبار ميدتيرم',
  'اختبار نصف العام',
  'أسبوع تنظيمي وتمهيدي',
  PLAN_OFF_OTHER
];

const PLAN_SIGNATURES = [
  { label: 'المدرس', nameFrom: 'teacher' },
  { label: 'رئيس القسم' },
  { label: 'مدير إدارة التعليم النظري' },
  { label: 'مدير إدارة جودة وتكنولوجيا التعليم' },
  { label: 'المدير العام لمركز التدريب' }
];

/* ---------- حقول غلاف المادة ---------- */
const COVER_FIELDS = [
  { key: 'subject', label: 'المادة',        type: 'text', ph: 'أساسيات الهندسة الكهربائية', remember: true, req: true },
  { key: 'grade',   label: 'الصف الدراسي',  type: 'text', ph: 'الصف الأول الثانوي الصناعي', remember: true, req: true },
  { key: 'dept',    label: 'القسم / التخصص', type: 'text', ph: 'التركيبات الكهربائية',      remember: true },
  { key: 'teacher', label: 'اسم المدرس',    type: 'text', ph: '',                            remember: true, req: true },
  { key: 'year',    label: 'العام الدراسي', type: 'text', ph: '٢٠٢٦ / ٢٠٢٧',                remember: true, req: true },
  { key: 'term',    label: 'الفصل الدراسي', type: 'select', remember: true,
    options: [{ v: 'الفصل الدراسي الأول', t: 'الفصل الدراسي الأول' },
              { v: 'الفصل الدراسي الثاني', t: 'الفصل الدراسي الثاني' }] }
];

const WEEK_NAMES = ['', 'الأسبوع الأول', 'الأسبوع الثاني', 'الأسبوع الثالث', 'الأسبوع الرابع',
  'الأسبوع الخامس', 'الأسبوع السادس', 'الأسبوع السابع', 'الأسبوع الثامن', 'الأسبوع التاسع',
  'الأسبوع العاشر', 'الأسبوع الحادي عشر', 'الأسبوع الثاني عشر', 'الأسبوع الثالث عشر',
  'الأسبوع الرابع عشر', 'الأسبوع الخامس عشر', 'الأسبوع السادس عشر', 'الأسبوع السابع عشر',
  'الأسبوع الثامن عشر', 'الأسبوع التاسع عشر', 'الأسبوع العشرون'];
const weekName = n => WEEK_NAMES[n] || ('الأسبوع ' + toArabicDigits(n));

/* سبت الأسبوع رقم n بدءًا من تاريخ بداية الدراسة */
function weekSaturday(startISO, n) {
  if (!startISO) return '';
  const d = new Date(startISO + 'T00:00:00');
  if (isNaN(d)) return '';
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7));   /* السبت = 6 → أرجع لأقرب سبت */
  d.setDate(d.getDate() + (n - 1) * 7);
  return toArabicDigits(d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate());
}

/* نفس حساب سبت الأسبوع لكن بصيغة ISO — يملأ حقل التاريخ في نموذج التحضير */
function weekSaturdayISO(startISO, n) {
  if (!startISO) return '';
  const d = new Date(startISO + 'T00:00:00');
  if (isNaN(d)) return '';
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
  d.setDate(d.getDate() + (n - 1) * 7);
  const pad = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

const ORDINALS = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن',
  'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر',
  'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون'];

const AR_PAGE = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة'];

function toArabicDigits(s) {
  return String(s == null ? '' : s).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[+d]);
}
function lessonOrdinal(n) {
  const i = parseInt(String(n).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)), 10);
  return (i >= 1 && i < ORDINALS.length) ? ORDINALS[i] : toArabicDigits(n);
}

/* ===== js/icons.js ===== */
/* أيقونات SVG مسطّحة (24×24) تُستخدم في لوحات التحضير وشريط البيانات */
const ICONS = {
  book:  'M4 4h6a3 3 0 0 1 3 3v13a2.6 2.6 0 0 0-2-1H4zm16 0h-6a3 3 0 0 0-3 3v13a2.6 2.6 0 0 1 2-1h7z',
  target:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 3.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13m0 3.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  link:  'M10.6 13.4a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 0 1 1.4 1.4l-1.4 1.4a1 1 0 0 1-1.4 0M7 17a4 4 0 0 1 0-5.7l2.1-2.1 1.4 1.4-2.1 2.1a2 2 0 0 0 2.8 2.8l2.1-2.1 1.4 1.4-2.1 2.1A4 4 0 0 1 7 17m10-10a4 4 0 0 1 0 5.7l-2.1 2.1-1.4-1.4 2.1-2.1a2 2 0 0 0-2.8-2.8L10.7 10.6 9.3 9.2l2.1-2.1A4 4 0 0 1 17 7',
  tools: 'M14.7 2.3a5 5 0 0 0-5.6 6.9l-6.6 6.6a2 2 0 0 0 0 2.8l3 3a2 2 0 0 0 2.8 0l6.6-6.6a5 5 0 0 0 6.2-6.4l-3 3-2.6-.7-.7-2.6z',
  bulb:  'M9 21h6v-1.5H9zm3-19a6.5 6.5 0 0 0-4 11.6V16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.4A6.5 6.5 0 0 0 12 2',
  play:  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m-2 5.5 7 4.5-7 4.5z',
  pencil:'M3 17.2V21h3.8L18 9.8 14.2 6zM20.7 7.1a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8L18.9 8.9z',
  group: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6m0 2c-2.7 0-8 1.3-8 4v2h9v-2c0-1.2.6-2.3 1.6-3.2A15 15 0 0 0 8 13m8 0c-.6 0-1.3.1-2 .2 1.4 1 2 2.2 2 3.3V19h8v-2c0-2.7-5.3-4-8-4',
  quiz:  'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 16h-2v-2h2zm1.8-6.7-.9.9c-.7.7-1.1 1.3-1.1 2.3h-2v-.5c0-1 .4-1.9 1.1-2.6l1.2-1.3c.4-.3.6-.8.6-1.4a2 2 0 1 0-4 0H8a4 4 0 1 1 8 0c0 .9-.4 1.6-1.2 2.3',
  home:  'M12 3 2 12h3v8h5v-5h4v5h5v-8h3z',
  warn:  'M12 2 1 21h22zm0 6 6.5 11h-13zM11 11h2v4h-2zm0 5h2v2h-2z',
  clip:  'M17 3h-2.2a3 3 0 0 0-5.6 0H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m-5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2',
  cal:   'M7 2v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2zm12 8v10H5V10z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 10.4 4 2.4-.9 1.6L11 13V6h2z',
  week:  'M3 4h18v3H3zm0 5h4v4H3zm6 0h6v4H9zm8 0h4v4h-4zM3 15h4v4H3zm6 0h6v4H9zm8 0h4v4h-4z',
  unit:  'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  grade: 'M12 3 1 9l11 6 9-4.9V17h2V9zM5 13.2V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-3.8l-7 3.8z',
  bolt:  'M13 2 4 14h6l-1 8 9-12h-6z',
  gear:  'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m9.4 4a7.4 7.4 0 0 1-.1 1.2l2 1.6-1.9 3.3-2.4-1a7.6 7.6 0 0 1-2 1.2l-.4 2.6h-3.8l-.4-2.6a7.6 7.6 0 0 1-2-1.2l-2.4 1L2 14.8l2-1.6a7.4 7.4 0 0 1 0-2.4L2 9.2l2-3.3 2.4 1a7.6 7.6 0 0 1 2-1.2l.4-2.6h3.8l.4 2.6c.7.3 1.4.7 2 1.2l2.4-1 1.9 3.3-2 1.6c.1.4.1.8.1 1.2',
  image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2M8.5 13.5l2.5 3 3.5-4.5 4.5 6H5z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zm3 2v9h2v-9zm4 0v9h2v-9z',
  edit:  'M3 17.2V21h3.8L18 9.8 14.2 6zM20.7 7.1a1 1 0 0 0 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0l-1.8 1.8L18.9 8.9z'
};

function svgIcon(name, size, cls) {
  const d = ICONS[name] || ICONS.book;
  return `<svg class="${cls || 'ic'}" viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}

const STRIP_ICONS = { date: 'cal', week: 'week', period: 'clock', duration: 'clock', unit: 'unit',
  group: 'group' };
const ROW_ICONS   = { subject: 'book', grade: 'grade', dept: 'bolt', teacher: 'clip' };

/* ===== js/zip.js ===== */
/* =========================================================================
   zip.js — كاتب ZIP مصغّر (بدون ضغط) لتوليد ملفات .docx داخل المتصفح
   لا يحتاج أي مكتبة خارجية، ويعمل بالكامل بدون إنترنت.
   ========================================================================= */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
}

/**
 * files: [{ name: 'word/document.xml', data: string | Uint8Array }]
 * يُرجع Blob جاهز للتنزيل.
 */
function makeZip(files, mime) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = dosTime(now), date = dosDate(now);

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);      // version needed
    lv.setUint16(6, 0x0800, true);  // UTF-8 flag
    lv.setUint16(8, 0, true);       // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...locals, ...centrals, end], { type: mime || 'application/zip' });
}

/* ===== js/docx.js ===== */
/* =========================================================================
   docx.js — توليد ملف Word (.docx) حقيقي داخل المتصفح، بدون خادم
   نسخة مبسّطة ومنسّقة من الورقة، قابلة للتعديل والأرشفة.
   يعتمد على zip.js فقط ويعمل بالكامل بدون إنترنت.
   ========================================================================= */

const TW = { pageW: 11906, pageH: 16838, marg: 794 };   // A4 + هامش ١٫٤ سم
const CONTENT_W = TW.pageW - TW.marg * 2;

const xesc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEX = c => String(c || '#000000').replace('#', '').toUpperCase();
const xmlHead = s => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;

const OBJ_LABEL = {
  ar: { cognitive: 'الأهداف المعرفية:', skill: 'الأهداف المهارية:', affective: 'الأهداف الوجدانية:' },
  en: { cognitive: 'Knowledge objectives:', skill: 'Skill objectives:', affective: 'Attitude objectives:' }
};

/* اتجاه محتوى التحضير: يصبح true عندما تكون لغة المحتوى أجنبية */
let CONTENT_LTR = false;

/* فقرة/نص محتوى — تتبع لغة المحتوى (الترويسة والبيانات تبقى عربية RTL) */
function cPara(text, o) { return wPara(text, Object.assign({ ltr: CONTENT_LTR }, o || {})); }

/* تثبيت اتجاه المقاطع اللاتينية والرموز العلمية داخل Word بعلامات LRM */
function wordBidi(text) {
  const s = String(text == null ? '' : text);
  try {
    return s.replace(LATIN_RUN, m => {
      const tail = m.match(/\s+$/);
      const core = tail ? m.slice(0, -tail[0].length) : m;
      return '‎' + core + '‎' + (tail ? tail[0] : '');
    });
  } catch (_) { return s; }
}

/* ---------- لبنات ---------- */
function wRun(text, o = {}) {
  const rpr = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' +
    (o.b ? '<w:b/><w:bCs/>' : '') +
    (o.color ? `<w:color w:val="${HEX(o.color)}"/>` : '') +
    `<w:sz w:val="${Math.round((o.size || 10.5) * 2)}"/><w:szCs w:val="${Math.round((o.size || 10.5) * 2)}"/>` +
    (o.ltr ? '<w:rtl w:val="0"/>' : '<w:rtl/>') + '</w:rPr>';
  const body = o.ltr ? String(text == null ? '' : text) : wordBidi(text);
  return body.split('\n').map((p, i) =>
    `<w:r>${rpr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xesc(p)}</w:t></w:r>`).join('');
}

/* ترتيب العناصر داخل w:pPr و w:tcPr إلزامي حسب مخطط OOXML */
function wPara(text, o = {}) {
  const align = o.align || (o.ltr ? 'left' : 'right');
  const ppr = '<w:pPr>' +
    (o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${HEX(o.shade)}"/>` : '') +
    (o.ltr ? '<w:bidi w:val="0"/>' : '<w:bidi/>') +
    `<w:spacing w:before="${o.before == null ? 20 : o.before}" w:after="${o.after == null ? 20 : o.after}" w:line="264" w:lineRule="auto"/>` +
    (o.ind ? (o.ltr ? `<w:ind w:left="${o.ind}"/>` : `<w:ind w:right="${o.ind}"/>`) : '') +
    `<w:jc w:val="${align}"/>` +
    '</w:pPr>';
  return `<w:p>${ppr}${wRun(text, o)}</w:p>`;
}

function wCell(content, o = {}) {
  const w = `<w:tcW w:w="${o.w || 0}" w:type="${o.w ? 'dxa' : 'auto'}"/>`;
  const span = o.span ? `<w:gridSpan w:val="${o.span}"/>` : '';
  const shd = o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${HEX(o.shade)}"/>` : '';
  const mar = '<w:tcMar><w:top w:w="50" w:type="dxa"/><w:start w:w="80" w:type="dxa"/>' +
    '<w:bottom w:w="50" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tcMar>';
  const va = `<w:vAlign w:val="${o.vAlign || 'center'}"/>`;
  let body = Array.isArray(content) ? content.join('') : content;
  if (!body) body = wPara('');
  /* مخطط OOXML يُلزم بفقرة بعد أي جدول متداخل داخل خلية — بدونها يلصق
     Word/LibreOffice الخلايا في عمود واحد فتنهار صفوف اللوحات الثلاثية */
  if (/<\/w:tbl>\s*$/.test(body)) body += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>';
  return `<w:tc><w:tcPr>${w}${span}${shd}${mar}${va}</w:tcPr>${body}</w:tc>`;
}

/** rows: مصفوفة نصوص خلايا لكل صف — grid: عرض كل عمود (إلزامي لصحة الملف) */
function wTable(rows, o = {}) {
  const bc = HEX(o.border || '#8FA0C6');
  const bd = ['top', 'start', 'bottom', 'end', 'insideH', 'insideV']
    .map(s => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="${bc}"/>`).join('');
  const grid = (o.grid && o.grid.length ? o.grid : [o.w || CONTENT_W])
    .map(w => `<w:gridCol w:w="${Math.round(w)}"/>`).join('');
  return '<w:tbl><w:tblPr>' + (o.ltr ? '' : '<w:bidiVisual/>') +
    `<w:tblW w:w="${o.w || CONTENT_W}" w:type="dxa"/>` +
    `<w:tblBorders>${bd}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>` +
    rows.map(r => /^\s*<w:tr[ >]/.test(r) ? r : `<w:tr>${r}</w:tr>`).join('') + '</w:tbl>';
}
const evenGrid = n => Array.from({ length: n }, () => Math.floor(CONTENT_W / n));

const gap = h => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${h || 110}" w:lineRule="exact"/></w:pPr></w:p>`;

/* ---------- عناصر التحضير ---------- */
function head(label, navy) {
  return wTable([
    `<w:tr>${wCell(wPara(label, { b: true, size: 11, color: '#FFFFFF', before: 30, after: 30 }),
      { shade: navy, w: CONTENT_W })}</w:tr>`
  ], { border: navy, grid: [CONTENT_W] });
}
const box = inner => wTable([`<w:tr>${wCell(inner, { w: CONTENT_W, vAlign: 'top' })}</w:tr>`],
  { grid: [CONTENT_W] });

const bullets = arr => (arr && arr.length ? arr : ['—'])
  .map(t => cPara('•  ' + t, { ind: 110 }));

/* width: عرض الجدول الفعلي — إلزامي داخل اللوحات الثلاثية وإلا خرجت الأعمدة
   عن الخلية فاختفى محتواها في Word */
function dataTable(columns, rows, navy, extraCol, width) {
  const W = width || CONTENT_W;
  const cols = extraCol ? columns.concat([extraCol]) : columns;
  const first = Math.max(280, Math.round(W * 0.09));
  const rest = Math.floor((W - first) / cols.length);
  const grid = [first].concat(cols.map(() => rest));
  const L = CONTENT_LTR;
  const num = i => L ? String(i) : toArabicDigits(i);
  const hr = '<w:tr>' + wCell(wPara(L ? '#' : 'م', { b: true, color: '#FFFFFF', align: 'center', size: 9.5, ltr: L }), { w: first, shade: navy }) +
    cols.map(c => wCell(wPara(c, { b: true, color: '#FFFFFF', align: 'center', size: 9.5, ltr: L }), { w: rest, shade: navy })).join('') + '</w:tr>';
  const body = rows.map((r, i) => {
    const cells = Array.isArray(r) ? r : [r];
    return '<w:tr>' + wCell(wPara(num(i + 1), { align: 'center', size: 9.5, ltr: L }), { w: first, shade: i % 2 ? '#F3F6FC' : null }) +
      cols.map((c, ci) => wCell(cPara(extraCol && ci === cols.length - 1 ? '' : (cells[ci] || ''),
        { size: 9.5 }), { w: rest, vAlign: 'top', shade: i % 2 ? '#F3F6FC' : null })).join('') + '</w:tr>';
  });
  return wTable([hr, ...body], { grid, ltr: CONTENT_LTR, w: W });
}

function contentItems(items, navy, red) {
  const out = [];
  (items || []).forEach((it, i) => {
    const n = CONTENT_LTR ? String(i + 1) : toArabicDigits(i + 1);
    out.push(cPara(n + '.  ' + (it.heading || ''), { b: true, color: navy, size: 11, before: 60 }));
    if (it.body) out.push(cPara(it.body, { ind: 110 }));
    if (it.bullets && it.bullets.length) out.push(...bullets(it.bullets));
    if (it.table && it.table.columns) {
      if (it.table.title) out.push(cPara(it.table.title, { b: true, color: red, size: 10, ind: 110 }));
      out.push(dataTable(it.table.columns, it.table.rows || [], navy));
      out.push(gap(60));
    }
  });
  if (!out.length) out.push(cPara('—'));
  return out;
}

/* =========================================================================
   من هنا: بناء المستند ليطابق ورقة الـPDF قسمًا بقسم
   القاعدة: أي قسم يظهر في المعاينة يظهر في Word بنفس الترتيب ونفس الألوان
   ونفس ترتيب الأعمدة. ما لا يستطيعه Word (الأشرطة المائلة والعلامة المائية)
   يُحذف فقط — لا يُستبدل بشيء آخر.
   ========================================================================= */

/* ---------- الصور داخل المستند ---------- */
/* Word يحتاج كل صورة كملف داخل الحزمة + علاقة + خانة رسم في المتن */
let MEDIA = [];          /* [{ name, data:Uint8Array, rid }] */

function mediaReset() { MEDIA = []; }

function mediaAdd(bytes, ext) {
  const n = MEDIA.length + 1;
  const m = { name: `image${n}.${ext || 'png'}`, data: bytes, rid: `rId${100 + n}` };
  MEDIA.push(m);
  return m;
}

const EMU = px => Math.round(px * 9525);      /* بكسل ← EMU */

/** خانة رسم داخل فقرة — inline drawing */
function wImage(m, wPx, hPx, alt) {
  const id = MEDIA.indexOf(m) + 1;
  return '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/>' +
    '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr>' +
    '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${EMU(wPx)}" cy="${EMU(hPx)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Picture ${id}" descr="${xesc(alt || '')}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${m.name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${m.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${EMU(wPx)}" cy="${EMU(hPx)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

/** يفكّ data:URL إلى بايتات */
function dataUrlBytes(url) {
  try {
    const i = url.indexOf(',');
    const head = url.slice(0, i), b64 = url.slice(i + 1);
    if (!/;base64/i.test(head)) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    const ext = /png/i.test(head) ? 'png' : (/jpe?g/i.test(head) ? 'jpg' : null);
    return ext ? { bytes: out, ext } : null;
  } catch (_) { return null; }
}

/* ---------- ترويسة الهوية — مطابقة لأعلى ورقة الـPDF ---------- */
/* شبكة الورقة: بيانات الجهة يمينًا · العنوان وسطًا · اللوجو يسارًا */
function sheetHead(id, title, sub, logoMedia) {
  const navy = id.navy, red = id.red;
  const wOrg = Math.round(CONTENT_W * 0.34);
  const wLogo = Math.round(CONTENT_W * 0.13);
  const wMid = CONTENT_W - wOrg - wLogo;

  const org = wCell([
    wPara(id.org, { b: true, size: 13, color: navy, after: 0 }),
    wPara(id.dept1, { b: true, size: 10, color: red, before: 0, after: 0 }),
    wPara(id.dept2, { size: 9.5, color: navy, before: 0 })
  ], { w: wOrg, vAlign: 'center' });

  const mid = wCell([
    wPara(title, { b: true, size: 19, color: navy, align: 'center', after: 0 }),
    wPara(sub || '', { b: true, size: 9.5, color: navy, align: 'center', before: 0 })
  ], { w: wMid, vAlign: 'center' });

  const logo = wCell(
    logoMedia ? wImage(logoMedia, 62, 62, 'logo') : wPara(''),
    { w: wLogo, vAlign: 'center' });

  return wTable([`<w:tr>${org}${mid}${logo}</w:tr>`],
    { grid: [wOrg, wMid, wLogo], border: '#FFFFFF' });
}

/* شريط عنوان الدرس الكحلي — نفس الشريط في المعاينة */
function titleBar(label, value, id) {
  return wTable([`<w:tr>${wCell(
    wPara(label + ' ' + (value || ''), { b: true, size: 13, color: '#FFFFFF', align: 'center', before: 40, after: 40 }),
    { w: CONTENT_W, shade: id.navy })}</w:tr>`], { border: id.navy, grid: [CONTENT_W] });
}

/* شريط بيانات الحصة — خانات متجاورة كما في الورقة */
function metaStrip(fields, keys, meta, id) {
  const cells = keys.map(k => {
    const f = fields.find(x => x.key === k) || { label: k };
    const v = (k === 'date') ? (meta.dateText || meta.date || '') : (meta[k] || '');
    return { lab: f.label, val: toArabicDigits(v || '—') };
  });
  const w = Math.floor(CONTENT_W / cells.length);
  return wTable(['<w:tr>' + cells.map(c => wCell([
    wPara(c.lab, { b: true, size: 8.5, color: id.navy, align: 'center', after: 0 }),
    wPara(c.val, { b: true, size: 10, align: 'center', before: 0 })
  ], { w, shade: '#EDF1F9' })).join('') + '</w:tr>'],
    { grid: cells.map(() => w), border: id.navy });
}

/* صفوف المادة/الصف/القسم/المدرس — وسم كحلي ثم القيمة */
function metaRows(fields, keys, meta, id) {
  const tagW = Math.round(CONTENT_W * 0.17);
  const valW = CONTENT_W - tagW;
  const rows = keys.map(k => {
    const f = fields.find(x => x.key === k) || { label: k };
    return '<w:tr>' +
      wCell(wPara(f.short || f.label, { b: true, size: 9.5, color: '#FFFFFF', align: 'center' }),
        { w: tagW, shade: id.navy }) +
      wCell(wPara(meta[k] || '', { b: true, size: 10.5 }), { w: valW }) + '</w:tr>';
  });
  return wTable(rows, { grid: [tagW, valW], border: id.navy });
}

/* لوحة كاملة: رأس كحلي + جسم مؤطَّر — نفس .panel في الورقة */
function panelX(label, inner, id, tone) {
  const c = (tone === 'red') ? id.red : id.navy;
  return wTable([
    `<w:tr>${wCell(wPara(label, { b: true, size: 10.5, color: '#FFFFFF', before: 25, after: 25 }),
      { w: CONTENT_W, shade: c })}</w:tr>`,
    `<w:tr>${wCell(inner, { w: CONTENT_W, vAlign: 'top', shade: tone === 'red' ? '#FDF2F3' : null })}</w:tr>`
  ], { border: c, grid: [CONTENT_W] });
}

/* ثلاث لوحات جنبًا إلى جنب — نفس .trio في الورقة */
const TRIO_W = Math.floor(CONTENT_W / 3) - 160;

function trioX(panels, id) {
  const list = panels.filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return panelX(list[0].label, list[0].inner, id, list[0].tone);
  const w = Math.floor(CONTENT_W / list.length);
  const iw = w - 160;
  const cells = list.map(p => {
    const c = (p.tone === 'red') ? id.red : id.navy;
    const t = wTable([
      `<w:tr>${wCell(wPara(p.label, { b: true, size: 9.5, color: '#FFFFFF', align: 'center', before: 20, after: 20 }),
        { w: iw, shade: c })}</w:tr>`,
      `<w:tr>${wCell(p.inner, { w: iw, vAlign: 'top', shade: p.tone === 'red' ? '#FDF2F3' : null })}</w:tr>`
    ], { border: c, grid: [iw], w: iw });
    return wCell(t, { w, vAlign: 'top' });
  });
  return wTable(['<w:tr>' + cells.join('') + '</w:tr>'],
    { grid: list.map(() => w), border: '#FFFFFF' });
}

/* خانات التوقيع — نفس .signs */
function signsX(list, meta, id) {
  const w = Math.floor(CONTENT_W / list.length);
  return wTable([
    '<w:tr>' + list.map(sig => wCell(wPara(sig.label,
      { b: true, align: 'center', size: 9.5, color: id.navy }), { w, shade: '#EDF1F9' })).join('') + '</w:tr>',
    '<w:tr>' + list.map(sig => wCell([
      wPara(sig.nameFrom ? (meta[sig.nameFrom] || '') : '', { align: 'center', size: 9.5, b: true, after: 0 }),
      wPara(''), wPara('')
    ], { w, vAlign: 'top' })).join('') + '</w:tr>'
  ], { grid: list.map(() => w), border: id.navy });
}

/* أسطر فارغة للكتابة اليدوية — نفس .lines */
const blankLines = n => Array.from({ length: n || 4 },
  () => wPara('.'.repeat(95), { size: 9.5, color: '#8A97B4' }));

/* قائمة تأشير — نفس .check */
const checkList = (arr, numbered) => (arr && arr.length ? arr : ['—']).map((t, i) =>
  cPara((numbered ? ((CONTENT_LTR ? String(i + 1) : toArabicDigits(i + 1)) + ')  ') : '') + '☐  ' + t, { ind: 110 }));

/* =========================================================================
   التحضير النظري
   ========================================================================= */
function buildDocumentXml(data, meta, id, logoM, figM) {
  const navy = id.navy, red = id.red;
  let b = '';

  b += sheetHead(id, 'تحضير الدرس ' + lessonOrdinal(meta.lessonNo || 1), '', logoM);
  b += titleBar('عنوان الدرس:', data.lessonTitle || '', id) + gap(80);
  b += metaStrip(META_FIELDS, STRIP_FIELDS, meta, id) + gap(70);
  b += metaRows(META_FIELDS, ROW_FIELDS, meta, id) + gap(90);

  /* الأهداف */
  if (data.objectives) {
    const inner = [];
    (SECTIONS.find(s => s.key === 'objectives').groups || []).forEach(g => {
      const it = (data.objectives[g.key] || []).filter(Boolean);
      if (!it.length) return;
      inner.push(cPara(OBJ_LABEL[CONTENT_LTR ? 'en' : 'ar'][g.key] || g.label,
        { b: true, color: red, size: 10.5, before: 40 }));
      inner.push(...bullets(it));
    });
    b += panelX('الأهداف السلوكية', inner.length ? inner : [cPara('—')], id) + gap(80);
  }

  /* الثلاثي: متطلبات / وسائل / استراتيجيات — جنبًا إلى جنب كما في الورقة */
  b += trioX([
    (data.prerequisites || []).length && { label: 'المتطلبات السابقة', inner: bullets(data.prerequisites) },
    (data.resources || []).length && { label: 'الوسائل والمعينات', inner: bullets(data.resources) },
    (data.strategies || []).length && { label: 'استراتيجيات التدريس', inner: bullets(data.strategies) }
  ], id) + gap(80);

  if (data.warmup) b += panelX('التمهيد والتهيئة', [cPara(data.warmup)], id) + gap(80);

  /* عرض الدرس — ومعه الرسم التوضيحي كما في الورقة */
  const main = [];
  if (figM) {
    main.push(wPara(figM.caption || 'الرسم التوضيحي',
      { b: true, size: 10, color: navy, align: 'center', after: 0 }));
    main.push(wImage(figM.media, figM.w, figM.h, figM.caption));
  }
  main.push(...contentItems(data.content, navy, red));
  b += panelX('عرض الدرس / خطوات سير الدرس', main, id) + gap(80);

  /* الصف الأول: تدريبات · أنشطة · تقويم */
  const drillsInner = [];
  if (data.drills && data.drills.rows && data.drills.rows.length) {
    if (data.drills.instruction) drillsInner.push(cPara(data.drills.instruction, { b: true, size: 10 }));
    drillsInner.push(dataTable(data.drills.columns || ['المطلوب'], data.drills.rows, navy,
      CONTENT_LTR ? 'Answer' : 'الإجابة', TRIO_W));
  }
  const qaInner = [];
  if (data.assessment && data.assessment.questions && data.assessment.questions.length) {
    data.assessment.questions.forEach(q => {
      qaInner.push(cPara((q.label || (CONTENT_LTR ? 'Question' : 'سؤال')) + ':',
        { b: true, color: red, size: 10.5, before: 40, after: 0 }));
      qaInner.push(cPara(q.question || '', { ind: 110, after: 0 }));
      qaInner.push(cPara((CONTENT_LTR ? 'Answer: ' : 'الإجابة: ') + '.'.repeat(60),
        { size: 9.5, color: '#8A97B4', ind: 110 }));
    });
  }
  b += trioX([
    drillsInner.length && { label: 'تدريبات سريعة', inner: drillsInner },
    (data.activities || []).length && { label: 'أنشطة صفية', inner: checkList(data.activities) },
    qaInner.length && { label: 'التقويم', inner: qaInner }
  ], id) + gap(80);

  /* الصف الثاني: تنبيه · واجب · ملاحظات */
  b += trioX([
    data.warning && { label: 'تنبيه', inner: [cPara(data.warning, { b: true })], tone: 'red' },
    (data.homework || []).length && { label: 'الواجب المنزلي', inner: checkList(data.homework, true) },
    { label: 'ملاحظات المعلم', inner: blankLines(4) }
  ], id) + gap(120);

  b += signsX(SIGNATURES, meta, id);

  return docBody(b);
}

/* =========================================================================
   تحضير التدريب العملي
   ========================================================================= */
function buildPracDocumentXml(data, meta, id, logoM, figM) {
  const navy = id.navy, red = id.red;
  let b = '';

  b += sheetHead(id, 'تحضير الموضوع ' + lessonOrdinal(meta.lessonNo || 1), '', logoM);
  b += titleBar('اسم الموضوع:', data.topicTitle || '', id) + gap(80);
  b += metaStrip(PRAC_FIELDS, PRAC_STRIP_FIELDS, meta, id) + gap(70);
  b += metaRows(PRAC_FIELDS, PRAC_ROW_FIELDS, meta, id) + gap(90);

  b += trioX([
    (data.purpose || []).length  && { label: 'الغرض من الموضوع', inner: bullets(data.purpose) },
    (data.elements || []).length && { label: 'عناصر الموضوع', inner: bullets(data.elements) }
  ], id) + gap(80);

  if ((data.materials || []).length)
    b += panelX('الخامات المطلوبة', bullets(data.materials), id) + gap(80);

  /* العدد والأدوات — عمودان مرقّمان كما في النموذج */
  if ((data.tools || []).length) {
    const list = data.tools, half = Math.ceil(list.length / 2);
    const nw = Math.floor(CONTENT_W * 0.08), tw = Math.floor(CONTENT_W * 0.42);
    const hr = '<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' +
      [['م', nw], ['العدة / الأداة', tw], ['م', nw], ['العدة / الأداة', tw]].map(([t, w]) =>
        wCell(wPara(t, { b: true, size: 9.5, color: '#FFFFFF', align: 'center' }), { w, shade: navy })).join('') +
      '</w:tr>';
    const trs = [hr];
    for (let i = 0; i < half; i++) {
      const j = i + half;
      trs.push('<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
        wCell(wPara(toArabicDigits(i + 1), { size: 9.5, align: 'center', b: true }), { w: nw, shade: '#F5F8FD' }) +
        wCell(cPara(list[i] || '', { size: 9.5 }), { w: tw }) +
        wCell(wPara(j < list.length ? toArabicDigits(j + 1) : '', { size: 9.5, align: 'center', b: true }), { w: nw, shade: '#F5F8FD' }) +
        wCell(cPara(list[j] || '', { size: 9.5 }), { w: tw }) + '</w:tr>');
    }
    b += panelX('العدد والأدوات اللازمة',
      wTable(trs, { border: navy, grid: [nw, tw, nw, tw] }), id) + gap(80);
  }

  /* رسم التمرين */
  const drawTitle = (data.practKind === 'operation') ? 'رسم العملية / العدة والأدوات' : 'رسم التمرين';
  const dInner = [];
  if (data.drawing) dInner.push(cPara(data.drawing, { size: 9.5, b: true, color: navy }));
  if (figM) dInner.push(wImage(figM.media, figM.w, figM.h, figM.caption));
  else for (let i = 0; i < 9; i++) dInner.push(wPara('', { size: 11 }));
  b += panelX(drawTitle, dInner, id) + gap(80);

  if ((data.steps || []).length)
    b += panelX('طريقة تنفيذ التمرين', contentItems(data.steps, navy, red), id) + gap(80);

  b += trioX([
    (data.safety || []).length && { label: 'قواعد الأمن الصناعي', inner: bullets(data.safety), tone: 'red' },
    (data.ppe || []).length && { label: 'مهمات الوقاية الشخصية', inner: checkList(data.ppe) },
    { label: 'ملاحظات المدرب', inner: blankLines(4) }
  ], id) + gap(120);

  b += signsX(PRAC_SIGNATURES, meta, id);

  return docBody(b);
}

/* =========================================================================
   الخطة الزمنية — ورقة **طولية** بنفس مقاس باقي التطبيق
   ========================================================================= */
function buildPlanDocumentXml(p, id, logoM) {
  const navy = id.navy, meta = p.meta;
  const total = PLAN_COLUMNS.reduce((a, c) => a + c.w, 0);
  const grid = PLAN_COLUMNS.map(c => Math.round(CONTENT_W * c.w / total));
  let b = '';

  b += sheetHead(id, 'الخطة الزمنية', (meta.term || '') + '   ·   ' + (meta.year || ''), logoM);
  b += titleBar('المادة:', meta.subject || '', id) + gap(80);

  /* شريط البيانات — نفس .pl-meta */
  const info = [['الصف', meta.grade], ['القسم', meta.dept], ['المدرس', meta.teacher]];
  const cw = Math.floor(CONTENT_W / 9), vw = Math.floor(CONTENT_W / 3) - cw;
  b += wTable(['<w:tr>' + info.map(x =>
    wCell(wPara(x[0], { b: true, size: 9, color: navy, align: 'center' }), { w: cw, shade: '#EDF1F9' }) +
    wCell(wPara(x[1] || '—', { size: 9.5, b: true, align: 'center' }), { w: vw })).join('') + '</w:tr>'],
    { grid: [cw, vw, cw, vw, cw, vw], border: navy }) + gap(90);

  /* الجدول — الصف لا ينقسم بين ورقتين، والترويسة تتكرر */
  const hr = '<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' + PLAN_COLUMNS.map((c, k) =>
    wCell(wPara(c.label, { b: true, color: '#FFFFFF', align: 'center', size: 9.5 }),
      { w: grid[k], shade: navy })).join('') + '</w:tr>';

  const rows = p.rows.map((r, i) => {
    const shade = r.off ? '#EEF2F9' : (i % 2 ? '#F5F8FD' : null);
    const cell = (k, content, o) => wCell(content, Object.assign({ w: grid[k], shade }, o || {}));

    if (r.off) {
      return '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
        cell(0, wPara(toArabicDigits(i + 1), { align: 'center', size: 9.5, b: true })) +
        cell(1, wPara(weekName(i + 1), { align: 'center', size: 9.5, b: true })) +
        cell(2, wPara(weekSaturday(meta.startDate, i + 1), { align: 'center', size: 9 })) +
        wCell(wPara(r.offReason || 'أسبوع بلا دروس',
          { align: 'center', size: 10, b: true, color: navy }),
          { w: grid[3] + grid[4] + grid[5], shade, span: 3 }) +
        '</w:tr>';
    }

    const items = (r.items || []).filter(x => (x.name || '').trim() || (x.desc || '').trim());
    const inner = items.length ? [] : [wPara('')];
    items.forEach(it => {
      if (it.name) inner.push(wPara(it.name, { b: true, color: navy, size: 9.5, after: 0 }));
      if (it.desc) inner.push(wPara(it.desc, { size: 8.5, before: 0 }));
    });

    return '<w:tr><w:trPr><w:cantSplit/></w:trPr>' +
      cell(0, wPara(toArabicDigits(i + 1), { align: 'center', size: 9.5, b: true })) +
      cell(1, wPara(weekName(i + 1), { align: 'center', size: 9 })) +
      cell(2, wPara(weekSaturday(meta.startDate, i + 1), { align: 'center', size: 9 })) +
      cell(3, wPara(r.unit || '', { align: 'center', size: 9 })) +
      cell(4, inner, { vAlign: 'top' }) +
      cell(5, wPara(r.notes || '', { size: 8.5 }), { vAlign: 'top' }) +
      '</w:tr>';
  });
  b += wTable([hr, ...rows], { grid, border: navy }) + gap(160);

  b += signsX(PLAN_SIGNATURES, meta, id);

  return docBody(b);
}

/* غلاف المستند وإعداد الصفحة — واحد لكل الأنواع (A4 طولي) */
function docBody(b) {
  const sect = '<w:sectPr>' +
    '<w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/>' +
    `<w:pgSz w:w="${TW.pageW}" w:h="${TW.pageH}"/>` +
    `<w:pgMar w:top="1000" w:right="${TW.marg}" w:bottom="900" w:left="${TW.marg}" w:header="420" w:footer="380"/>` +
    '<w:bidi/></w:sectPr>';
  return xmlHead('<w:document ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body>${b}${sect}</w:body></w:document>`);
}

/* ---------- الترويسة والتذييل ---------- */
function headerXml(id) {
  const w3 = Math.floor(CONTENT_W / 3);
  return xmlHead('<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    wTable(['<w:tr>' +
      wCell(wPara(id.formCode, { b: true, size: 8.5, color: id.navy }), { w: w3 }) +
      wCell(wPara(id.dept1, { align: 'center', size: 8.5, color: id.navy }), { w: w3 }) +
      wCell(wPara(`إصدار (${id.edition}) | تعديل (${id.revision})`, { align: 'left', size: 8.5, color: id.navy }), { w: w3 }) +
      '</w:tr>'], { border: id.navy, grid: [w3, w3, w3] }) + '</w:hdr>');
}

function footerXml(id) {
  const w3 = Math.floor(CONTENT_W / 3);
  const fld = f => '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    `<w:r><w:instrText xml:space="preserve"> ${f} </w:instrText></w:r>` +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const pg = '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr>' +
    wRun('صفحة ', { size: 8.5 }) + fld('PAGE') + wRun(' من ', { size: 8.5 }) + fld('NUMPAGES') + '</w:p>';
  return xmlHead('<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    wTable(['<w:tr>' +
      wCell(wPara(id.issueDate, { size: 8.5 }), { w: w3 }) +
      wCell(pg, { w: w3 }) +
      wCell(wPara('وثيقة معتمدة', { align: 'left', size: 8.5, b: true, color: id.red }), { w: w3 }) +
      '</w:tr>'], { border: id.navy, grid: [w3, w3, w3] }) + '</w:ftr>');
}

const STYLES_XML = xmlHead('<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' +
  '<w:sz w:val="21"/><w:szCs w:val="21"/><w:rtl/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:bidi/><w:jc w:val="right"/><w:spacing w:after="20" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>');

const SETTINGS_XML = xmlHead('<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:updateFields w:val="true"/></w:settings>');

/* =========================================================================
   تجميع الحزمة
   ========================================================================= */
const CT_BASE = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

function packDocx(documentXml, id) {
  const defaults =
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>';

  const mediaRels = MEDIA.map(m =>
    `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('');

  const files = [
    { name: '[Content_Types].xml', data: xmlHead(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + defaults +
      `<Override PartName="/word/document.xml" ContentType="${CT_BASE}.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${CT_BASE}.styles+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="${CT_BASE}.settings+xml"/>` +
      `<Override PartName="/word/header1.xml" ContentType="${CT_BASE}.header+xml"/>` +
      `<Override PartName="/word/footer1.xml" ContentType="${CT_BASE}.footer+xml"/>` +
      '</Types>') },
    { name: '_rels/.rels', data: xmlHead(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>') },
    { name: 'word/_rels/document.xml.rels', data: xmlHead(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' +
      '<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
      mediaRels + '</Relationships>') },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml',   data: STYLES_XML },
    { name: 'word/settings.xml', data: SETTINGS_XML },
    { name: 'word/header1.xml',  data: headerXml(id) },
    { name: 'word/footer1.xml',  data: footerXml(id) }
  ];
  MEDIA.forEach(m => files.push({ name: 'word/media/' + m.name, data: m.data }));
  return makeZip(files, CT_BASE + '.document');
}

/* يجهّز اللوجو والرسم كصور قبل البناء (رسم SVG ← PNG) */
async function prepMedia(id, figure, wPx) {
  mediaReset();
  let logoM = null, figM = null;

  if (id.logo) {
    const d = dataUrlBytes(id.logo);
    if (d) logoM = mediaAdd(d.bytes, d.ext);
  }
  if (!logoM) {
    const png = await svgToPng(defaultLogoSvg(id).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '), 200);
    if (png) logoM = mediaAdd(new Uint8Array(await png.blob.arrayBuffer()), 'png');
  }
  if (figure && figure.src) {
    /* صورة من الكتاب — تُدرج كما هي */
    const d = dataUrlBytes(figure.src);
    if (d) {
      const dim = await imageSize(figure.src);
      const m = mediaAdd(d.bytes, d.ext);
      const w = wPx || 430;
      figM = { media: m, w, h: Math.round(w * (dim ? dim.h / dim.w : 0.65)), caption: figure.caption };
    }
  } else if (figure && figure.svg) {
    const png = await svgToPng(figure.svg, 1400);
    if (png) {
      const m = mediaAdd(new Uint8Array(await png.blob.arrayBuffer()), 'png');
      const w = wPx || 430;
      figM = { media: m, w, h: Math.round(w * png.h / png.w), caption: figure.caption };
    }
  }
  return { logoM, figM };
}

async function buildDocx(data, meta, id) {
  id = id || IDENTITY_DEFAULT;
  CONTENT_LTR = (data && data.contentLang === 'en');
  const { logoM, figM } = await prepMedia(id, readFigure(data), 400);
  return packDocx(buildDocumentXml(data, meta, id, logoM, figM), id);
}

async function buildPracDocx(data, meta, id) {
  const pid = Object.assign({}, id || IDENTITY_DEFAULT, IDENTITY_PRAC);
  CONTENT_LTR = (data && data.contentLang === 'en');
  const { logoM, figM } = await prepMedia(pid, readFigure(data), 430);
  return packDocx(buildPracDocumentXml(data, meta, pid, logoM, figM), pid);
}

async function buildPlanDocx(p, id) {
  id = id || IDENTITY_DEFAULT;
  CONTENT_LTR = false;
  const { logoM } = await prepMedia(id, null);
  return packDocx(buildPlanDocumentXml(p, id, logoM), id);
}

/* ===== js/pages.js ===== */
/* =========================================================================
   pages.js — تحويل ملفات الدرس (PDF / صور) إلى صور صفحات في الذاكرة
   تُرسل للنموذج ليقرأها. الأشكال التوضيحية لم تعد تُقصّ من هذه الصور —
   النموذج يرسمها بنفسه (انظر figure.js)، لأن القصّ كان يخرج ناقصًا أو
   يلتقط فقرة نصية على أنها رسم.
   ========================================================================= */

let _pdfjs = null;
async function pdfLib() {
  if (_pdfjs) return _pdfjs;
  const base = document.baseURI;
  const m = await import(new URL('pdf.min.mjs', base).href);
  m.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
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

function canvasToPart(canvas) {
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { inline_data: { mime_type: 'image/jpeg', data: url.split(',')[1] } };
}

/* ===== js/gemini.js ===== */
/* =========================================================================
   gemini.js — الاتصال بـ Google Gemini (الحصة المجانية) من المتصفح مباشرة
   المفتاح يُخزَّن على جهاز المستخدم فقط (localStorage) ولا يمرّ بأي خادم وسيط.
   ========================================================================= */

/* «‏latest» أولًا لأن Google تسحب الإصدارات القديمة من الحسابات الجديدة،
   فيظل التطبيق يعمل دون تحديث. */
const GEMINI_MODELS = [
  { id: 'gemini-flash-latest',    label: 'Gemini Flash (أحدث نسخة) — مُوصى به' },
  { id: 'gemini-3.8-flash',       label: 'Gemini 3.8 Flash — أحدث إصدار مثبّت' },
  { id: 'gemini-3.6-flash',       label: 'Gemini 3.6 Flash — بديل مستقر' },
  { id: 'gemini-3.5-flash-lite',  label: 'Gemini 3.5 Flash Lite — أسرع وأخف' },
  { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash — للحسابات القديمة' }
];
const DEFAULT_MODEL  = 'gemini-flash-latest';
const FALLBACK_MODEL = 'gemini-3.6-flash';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

const S_STR  = { type: 'STRING' };
const S_LIST = { type: 'ARRAY', items: { type: 'STRING' } };
const S_GRID = { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } };

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    contentLang: S_STR,
    lessonTitle: S_STR,
    objectives: {
      type: 'OBJECT',
      properties: { cognitive: S_LIST, skill: S_LIST, affective: S_LIST },
      propertyOrdering: ['cognitive', 'skill', 'affective']
    },
    prerequisites: S_LIST,
    resources:     S_LIST,
    strategies:    S_LIST,
    warmup:        S_STR,
    content: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          heading: S_STR,
          body:    S_STR,
          bullets: S_LIST,
          table: {
            type: 'OBJECT',
            properties: { title: S_STR, columns: S_LIST, rows: S_GRID },
            propertyOrdering: ['title', 'columns', 'rows']
          }
        },
        propertyOrdering: ['heading', 'body', 'bullets', 'table']
      }
    },
    drills: {
      type: 'OBJECT',
      properties: { instruction: S_STR, columns: S_LIST, rows: S_GRID },
      propertyOrdering: ['instruction', 'columns', 'rows']
    },
    activities: S_LIST,
    assessment: {
      type: 'OBJECT',
      properties: {
        questions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { label: S_STR, question: S_STR, answer: S_STR },
            propertyOrdering: ['label', 'question', 'answer']
          }
        }
      }
    },
    warning:  S_STR,
    homework: S_LIST,
    figure: {
      type: 'OBJECT',
      properties: {
        caption: S_STR,
        page:    { type: 'INTEGER' },
        box_2d:  { type: 'ARRAY', items: { type: 'INTEGER' } },
        svg:     S_STR
      },
      propertyOrdering: ['caption', 'page', 'box_2d', 'svg']
    }
  },
  propertyOrdering: ['contentLang', 'lessonTitle', 'objectives', 'prerequisites', 'resources',
    'strategies', 'warmup', 'content', 'drills', 'activities', 'assessment', 'warning',
    'homework', 'figure']
};

/* =========================================================================
   مخطط ومطالبة التحضير العملي (F-PR-03)
   ========================================================================= */
const PRAC_SCHEMA = {
  type: 'OBJECT',
  properties: {
    contentLang: S_STR,
    topicTitle:  S_STR,
    practKind:   S_STR,          /* exercise | operation */
    purpose:     S_LIST,
    elements:    S_LIST,
    materials:   S_LIST,
    tools:       S_LIST,
    drawing:     S_STR,          /* وصف ما يجب أن يظهر في مربع الرسم */
    steps: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          heading: S_STR,
          body:    S_STR,
          bullets: S_LIST,
          table: {
            type: 'OBJECT',
            properties: { title: S_STR, columns: S_LIST, rows: S_GRID },
            propertyOrdering: ['title', 'columns', 'rows']
          }
        },
        propertyOrdering: ['heading', 'body', 'bullets', 'table']
      }
    },
    safety: S_LIST,
    ppe:    S_LIST,
    figure: {
      type: 'OBJECT',
      properties: {
        caption: S_STR,
        page:    { type: 'INTEGER' },
        box_2d:  { type: 'ARRAY', items: { type: 'INTEGER' } },
        svg:     S_STR
      },
      propertyOrdering: ['caption', 'page', 'box_2d', 'svg']
    }
  },
  propertyOrdering: ['contentLang', 'topicTitle', 'practKind', 'purpose', 'elements',
    'materials', 'tools', 'drawing', 'steps', 'safety', 'ppe', 'figure']
};

function buildPracPrompt(meta, pageCount) {
  const subj = meta.subject || 'الورشة';
  const isEx = meta.kind !== 'operation';
  const kindRule = isEx
    ? 'المدرب حدّد أن الموضوع **تمرين يُنفّذه الطالب بيده**. اضبط practKind = "exercise". ' +
      'واجعل مربع الرسم هو **شكل التمرين المطلوب تنفيذه** (الدائرة أو التوصيل أو ' +
      'القطعة بأبعادها ومقاساتها)، وخطوات التنفيذ هي خطوات تنفيذ التمرين على الطبيعة.'
    : 'المدرب حدّد أن الموضوع **شرح عملية أو شرح عدة وأدوات**. اضبط practKind = "operation". ' +
      'واجعل مربع الرسم هو **رسم العدة/الأداة أو مراحل العملية** التي نشرحها، ' +
      'وخطوات التنفيذ هي مراحل أداء العملية بالترتيب الصحيح.';

  return `أنت مدرب صناعي خبير في إدارة التدريب العملي بمركز تدريب صناعي، ومتخصص في «${subj}».

مرفق ${toArabicDigits(pageCount)} صورة لصفحات موضوع تدريب عملي من كتاب أو دليل ورشة. اقرأها كاملة بعناية — النصوص والرسوم والمقاسات وجداول العدد والخامات — ثم حوّلها إلى **تحضير تدريب عملي احترافي** يُطبع على نموذج معتمد.

## لغة المحتوى
${langRule(meta)}

## نوع الموضوع
${kindRule}

بيانات الجلسة كما أدخلها المدرب:
• الورشة/المادة: ${meta.subject || '—'}   • الصف/الفرقة: ${meta.grade || '—'}   • التخصص: ${meta.dept || '—'}
• رقم الموضوع: ${meta.lessonNo || '—'}   • المجموعة: ${meta.group || '—'}   • الحصة: ${meta.period || '—'}
• زمن التنفيذ: ${meta.duration || '٩٠ دقيقة'}
${meta.title ? '• اسم الموضوع معتمد من الخطة الزمنية — استخدمه حرفيًا في topicTitle: ' + meta.title : ''}
${meta.hint ? '• توجيه من المدرب: ' + meta.hint : ''}

الحقول المطلوبة:
1. topicTitle — اسم الموضوع/التمرين كما ورد في الكتاب، مختصر ودقيق.
2. purpose — ٣ إلى ٤ نقاط: الغرض من تنفيذ الموضوع، كل نقطة تصف **مهارة أدائية** يكتسبها الطالب
   (أن يكتسب مهارة… أن يتمكّن من… أن يجيد استخدام…)، لا معرفة نظرية.
3. elements — ٣ إلى ٥ عناصر: رؤوس الموضوعات التي يغطيها التمرين بالترتيب، عنصر في كل سطر.
4. materials — الخامات المستهلكة الفعلية بالمقاسات والكميات كما وردت
   (مثال: سلك نحاس مرن 1×1.5 mm² — 3 m). من ٣ إلى ٦.
5. tools — من ٦ إلى ١٠ عدد وأدوات وأجهزة قياس لازمة فعلًا لهذا التمرين، كل واحدة باسمها
   الفني الدقيق ومقاسها إن ذُكر. سطر واحد لكل أداة، بلا ترقيم داخل النص (النموذج يرقّم تلقائيًا).
6. drawing — سطران يصفان ما يجب أن يظهر في مربع الرسم حسب نوع الموضوع أعلاه.
7. steps — قلب التحضير: من ٦ إلى ١٠ خطوات تنفيذ مرقّمة بالترتيب الفعلي على الطبيعة. لكل خطوة:
   • heading: عنوان قصير ينتهي بنقطتين.
   • body: وصف تنفيذي مباشر **بصيغة الأمر** (قِس… ثبّت… أوصل… اختبر…) مع المقاسات والقيم
     والعِدد المستخدمة في هذه الخطوة تحديدًا.
   • bullets: نقاط عند الحاجة (مثل عزوم الربط أو قيم القياس المتوقعة).
   • table: جدول عند الحاجة فقط (جدول قياسات أو مواصفات).
   وأضف في الخطوة التي تحتاجه تحذيرًا فنيًا صريحًا داخل body.
8. safety — ٤ إلى ٦ قواعد أمن صناعي مرتبطة **بهذا التمرين وعِدده تحديدًا**، لا قواعد عامة مرسلة.
9. ppe — ٣ إلى ٥ مهمات وقاية شخصية يلزم استخدامها في هذا التمرين.
10. figure — الشكل التوضيحي (رسم التمرين أو العملية):
    **القاعدة: صورة الكتاب أولًا، ورسمُك أنت بديلًا عند غيابها.**

    أ) **لو في الصفحات المرفقة رسم أو مخطّط أو دائرة أو صورة توضيحية مفيدة** —
       حدّد مكانه ولا ترسم شيئًا:
       • page: رقم الصورة المرفقة التي فيه (تبدأ من ١)
       • box_2d: إطاره [y1, x1, y2, x2] بقيم ٠..١٠٠٠ نسبةً لأبعاد تلك الصورة
       • اجعل الإطار **حول الرسم كاملًا** بما فيه أرقام الأبعاد ووسوم العناصر،
         وزد هامشًا بسيطًا. الإطار الناقص أسوأ من لا شيء.
       • **ممنوع** أن تختار فقرة نصّية أو عنوانًا أو جدولًا أو ترويسة صفحة.
         لو لم يوجد إلا نصّ فلا تضع box_2d إطلاقًا.
       • واترك svg فارغًا في هذه الحالة.

    ب) **لو لا يوجد رسم صالح في الصفحات** — اترك box_2d فارغًا وارسم أنت في svg:
       • ابدأ بـ<svg viewBox="0 0 400 260"> وانتهِ بـ</svg>. لا width ولا height.
       • خطوط ومسارات وأشكال ونصوص فقط. ممنوع تمامًا: script · style · image ·
         foreignObject وأي رابط خارجي وأي خاصية on… — أي واحدة تُلغي الرسم كله.
       • لونان: الكحلي #16295C للخطوط والنصوص، والأحمر #C8102E لإبراز عنصر واحد.
         الخلفية بيضاء (لا ترسمها) وسمك الخط 2.
       • الوسوم نصوص <text> قصيرة font-size="13" بالإنجليزية أو بالرموز الفنية
         (R1, 220V, L, N) — العربية داخل الرسم تنعكس. والأرقام لاتينية دائمًا.
       • ارسم ما يشرح الفكرة: دائرة أو مخطّط أو رسم مقطعي أو مسار عملية.
       • بسيط مقروء: من ٦ إلى ٢٥ عنصرًا. المزدحم غير مفيد على ورقة مطبوعة.

    المطلوب إظهاره: لو الموضوع تمرين فشكل التمرين المنفَّذ بأبعاده ومقاساته،
    ولو شرح عملية فرسم العدة/الأداة أو مراحل العملية بالترتيب.
    في الحالتين: caption عنوان قصير للشكل بلغة المحتوى.

## ممنوع الإحالة إلى الكتاب — قاعدة صارمة
ورقة التحضير هي كل ما بين يدي المدرب والطالب في الورشة؛ **لا كتاب معهما**. فممنوع
أن يظهر في أي حقل: «راجع الكتاب» · «كما في الكتاب» · «صفحة كذا» · «الشكل رقم كذا»
أو أي إحالة إلى مصدر خارجي. كل خطوة وكل قاعدة مكتوبة كاملة بقيمها ومقاساتها في الورقة.

قواعد إلزامية:
- كل المحتوى مستخرج من الموضوع المرفق نفسه — ممنوع الكلام العام الذي يصلح لأي تمرين.
- الأسلوب أسلوب ورشة: أفعال أداء ومقاسات وأدوات بأسمائها، لا لغة نظرية.
- **كل الأرقام والمقاسات والقيم تُكتب بالأرقام اللاتينية (0 1 2 3)** مع وحداتها كما هي
  (1.5 mm², 220 V, M8, 25 N·m). لا تستخدم الأرقام العربية الهندية داخل أي قيمة أو مقاس.
- لا تترك حقلًا فارغًا ولا تكتب «حسب الحاجة» أو «يحددها المدرب».
- لا تُنتج جدول تقييم الطلاب ولا أسماءهم — يُطبع منفصلًا عن التحضير.
- أعِد JSON فقط مطابقًا للمخطط، بلا أي شرح خارجه.`;
}

/* ---------- التعليمات ---------- */
function langRule(meta) {
  if (meta.lang === 'ar') {
    return 'اكتب كل محتوى التحضير بالعربية الفصحى، وضع contentLang = "ar".';
  }
  if (meta.lang === 'en') {
    return 'Write ALL prep content in English (objectives, lesson steps, questions, activities, ' +
      'drills, warning, homework), and set contentLang = "en".';
  }
  return 'حدّد لغة المحتوى تلقائيًا:\n' +
    '  • إن كانت المادة لغة أجنبية (إنجليزية/فرنسية…) أو كان نص الدرس المرفق بتلك اللغة، ' +
    'فاكتب **كل محتوى التحضير بلغة الدرس نفسها** — الأهداف وعرض الدرس والأسئلة والأنشطة ' +
    'والتدريبات والتنبيه والواجب — وضع contentLang = "en" (أو رمز اللغة المناسب).\n' +
    '  • غير ذلك اكتب المحتوى بالعربية الفصحى وضع contentLang = "ar".\n' +
    '  • في كل الحالات: بيانات الحصة وعناوين أقسام النموذج تبقى كما هي، لا تترجمها ولا تعد كتابتها.';
}

function buildPrompt(meta, pageCount) {
  const subj = meta.subject || 'التخصص';
  return `أنت موجّه تربوي خبير في إعداد تحضير الدروس، ومتخصص في مادة «${subj}».

مرفق ${toArabicDigits(pageCount)} صورة لصفحات درس من كتاب مدرسي. اقرأها كاملة بعناية — النصوص والجداول والأشكال والأمثلة والتدريبات — ثم حوّلها إلى **تحضير درس احترافي** يُطبع على نموذج معتمد.

## لغة المحتوى
${langRule(meta)}

بيانات الحصة كما أدخلها المعلّم:
• المادة: ${meta.subject || '—'}   • الصف: ${meta.grade || '—'}   • القسم: ${meta.dept || '—'}
• رقم الدرس: ${meta.lessonNo || '—'}   • الأسبوع: ${meta.week || '—'}   • الحصة: ${meta.period || '—'}
• زمن الحصة: ${meta.duration || '٤٥ دقيقة'}   • الوحدة: ${meta.unit || '—'}
${meta.title ? '• عنوان الدرس معتمد من الخطة الزمنية — استخدمه حرفيًا في lessonTitle: ' + meta.title : ''}
${meta.hint ? '• توجيه من المعلّم: ' + meta.hint : ''}

الحقول المطلوبة:
1. lessonTitle — عنوان الدرس كما ورد في الكتاب، مختصر ودقيق.
2. objectives — أهداف سلوكية قابلة للقياس: cognitive (٣–٤)، skill (٢–٣)، affective (١–٢).
   بالعربية تبدأ بـ«أن يَـ…»، وبالإنجليزية تبدأ بـ«Students will be able to …».
3. prerequisites — ٢–٣ متطلبات سابقة يجب أن يتقنها الطالب.
4. resources — ٣–٥ وسائل ومعينات مطلوبة فعليًا لهذا الدرس.
5. strategies — ٢–٤ استراتيجيات تدريس مناسبة لطبيعة المحتوى.
6. warmup — تمهيد من سطرين يربط الدرس بموقف واقعي وينتهي بسؤال افتتاحي محدد.
7. content — قلب التحضير: ٥ إلى ٩ عناصر مرقّمة تعرض الدرس بالترتيب المنطقي. لكل عنصر:
   • heading: عنوان قصير ينتهي بنقطتين.
   • body: شرح مركّز (سطر أو سطران) — اتركه فارغًا إن اكتفيت بالنقاط.
   • bullets: نقاط عند الحاجة.
   • table: جدول عند الحاجة فقط (جدول قيم أو مقارنة) بعنوان وأعمدة وصفوف.
   أدرج الأمثلة المحلولة والقوانين والرموز والقيم والوحدات كما وردت في الدرس بالضبط.
8. drills — تدريب صفّي سريع: instruction (جملة تعليمات)، columns (اسم عمود واحد أو اثنين للمطلوب)، rows (٣–٤ صفوف من حالات حقيقية من الدرس). لا تضع عمودًا للإجابة؛ النموذج يضيفه فارغًا للطالب.
9. activities — ٣ أنشطة صفية تطبيقية قصيرة، كل نشاط في سطر.
10. assessment.questions — سؤالان، وanswer اتركه فارغًا دائمًا.
11. warning — تنبيه واحد (سطران) عن خطأ شائع أو اشتراط سلامة في هذا الدرس تحديدًا.
12. homework — تكليفان محدّدان مكتوبان بنصّهما الكامل وقيمهما، ينفّذهما الطالب
    دون الرجوع إلى أي كتاب أو مصدر خارجي.
13. figure — الشكل التوضيحي للدرس:
    **القاعدة: صورة الكتاب أولًا، ورسمُك أنت بديلًا عند غيابها.**

    أ) **لو في الصفحات المرفقة رسم أو مخطّط أو دائرة أو صورة توضيحية مفيدة** —
       حدّد مكانه ولا ترسم شيئًا:
       • page: رقم الصورة المرفقة التي فيه (تبدأ من ١)
       • box_2d: إطاره [y1, x1, y2, x2] بقيم ٠..١٠٠٠ نسبةً لأبعاد تلك الصورة
       • اجعل الإطار **حول الرسم كاملًا** بما فيه أرقام الأبعاد ووسوم العناصر،
         وزد هامشًا بسيطًا. الإطار الناقص أسوأ من لا شيء.
       • **ممنوع** أن تختار فقرة نصّية أو عنوانًا أو جدولًا أو ترويسة صفحة.
         لو لم يوجد إلا نصّ فلا تضع box_2d إطلاقًا.
       • واترك svg فارغًا في هذه الحالة.

    ب) **لو لا يوجد رسم صالح في الصفحات** — اترك box_2d فارغًا وارسم أنت في svg:
       • ابدأ بـ<svg viewBox="0 0 400 260"> وانتهِ بـ</svg>. لا width ولا height.
       • خطوط ومسارات وأشكال ونصوص فقط. ممنوع تمامًا: script · style · image ·
         foreignObject وأي رابط خارجي وأي خاصية on… — أي واحدة تُلغي الرسم كله.
       • لونان: الكحلي #16295C للخطوط والنصوص، والأحمر #C8102E لإبراز عنصر واحد.
         الخلفية بيضاء (لا ترسمها) وسمك الخط 2.
       • الوسوم نصوص <text> قصيرة font-size="13" بالإنجليزية أو بالرموز الفنية
         (R1, 220V, L, N) — العربية داخل الرسم تنعكس. والأرقام لاتينية دائمًا.
       • ارسم ما يشرح الفكرة: دائرة أو مخطّط أو رسم مقطعي أو مسار عملية.
       • بسيط مقروء: من ٦ إلى ٢٥ عنصرًا. المزدحم غير مفيد على ورقة مطبوعة.

    في الحالتين: caption عنوان قصير للشكل بلغة المحتوى.

## ممنوع الإحالة إلى الكتاب — قاعدة صارمة
ورقة التحضير هي كل ما بين يدي المعلّم والطالب؛ **لا كتاب معهما**. فممنوع منعًا باتًا
أن يظهر في أي حقل: «راجع الكتاب» · «تابع الأمثلة في الكتاب» · «كما في الكتاب» ·
«حلّ تمارين الكتاب» · «صفحة كذا» · «الشكل رقم كذا» · «الوحدة الأولى من الكتاب»
أو أي إحالة إلى مصدر خارجي أو رقم صفحة أو رقم شكل.
كل تكليف وكل سؤال وكل نشاط **مكتفٍ بذاته**: اكتب نصّه كاملًا بقيمه وأرقامه داخل الورقة،
بحيث يستطيع الطالب تنفيذه وهو لا يملك إلا هذه الورقة.
مثال خطأ: «حلّ الأمثلة الموجودة في الكتاب».
مثال صواب: «اقرأ قيمة مقاومة ألوانها: أحمر — بنفسجي — برتقالي — ذهبي، واكتب قيمتها ونسبة تفاوتها».

## أسئلة الكتاب — قاعدة مهمة
إن كان الدرس المرفق يحتوي أسئلة أو تدريبات مطبوعة (Comprehension Questions ·
Vocabulary in Context · Think & Discuss · أسئلة التقويم · تمارين)، فاستخدمها **بنصّها الحرفي**
كما وردت في الكتاب في حقول assessment.questions وdrills وhomework، ووزّعها بينها بما يناسب كل حقل.
لا تُعِد صياغتها ولا تترجمها. اجعل label لكل سؤال هو عنوان القسم الذي جاء منه في الكتاب.
ولا تؤلّف أسئلة من عندك إلا إذا لم يوجد في الدرس ما يكفي — وحينها فقط ألّف ما ينقص.

قواعد إلزامية:
- كل المحتوى مستخرج من الدرس المرفق نفسه — ممنوع الكلام العام الذي يصلح لأي درس.
- إن كان المحتوى بالعربية: فصحى تربوية والمصطلحات الأجنبية بين قوسين عند أول ذكر.
  وإن كان بالإنجليزية: إنجليزية سليمة مناسبة لمستوى الصف، بلا أي جُمل عربية داخل المحتوى.
- **كل الأرقام والقيم والقوانين والجداول تُكتب بالأرقام اللاتينية (0 1 2 3)** مع وحداتها كما هي
  (‎27 kΩ ±5%‎, ×10³, 4.7 kΩ). لا تستخدم الأرقام العربية الهندية (٠١٢٣) داخل أي قيمة أو معادلة أو جدول.
- لا تترك حقلًا فارغًا ولا تكتب «حسب الحاجة» أو «يحددها المعلّم».
- أعِد JSON فقط مطابقًا للمخطط، بلا أي شرح خارجه.`;
}

function callModel(id, apiKey, body) {
  return fetch(API_BASE + encodeURIComponent(id) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  });
}

/* ---------- الاستدعاء ---------- */
async function generateTahdeer({ apiKey, model, pages, meta, onProgress, kind }) {
  if (!apiKey) throw new Error('لم يتم إدخال مفتاح Gemini. افتح الإعدادات وأدخل المفتاح أولًا.');
  if (!pages || !pages.length) throw new Error('ارفع ملف الدرس (PDF أو صور) أولًا.');

  const prac = (kind === 'prac');
  const parts = pages.map(canvasToPart);
  parts.push({ text: prac ? buildPracPrompt(meta, pages.length) : buildPrompt(meta, pages.length) });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: prac ? PRAC_SCHEMA : RESPONSE_SCHEMA
    }
  };

  onProgress && onProgress('جارٍ قراءة الدرس وتحويله إلى تحضير…');

  let res = await callModel(model || DEFAULT_MODEL, apiKey, body);

  /* بعض الإصدارات تُسحب من الحسابات الجديدة — نجرّب بديلًا تلقائيًا */
  if (res.status === 404 && (model || DEFAULT_MODEL) !== FALLBACK_MODEL) {
    onProgress && onProgress('النموذج المختار غير متاح لحسابك — جارٍ التحويل لنموذج بديل…');
    res = await callModel(FALLBACK_MODEL, apiKey, body);
  }

  if (!res.ok) {
    let msg = 'تعذّر الاتصال (خطأ ' + res.status + ')';
    try {
      const e = await res.json();
      const m = (e.error && e.error.message) || '';
      if (res.status === 400 && /API[_ ]?key/i.test(m)) msg = 'مفتاح Gemini غير صحيح. راجع الإعدادات.';
      else if (res.status === 429) msg = 'انتهت حصتك المجانية مؤقتًا. انتظر دقيقة ثم أعد المحاولة، أو اختر نموذجًا أخف من الإعدادات.';
      else if (res.status === 403) msg = 'المفتاح غير مُفعّل لهذه الخدمة. أنشئ مفتاحًا جديدًا من Google AI Studio.';
      else if (res.status === 404) msg = 'النماذج المتاحة تغيّرت. افتح الإعدادات واختر نموذجًا آخر من القائمة.';
      else if (res.status === 503) msg = 'خدمة Gemini مشغولة الآن. أعد المحاولة بعد لحظات.';
      else if (m) msg = m;
    } catch (_) {}
    throw new Error(msg);
  }

  const json = await res.json();
  const cand = json.candidates && json.candidates[0];
  if (!cand) throw new Error('لم يُرجع النموذج نتيجة. جرّب صورًا أوضح أو عددًا أقل من الصفحات.');
  if (cand.finishReason === 'SAFETY') throw new Error('رفض النموذج معالجة المحتوى المرفوع.');

  const text = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
  let data;
  try { data = JSON.parse(text); }
  catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('تعذّر قراءة نتيجة النموذج. أعد المحاولة.');
    data = JSON.parse(m[0]);
  }
  return prac ? normalizePrac(data, meta) : normalize(data);
}

/* ---------- تنظيف المخرجات ---------- */
function normalize(d) {
  d = d || {};
  const arr = v => Array.isArray(v) ? v.filter(x => String(x || '').trim()) : [];
  d.prerequisites = arr(d.prerequisites);
  d.resources     = arr(d.resources);
  d.strategies    = arr(d.strategies);
  d.activities    = arr(d.activities);
  d.homework      = arr(d.homework);
  d.objectives    = d.objectives || {};
  ['cognitive', 'skill', 'affective'].forEach(k => { d.objectives[k] = arr(d.objectives[k]); });
  d.content = (Array.isArray(d.content) ? d.content : []).map(it => ({
    heading: it.heading || '',
    body: it.body || '',
    bullets: arr(it.bullets),
    table: (it.table && Array.isArray(it.table.columns) && it.table.columns.length &&
            Array.isArray(it.table.rows) && it.table.rows.length) ? it.table : null
  })).filter(it => it.heading || it.body || it.bullets.length || it.table);
  if (d.drills && (!Array.isArray(d.drills.rows) || !d.drills.rows.length)) d.drills = null;
  if (d.drills && (!Array.isArray(d.drills.columns) || !d.drills.columns.length)) d.drills.columns = ['المطلوب'];
  if (d.assessment && !Array.isArray(d.assessment.questions)) d.assessment = null;
  d.figure = (d.figure && typeof d.figure === 'object') ? d.figure : null;
  d.contentLang = /^en/i.test(String(d.contentLang || '')) ? 'en' : 'ar';
  return d;
}

/* ---------- تنظيف مخرجات التحضير العملي ---------- */
function normalizePrac(d, meta) {
  d = d || {};
  const arr = v => Array.isArray(v) ? v.filter(x => String(x || '').trim())
    .map(x => String(x).replace(/^\s*[\d٠-٩]+\s*[-.)–]\s*/, '').trim()) : [];

  d.purpose   = arr(d.purpose);
  d.elements  = arr(d.elements);
  d.materials = arr(d.materials);
  d.tools     = arr(d.tools).slice(0, 12);
  d.safety    = arr(d.safety);
  d.ppe       = arr(d.ppe);
  d.drawing   = String(d.drawing || '').trim();

  d.steps = (Array.isArray(d.steps) ? d.steps : []).map(it => ({
    heading: it.heading || '',
    body: it.body || '',
    bullets: arr(it.bullets),
    table: (it.table && Array.isArray(it.table.columns) && it.table.columns.length &&
            Array.isArray(it.table.rows) && it.table.rows.length) ? it.table : null
  })).filter(it => it.heading || it.body || it.bullets.length || it.table);

  d.figure = (d.figure && typeof d.figure === 'object') ? d.figure : null;
  d.contentLang = /^en/i.test(String(d.contentLang || '')) ? 'en' : 'ar';
  /* اختيار المدرب هو الحاكم — لا اجتهاد النموذج */
  d.practKind = ((meta && meta.kind) === 'operation') ? 'operation' : 'exercise';
  d.docKind = 'prac';
  return d;
}

/* =========================================================================
   تمريرة المراجعة — الدقة قبل الشكل

   النموذج في التمريرة الأولى منشغل بالبناء والتنسيق، فتمرّ عليه أخطاء رقمية
   وفنية. هذه تمريرة ثانية مهمّتها واحدة: يقارن التحضير المكتوب بصفحات الكتاب
   ويصحّح ما خالفها. لا يُعيد الصياغة ولا يضيف ولا يحذف — يصحّح فقط.
   ========================================================================= */

/** يجمع النصوص القابلة للمراجعة من التحضير في قائمة مسطّحة { path, text } */
function reviewFields(d, prac) {
  const out = [];
  const push = (p, t) => { if (t && String(t).trim()) out.push({ path: p, text: String(t) }); };
  const list = (k) => (d[k] || []).forEach((t, i) => push(`${k}.${i}`, t));

  if (prac) {
    push('topicTitle', d.topicTitle);
    ['purpose', 'elements', 'materials', 'tools', 'safety', 'ppe'].forEach(list);
    (d.steps || []).forEach((it, i) => {
      push(`steps.${i}.heading`, it.heading);
      push(`steps.${i}.body`, it.body);
      (it.bullets || []).forEach((b, j) => push(`steps.${i}.bullets.${j}`, b));
    });
  } else {
    push('lessonTitle', d.lessonTitle);
    ['prerequisites', 'resources', 'strategies', 'activities', 'homework'].forEach(list);
    ['cognitive', 'skill', 'affective'].forEach(g =>
      ((d.objectives || {})[g] || []).forEach((t, i) => push(`objectives.${g}.${i}`, t)));
    push('warmup', d.warmup);
    push('warning', d.warning);
    (d.content || []).forEach((it, i) => {
      push(`content.${i}.heading`, it.heading);
      push(`content.${i}.body`, it.body);
      (it.bullets || []).forEach((b, j) => push(`content.${i}.bullets.${j}`, b));
      (((it.table || {}).rows) || []).forEach((r, ri) =>
        (r || []).forEach((c, ci) => push(`content.${i}.table.rows.${ri}.${ci}`, c)));
    });
    ((d.assessment || {}).questions || []).forEach((q, i) =>
      push(`assessment.questions.${i}.question`, q.question));
    (((d.drills || {}).rows) || []).forEach((r, ri) =>
      (Array.isArray(r) ? r : [r]).forEach((c, ci) => push(`drills.rows.${ri}.${ci}`, c)));
  }
  return out;
}

const REVIEW_SCHEMA = {
  type: 'OBJECT',
  properties: {
    fixes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { path: S_STR, corrected: S_STR, reason: S_STR },
        propertyOrdering: ['path', 'corrected', 'reason']
      }
    }
  }
};

function buildReviewPrompt(items, prac) {
  const who = prac ? 'مدرّب صناعي' : 'موجّه تربوي';
  const lines = items.map(x => `${x.path} ::: ${x.text}`).join('\n');
  return `أنت ${who} خبير، ومهمّتك **التدقيق فقط**.

مرفق صفحات الدرس من الكتاب، وتحتها بنود تحضير مكتوبة منه. قارن كل بند بالكتاب
وأبلغ عن **الأخطاء فقط**.

يُعدّ خطأ يستوجب التصحيح:
• رقم أو قيمة أو وحدة أو مقاس يخالف الكتاب (220 V بدل 380 V، 1.5 mm² بدل 2.5 mm²…)
• قانون أو معادلة أو ترتيب خطوات مخالف لما في الكتاب
• توصيلة أو علاقة فنية غير صحيحة (سلك التعادل يمرّ بالمفتاح مثلًا)
• مصطلح فني خاطئ أو اسم عدّة غير صحيح
• إحالة إلى الكتاب أو رقم صفحة أو رقم شكل (ممنوعة في هذه الورقة)

**ليس خطأ** ولا تبلّغ عنه: أسلوب الصياغة · طول الجملة · الترتيب · علامات الترقيم ·
اختيار الكلمات ما دام المعنى صحيحًا. لا تُعِد الصياغة لمجرد التحسين.

لكل خطأ فقط: path كما هو حرفيًا، وcorrected النصّ المصحَّح كاملًا، وreason سبب
قصير جدًا. ولو كل البنود سليمة أعِد fixes قائمة فارغة.

البنود:
${lines}`;
}

/** يطبّق التصحيحات على كائن التحضير — يُرجع عدد ما طُبِّق */
function applyFixes(data, fixes, items) {
  const known = new Set(items.map(x => x.path));
  let n = 0;
  (fixes || []).forEach(f => {
    if (!f || !f.path || !f.corrected) return;
    if (!known.has(f.path)) return;                 /* مسار لم نرسله = مرفوض */
    const cur = getPath(data, f.path);
    if (typeof cur !== 'string') return;
    const next = String(f.corrected).trim();
    if (!next || next === cur) return;
    /* تصحيح يقلب النصّ رأسًا على عقب غالبًا إعادة صياغة لا تدقيق */
    if (next.length > cur.length * 3 + 40) return;
    setPath(data, f.path, next);
    n++;
  });
  return n;
}

/** يراجع التحضير ويصحّحه. لا يفشل التوليد إن تعثّر — يُرجع 0 ويمضي. */
async function reviewTahdeer({ apiKey, model, pages, data, prac, onProgress }) {
  try {
    const items = reviewFields(data, prac);
    if (!items.length) return 0;
    onProgress && onProgress('جارٍ مراجعة الأرقام والقوانين مقابل الكتاب…');

    const parts = pages.map(canvasToPart);
    parts.push({ text: buildReviewPrompt(items, prac) });
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1, topP: 0.8, maxOutputTokens: 4096,
        responseMimeType: 'application/json', responseSchema: REVIEW_SCHEMA
      }
    };
    let res = await callModel(model || DEFAULT_MODEL, apiKey, body);
    if (res.status === 404 && (model || DEFAULT_MODEL) !== FALLBACK_MODEL)
      res = await callModel(FALLBACK_MODEL, apiKey, body);
    if (!res.ok) return 0;

    const json = await res.json();
    const cand = json.candidates && json.candidates[0];
    if (!cand) return 0;
    const text = ((cand.content && cand.content.parts) || []).map(x => x.text || '').join('');
    let out;
    try { out = JSON.parse(text); }
    catch (_) { const m = text.match(/\{[\s\S]*\}/); if (!m) return 0; out = JSON.parse(m[0]); }
    return applyFixes(data, out.fixes, items);
  } catch (e) {
    console.warn('تعذّرت المراجعة:', e);
    return 0;                                        /* المراجعة تحسين لا شرط */
  }
}

/* ===== js/figure.js ===== */
/* =========================================================================
   figure.js — الشكل التوضيحي في ورقة التحضير

   سلّم المصادر (بترتيب الأفضلية):
   ١) صورة من الكتاب نفسه — هي الوحيدة المضمونة فنيًا لأنها من المنهج المعتمد.
   ٢) الصورة نفسها بعد تنظيف **للعرض فقط**: شدّ الحدود ورفع التباين وإطار.
      المحتوى الفني لا يُمسّ إطلاقًا.
   ٣) رسم SVG يرسمه النموذج — فقط حين لا توجد صورة صالحة، وهو اقتراح يراجعه
      المدرّس لا حقيقة مؤكَّدة.

   شكل الكائن الموحَّد: { caption, src?, svg?, source }
   source: 'book' (صورة الكتاب) | 'ai' (رسم النموذج)

   ## التوافق مع الشغل المحفوظ
   الإصدارات قبل v12 كانت تحفظ الأشكال في `data.figures = [{caption, src}]`.
   v12 غيّرت المكان إلى `data.figure` فاختفت صور الدروس القديمة من الورقة
   (البيانات لم تُمسّ — الراسم فقط توقّف عن البحث عنها). `readFigure()` تقرأ
   الشكلين، فترجع الصور القديمة تلقائيًا بمجرّد فتح الدرس.

   الوارد من النموذج نصّ لا نثق به، فيمرّ على تعقيم صارم قبل إدراجه.
   ========================================================================= */

/** تقرأ الشكل من بيانات الدرس مهما كانت صيغتها — القديمة أو الجديدة */
function readFigure(data) {
  if (!data) return null;
  if (data.figure && (data.figure.svg || data.figure.src)) return data.figure;
  /* صيغة ما قبل v12 */
  const old = Array.isArray(data.figures) ? data.figures.find(f => f && f.src) : null;
  if (old) return { caption: old.caption || 'الرسم التوضيحي', src: old.src,
    w: old.w || 0, h: old.h || 0, source: 'book' };
  return null;
}

/* الوسوم المسموح بها داخل الرسم — رسم هندسي بحت، بلا سكربت ولا موارد خارجية */
const SVG_TAGS = new Set(['svg', 'g', 'defs', 'title', 'desc', 'marker', 'symbol', 'use',
  'path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse',
  'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath']);

const SVG_ATTRS = new Set(['viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight',
  'text-anchor', 'dominant-baseline', 'dx', 'dy', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'patternUnits', 'markerWidth', 'markerHeight', 'refX', 'refY',
  'orient', 'id', 'class', 'clip-path', 'marker-end', 'marker-start', 'xmlns',
  'preserveAspectRatio', 'direction']);

/**
 * يحوّل نصّ SVG الوارد من النموذج إلى رسم آمن جاهز للإدراج.
 * يُرجع نصّ SVG أو '' إن لم يكن صالحًا.
 */
function sanitizeSvg(raw, id) {
  if (!raw || typeof raw !== 'string') return '';
  let txt = raw.trim();

  /* النموذج أحيانًا يغلّفه بسياج ```svg */
  txt = txt.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  const m = txt.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) return '';
  txt = m[0];

  /* أي سكربت أو حدث أو مورد خارجي يُرفض الرسم كله بسببه */
  if (/<\s*(script|foreignObject|iframe|image|style)\b/i.test(txt)) return '';
  if (/\son\w+\s*=/i.test(txt)) return '';
  if (/(javascript|data)\s*:/i.test(txt)) return '';
  if (/<!ENTITY|xlink:href\s*=\s*["']\s*http/i.test(txt)) return '';

  let doc;
  try { doc = new DOMParser().parseFromString(txt, 'image/svg+xml'); }
  catch (_) { return ''; }
  if (!doc || doc.querySelector('parsererror')) return '';

  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return '';

  /* تنظيف الشجرة: وسم غير مسموح يُحذف، وخاصية غير مسموحة تُحذف */
  const walk = node => {
    [...node.children].forEach(ch => {
      const tag = ch.nodeName;
      if (!SVG_TAGS.has(tag) && !SVG_TAGS.has(tag.toLowerCase())) { ch.remove(); return; }
      [...ch.attributes].forEach(a => {
        if (!SVG_ATTRS.has(a.name) && !SVG_ATTRS.has(a.name.replace(/^.*:/, ''))) ch.removeAttribute(a.name);
      });
      walk(ch);
    });
  };
  walk(svg);

  /* رسم بلا أشكال = لا رسم */
  const shapes = svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse,text');
  if (shapes.length < 2) return '';

  /* إطار العرض إجباري كي يتمدّد الرسم داخل مربعه */
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(svg.getAttribute('width')) || 400;
    const h = parseFloat(svg.getAttribute('height')) || 260;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  /* توحيد الألوان على ألوان النموذج المعتمد */
  const navy = (id && id.navy) || '#16295C';
  const red  = (id && id.red)  || '#C8102E';
  svg.querySelectorAll('*').forEach(n => {
    ['fill', 'stroke', 'stop-color'].forEach(k => {
      const v = (n.getAttribute(k) || '').trim().toLowerCase();
      if (!v || v === 'none' || v === 'transparent') return;
      if (/^#?(fff|ffffff|white)$/.test(v.replace('#', ''))) return;
      if (v === 'currentcolor') { n.setAttribute(k, navy); return; }
      /* الأحمر يبقى أحمر للتمييز، وما عداه كحلي */
      const isRed = /^#?(f00|ff0000|red|c8102e|e11|dc2626|d00)/.test(v.replace('#', ''));
      n.setAttribute(k, isRed ? red : navy);
    });
  });

  const out = new XMLSerializer().serializeToString(svg);
  return out.length > 60000 ? '' : out;      /* رسم ضخم = غالبًا هراء */
}

/** يبني كائن الشكل النهائي من مخرجات النموذج (رسم تخطيطي) */
function buildFigure(fig, id) {
  if (!fig) return null;
  const svg = sanitizeSvg(fig.svg, id);
  if (!svg) return null;
  return { caption: (fig.caption || '').trim() || 'الرسم التوضيحي', svg, source: 'ai' };
}

/** يحوّل SVG إلى PNG — يحتاجه ملف Word لأنه لا يعرض SVG في كل الإصدارات */
function svgToPng(svgText, wPx) {
  return new Promise(resolve => {
    try {
      const w = wPx || 1200;
      const vb = (svgText.match(/viewBox\s*=\s*["']([^"']+)["']/) || [])[1] || '0 0 400 260';
      const parts = vb.trim().split(/[\s,]+/).map(Number);
      const ratio = (parts[3] && parts[2]) ? (parts[3] / parts[2]) : 0.65;
      const h = Math.round(w * ratio);

      const img = new Image();
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(b => resolve(b ? { blob: b, w, h } : null), 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch (_) { resolve(null); }
  });
}

/** أبعاد صورة من data URL — يحتاجها ملف Word لضبط نسبة العرض للارتفاع */
function imageSize(src) {
  return new Promise(resolve => {
    const i = new Image();
    i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => resolve(null);
    i.src = src;
  });
}


/* =========================================================================
   صورة من الكتاب: قصّ ← شدّ الحدود ← تنظيف للعرض
   المحتوى الفني لا يُمسّ — ما يتغيّر هو العرض فقط (قصّ الفراغ، تقويم الإضاءة،
   رفع التباين). هذا ما يجعل صورة الكتاب تبدو احترافية دون أن تصبح غير أمينة.
   ========================================================================= */

/** يقصّ مستطيلًا من صفحة حسب box_2d القادم من النموذج (0..1000: y1,x1,y2,x2) */
function cropBox(canvas, box, pad) {
  if (!Array.isArray(box) || box.length < 4) return null;
  const v = box.map(Number);
  if (v.some(isNaN)) return null;
  const P = pad == null ? 0.015 : pad;
  const l = Math.max(0, Math.min(v[1], v[3]) / 1000 - P) * canvas.width;
  const t = Math.max(0, Math.min(v[0], v[2]) / 1000 - P) * canvas.height;
  const r = Math.min(1, Math.max(v[1], v[3]) / 1000 + P) * canvas.width;
  const b = Math.min(1, Math.max(v[0], v[2]) / 1000 + P) * canvas.height;
  const w = Math.round(r - l), h = Math.round(b - t);
  if (w < 60 || h < 45) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(canvas, Math.round(l), Math.round(t), w, h, 0, 0, w, h);
  return c;
}

/** عتبة الحبر: أي بكسل أغمق منها يُعدّ محتوى لا خلفية */
function inkMask(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  const lum = new Uint8Array(cv.width * cv.height);
  let sum = 0;
  for (let i = 0, k = 0; i < d.length; i += 4, k++) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    lum[k] = y; sum += y;
  }
  /* الورق فاتح؛ نعتبر الحبر ما نزل عن ٧٨٪ من متوسط الصفحة */
  return { lum, thr: Math.max(40, Math.min(215, (sum / lum.length) * 0.78)) };
}

/** يشدّ حدود القصّة على الحبر الفعلي فيختفي الفراغ الأبيض الزائد */
function trimToInk(cv, margin) {
  const { lum, thr } = inkMask(cv);
  const W = cv.width, H = cv.height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (lum[y * W + x] < thr) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;                       /* لا حبر إطلاقًا */
  const m = margin == null ? Math.round(Math.min(W, H) * 0.03) : margin;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(W - 1, x1 + m); y1 = Math.min(H - 1, y1 + m);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < 50 || h < 40) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, w, h);
  return c;
}


/**
 * يزيل أسطر النصّ الملتصقة بأعلى القصّة أو أسفلها.
 * إطار النموذج غالبًا أوسع قليلًا من الرسم فيبتلع سطرين أو ثلاثة من متن الكتاب.
 * التمييز بتحليل «الجَريات» في كل صف: سطر النصّ فيه جَريات حبر كثيرة قصيرة
 * (حروف)، وصفّ الرسم فيه جَريات قليلة أو جَرية طويلة (خط أو إطار).
 */
function stripTextBands(cv) {
  const { lum, thr } = inkMask(cv);
  const W = cv.width, H = cv.height;
  const isText = new Uint8Array(H);

  for (let y = 0; y < H; y++) {
    let runs = 0, maxRun = 0, cur = 0, ink = 0;
    for (let x = 0; x < W; x++) {
      if (lum[y * W + x] < thr) { cur++; ink++; }
      else { if (cur) { runs++; if (cur > maxRun) maxRun = cur; } cur = 0; }
    }
    if (cur) { runs++; if (cur > maxRun) maxRun = cur; }
    const f = ink / W;
    /* خط أو إطار: جَرية طويلة ← ليس نصًّا مهما كان */
    const graphic = maxRun > W * 0.22;
    isText[y] = (!graphic && runs >= 7 && f > 0.02 && f < 0.42) ? 1 : 0;
  }

  /* سطر النصّ معظمه فراغ أبيض بين الحروف والأسطر، فقياس الكثافة صفًّا صفًّا
     يخدع. نوسّع كل صفّ نصّي ليبتلع الفراغ حوله، فتصير منطقة النصّ كتلة متصلة. */
  const rad = Math.max(10, Math.round(H * 0.045));
  const region = new Uint8Array(H);
  for (let y = 0; y < H; y++) {
    if (!isText[y]) continue;
    for (let k = Math.max(0, y - rad); k <= Math.min(H - 1, y + rad); k++) region[k] = 1;
  }

  let top = 0, bot = H - 1;
  while (top < bot && region[top]) top++;
  while (bot > top && region[bot]) bot--;

  const h = bot - top + 1;
  if (h < 40 || h < H * 0.22) return cv;          /* لا نقصّ قصًّا مدمّرًا */
  if (top === 0 && bot === H - 1) return cv;

  const c = document.createElement('canvas');
  c.width = W; c.height = h;
  c.getContext('2d').drawImage(cv, 0, top, W, h, 0, 0, W, h);
  return c;
}

/**
 * هل القصّة رسم أم فقرة نصّ؟
 * النصّ المطبوع يظهر كأسطر حبر أفقية متتابعة بفواصل بيضاء منتظمة. نحسب نسبة
 * الصفوف «النصّية» — لو غلبت على الصورة فهي فقرة لا رسم.
 * تُرجع { textish, ink, ratio }.
 */
function looksLikeText(cv) {
  const { lum, thr } = inkMask(cv);
  const W = cv.width, H = cv.height;
  const rowInk = new Float32Array(H);
  let ink = 0;
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (lum[y * W + x] < thr) n++;
    rowInk[y] = n / W; ink += n;
  }
  ink /= (W * H);

  /* عدّ تبدّلات «سطر فيه حبر ← سطر فارغ»: النصّ كثير التبدّل بانتظام */
  let bands = 0, inBand = false;
  const lo = 0.012, hi = 0.055;
  for (let y = 0; y < H; y++) {
    const on = rowInk[y] > hi;
    if (on && !inBand) { bands++; inBand = true; }
    else if (rowInk[y] < lo) inBand = false;
  }
  const bandsPerCm = bands / Math.max(1, H / 40);
  return { textish: bands >= 4 && bandsPerCm > 1.1 && ink < 0.34, ink, bands };
}

/** تنظيف للعرض: توازن أبيض + رفع تباين + حدّة خفيفة. لا يغيّر المحتوى. */
function enhanceScan(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;

  /* مئين ٥٪ و٩٥٪ من الإضاءة لمدّ المدى الديناميكي */
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4)
    hist[(d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0]++;
  const total = d.length / 4;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.05) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.05) { hi = v; break; } }
  if (hi - lo < 25) { lo = 0; hi = 255; }

  const map = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let t = (v - lo) / (hi - lo);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    /* منحنى S خفيف: يعمّق الخطوط ويبيّض الورق دون حرق التفاصيل */
    t = t * t * (3 - 2 * t) * 0.85 + t * 0.15;
    map[v] = Math.round(t * 255);
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = map[d[i]]; d[i + 1] = map[d[i + 1]]; d[i + 2] = map[d[i + 2]];
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** يحدّ العرض الأقصى حتى لا تتضخّم الصورة في التخزين */
function capWidth(cv, maxW) {
  if (cv.width <= maxW) return cv;
  const c = document.createElement('canvas');
  c.width = maxW;
  c.height = Math.round(cv.height * maxW / cv.width);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(cv, 0, 0, c.width, c.height);
  return c;
}

/**
 * يبني شكلًا من صورة الكتاب. يُرجع { ok, figure?, why? }
 * الرفض أفضل من شكل ناقص: الورقة بلا رسم أهون من ورقة فيها نصف رسم.
 */
function figureFromBook(fig, pages) {
  if (!fig || !Array.isArray(fig.box_2d) || !pages || !pages.length)
    return { ok: false, why: 'لا إحداثيات' };

  const pi = Math.max(0, Math.min(pages.length - 1, (parseInt(fig.page, 10) || 1) - 1));
  let cv = cropBox(pages[pi], fig.box_2d);
  if (!cv) return { ok: false, why: 'القصّة صغيرة جدًا' };

  cv = stripTextBands(cv);                 /* يقصّ أسطر المتن من الحوافّ */
  const trimmed = trimToInk(cv);
  if (!trimmed) return { ok: false, why: 'القصّة فارغة' };
  cv = stripTextBands(trimmed);            /* مرة ثانية بعد شدّ الحدود */
  const t2 = trimToInk(cv);
  if (t2) cv = t2;

  const ar = cv.width / cv.height;
  if (ar > 7 || ar < 0.14) return { ok: false, why: 'نسبة أبعاد شاذّة' };

  const t = looksLikeText(cv);
  if (t.textish) return { ok: false, why: 'فقرة نصّية لا رسم' };
  if (t.ink < 0.004) return { ok: false, why: 'لا محتوى يُذكر' };

  cv = enhanceScan(capWidth(cv, 1100));
  return {
    ok: true,
    figure: {
      caption: (fig.caption || '').trim() || 'الرسم التوضيحي',
      src: cv.toDataURL('image/jpeg', 0.9),
      /* الأبعاد إلزامية: بدونها يقيس المتصفّح الصورة بصفر قبل تحميلها،
         فيمرّ الشكل من فحص الامتلاء ثم يتمدّد فيفيض عن الورقة. */
      w: cv.width, h: cv.height,
      source: 'book'
    }
  };
}

/**
 * سلّم الشكل التوضيحي: صورة الكتاب ← رسم النموذج ← لا شيء.
 * نحتفظ بالبديلين معًا في alts كي يستطيع المدرّس التبديل بينهما من المعاينة.
 * يُرجع { figure, alts:{book, ai}, why } — why سبب رفض صورة الكتاب.
 */
function resolveFigure(fig, pages, id) {
  let why = '', book = null;
  if (fig && Array.isArray(fig.box_2d) && fig.box_2d.length >= 4) {
    const r = figureFromBook(fig, pages);
    if (r.ok) book = r.figure; else why = r.why;
  }
  const ai = buildFigure(fig, id);
  return { figure: book || ai || null, alts: { book, ai }, why };
}

/* ===== js/render.js ===== */
/* =========================================================================
   render.js — رسم ورقة التحضير وتقسيمها على صفحات A4 تلقائيًا
   ========================================================================= */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const escHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* عزل المقاطع اللاتينية والرموز العلمية حتى لا ينعكس ترتيبها داخل نص عربي
   مثال: «×10⁰» و«27 kΩ ±5%» تبقى كما كُتبت */
/* المقطع = يبدأ برقم/حرف لاتيني أو رمز رياضي، ويمتدّ ما لم يصادف حرفًا عربيًا */
const LATIN_RUN =
  /[A-Za-z0-9٠-٩±×÷Ωμµ°¹²³][^ء-يٱ-ۓ&;<>]*[A-Za-z0-9٠-٩%°Ω¹²³⁰-₟]|[A-Za-z0-9]/g;

function bidiHtml(s) {
  return escHtml(s).replace(LATIN_RUN, m => {
    const tail = m.match(/\s+$/);
    const core = tail ? m.slice(0, -tail[0].length) : m;
    return `<bdi dir="ltr">${core}</bdi>` + (tail ? tail[0] : '');
  });
}

/* لغة محتوى التحضير الحالي — تضبطها renderDocument */
let R_LTR = false;
const RL = { num: n => (R_LTR ? String(n) : toArabicDigits(n)) };
const R_OBJ_LABEL = {
  ar: { cognitive: 'معرفية', skill: 'مهارية', affective: 'وجدانية' },
  en: { cognitive: 'Knowledge', skill: 'Skills', affective: 'Attitude' }
};

/* ---------- الوصول لقيمة داخل الكائن عبر مسار ---------- */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i];
    if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[k];
  }
  o[ks[ks.length - 1]] = val;
}

/* عنصر قابل للتحرير مربوط بالبيانات */
function ed(tag, cls, text, path) {
  const n = el(tag, cls, bidiHtml(text));
  n.setAttribute('contenteditable', 'true');
  n.setAttribute('spellcheck', 'false');
  if (path) n.dataset.bind = path;
  return n;
}

/* =========================================================================
   الترقيم على صفحات
   ========================================================================= */
/* إعداد النوع: النظري افتراضيًا، والعملي يمرّر إعداده الخاص */
const PAGER_TH = {
  head:       n => `تحضير الدرس ${escHtml(lessonOrdinal(n || 1))}`,
  titleLabel: 'عنوان الدرس: ',
  titleKey:   'lessonTitle',
  strip:      () => STRIP_FIELDS,
  rows:       () => ROW_FIELDS,
  fields:     () => META_FIELDS
};
const PAGER_PR = {
  /* بلا لاحقة «تدريب عملي» — اسم الإدارة في الترويسة يوضّحها، واللاحقة تُلفّ العنوان سطرين */
  head:       n => `تحضير الموضوع ${escHtml(lessonOrdinal(n || 1))}`,
  titleLabel: 'اسم الموضوع: ',
  titleKey:   'topicTitle',
  strip:      () => PRAC_STRIP_FIELDS,
  rows:       () => PRAC_ROW_FIELDS,
  fields:     () => PRAC_FIELDS
};

class Pager {
  constructor(root, meta, id, data, cfg) {
    this.root = root; this.meta = meta; this.id = id; this.data = data;
    this.cfg = cfg || PAGER_TH;
    this.pages = [];
    root.innerHTML = '';
    this.newPage();
  }

  newPage() {
    const id = this.id, meta = this.meta, data = this.data;
    const page = el('div', 'page ' + themeClass(currentTheme()) +
      (data.contentLang === 'en' ? ' ltr-body' : ''));

    /* الشريط العلوي */
    const top = el('div', 'pg-top');
    top.innerHTML =
      '<i class="slash s1"></i><i class="slash s2"></i><i class="slash s3"></i><i class="slash s4"></i>';
    page.appendChild(top);

    /* الجسم */
    const main = el('div', 'pg-main');
    main.appendChild(this.watermarks());

    /* الترويسة */
    const head = el('div', 'head');
    const logo = el('div', 'logo');
    logo.innerHTML = id.logo
      ? `<img src="${id.logo}" alt="">`
      : defaultLogoSvg(id);
    const titles = el('div', 'titles');
    titles.innerHTML =
      `<h1>${this.cfg.head(meta.lessonNo)}</h1>` +
      `<div class="pgno" data-pgno></div>`;
    const org = el('div', 'org');
    org.innerHTML =
      `<div class="o1">${escHtml(id.org)}</div>` +
      `<div class="o2">${escHtml(id.dept1)}</div>` +
      `<div class="o3">${escHtml(id.dept2)}</div>`;
    head.appendChild(org); head.appendChild(titles); head.appendChild(logo);
    main.appendChild(head);

    /* عنوان الدرس / اسم الموضوع */
    const tk = this.cfg.titleKey;
    const lt = el('div', 'lesson-title');
    lt.innerHTML = this.cfg.titleLabel;
    lt.appendChild(ed('span', '', data[tk] || '—', tk));
    main.appendChild(lt);

    /* بيانات الحصة والمادة تظهر في الصفحة الأولى فقط */
    if (this.pages.length === 0) {
      main.appendChild(this.strip());
      main.appendChild(this.rows());
    }

    /* منطقة التدفق */
    const flow = el('div', 'flow');
    main.appendChild(flow);
    page.appendChild(main);

    /* الشريط السفلي */
    const bot = el('div', 'pg-bot');
    bot.innerHTML =
      '<i class="slash s1"></i><i class="slash s2"></i><i class="slash s3"></i><i class="slash s4"></i>' +
      '<div class="fmeta">' +
      svgIcon('gear', 13, 'ic') +
      `<span class="sep">|</span><span>${escHtml(id.issueDate)}</span>` +
      `<span class="sep">|</span><span>تعديل (${escHtml(id.revision)})</span>` +
      `<span class="sep">|</span><span>اصدار (${escHtml(id.edition)})</span>` +
      `<span class="sep">|</span><span>${escHtml(id.formCode)}</span>` +
      '</div>';
    page.appendChild(bot);

    this.root.appendChild(page);
    this.pages.push(page);
    this.flow = flow;
    return flow;
  }

  watermarks() {
    const box = el('div');
    box.innerHTML =
      `<svg class="wm wm-circ" viewBox="0 0 200 160" fill="none" stroke="${this.id.navy}" stroke-width="1.6">
        <path d="M4 26h44l14 14h40M4 60h30l16-16M4 96h52l18 18h46M200 20h-36l-16 16h-40M200 54h-28l-18 18M200 92h-46l-16-16H92"/>
        <circle cx="48" cy="26" r="4"/><circle cx="102" cy="40" r="4"/><circle cx="56" cy="96" r="4"/>
        <circle cx="164" cy="20" r="4"/><circle cx="154" cy="72" r="4"/><circle cx="120" cy="114" r="4"/>
        <rect x="150" y="104" width="26" height="26" rx="3"/><rect x="20" y="120" width="20" height="20" rx="3"/>
      </svg>`;
    return box;
  }

  strip() {
    const s = el('div', 'strip');
    /* التاريخ يأخذ مساحة مرنة */
    const d = el('div', 'cellb dateline');
    d.innerHTML = `<div class="ico">${svgIcon('cal', 14)}</div><span class="lab">التاريخ:</span>`;
    const dv = ed('span', 'val', this.meta.dateText || '', 'meta.dateText');
    d.appendChild(dv);
    d.appendChild(el('span', 'dots'));
    s.appendChild(d);

    this.cfg.strip().filter(k => k !== 'date').forEach(k => {
      const f = this.cfg.fields().find(x => x.key === k);
      const c = el('div', 'cellb stack');
      c.innerHTML = `<div class="ico">${svgIcon(STRIP_ICONS[k] || 'clock', 14)}</div>`;
      const t = el('div', 'txt');
      t.innerHTML = `<span class="lab">${escHtml(f.label)}:</span>`;
      t.appendChild(ed('span', 'val', toArabicDigits(this.meta[k] || '—'), 'meta.' + k));
      c.appendChild(t);
      s.appendChild(c);
    });
    return s;
  }

  rows() {
    const r = el('div', 'rows');
    this.cfg.rows().forEach(k => {
      const f = this.cfg.fields().find(x => x.key === k);
      const line = el('div', 'rowline');
      line.innerHTML =
        `<div class="tag"><span>${escHtml(f.short || f.label)}</span>${svgIcon(ROW_ICONS[k] || 'book', 15, 'ic')}</div>`;
      line.appendChild(ed('div', 'val', this.meta[k] || '', 'meta.' + k));
      r.appendChild(line);
    });
    return r;
  }

  overflowing() {
    return this.flow.scrollHeight > this.flow.clientHeight + 1;
  }

  /** يحاول إضافة عنصر لمنطقة التدفق؛ يفتح صفحة جديدة عند الامتلاء */
  push(node) {
    this.flow.appendChild(node);
    if (this.overflowing()) {
      this.flow.removeChild(node);
      if (this.flow.children.length === 0) { this.flow.appendChild(node); return true; } // لا يتسع أصلًا
      this.newPage();
      this.flow.appendChild(node);
    }
    return true;
  }

  /** إضافة عنصر داخل حاوية مفتوحة (جسم لوحة) مع كشف الامتلاء */
  pushInto(container, node) {
    container.appendChild(node);
    if (this.overflowing()) { container.removeChild(node); return false; }
    return true;
  }

  /* الفراغ أسفل منطقة التدفّق بالبكسل.
     scrollHeight لا يصلح: مع overflow:hidden لا ينزل عن clientHeight أبدًا. */
  static slackOf(flow) {
    const kids = flow.children;
    if (!kids.length) return flow.clientHeight;
    return flow.getBoundingClientRect().bottom -
           kids[kids.length - 1].getBoundingClientRect().bottom;
  }

  /* ورقة التوقيعات وحدها قبيحة: ننقل إليها آخر لوحة من الورقة السابقة
     فتصير ورقة محتوى وتوقيعات، بدل ٩٠٪ بياض تحت ثلاثة مربعات. */
  tuckSignatures() {
    if (this.pages.length < 2) return;
    const last = this.pages[this.pages.length - 1].querySelector('.flow');
    const prev = this.pages[this.pages.length - 2].querySelector('.flow');
    if (!last || !prev) return;
    const kids = [...last.children];
    if (kids.length !== 1 || !kids[0].classList.contains('signs')) return;
    const donor = prev.lastElementChild;
    if (!donor || donor.classList.contains('signs')) return;
    last.insertBefore(donor, kids[0]);
    /* لو لم تتّسع بعد النقل نُرجعها — الورقة الفارغة أهون من ورقة فائضة */
    if (Pager.slackOf(last) < 0) prev.appendChild(donor);
  }

  /* كل ورقة تُملأ: آخر لوحة فيها تتمدّد لتأخذ الفراغ المتبقي.
     الفراغ الكبير جدًا لا يُمدّد — لوحة تنبيه بارتفاع نصف ورقة تبدو خطأً. */
  balance() {
    this.pages.forEach(pg => {
      const flow = pg.querySelector('.flow');
      if (!flow || !flow.children.length) return;
      const kids = [...flow.children];
      let target = null;
      for (let i = kids.length - 1; i >= 0; i--) {
        if (!kids[i].classList.contains('signs')) { target = kids[i]; break; }
      }
      if (!target) return;
      const slack = Pager.slackOf(flow);
      const h = flow.clientHeight;
      if (slack > 26 && slack < h * 0.42) target.classList.add('grow');
    });
  }

  /* شبكة أمان بعد الترقيم: أي ورقة فاض محتواها عن حدودها يُنقل آخر عنصر
     فيها إلى التالية. قياس الامتلاء أثناء البناء يخطئ أحيانًا — الشكل
     التوضيحي عائم (float) فلا يدخل في ارتفاع اللوحة، والصور تكبر بعد
     تحميلها. هنا نقيس الحدود الفعلية بعد اكتمال كل شيء. */
  enforceBounds() {
    for (let i = 0; i < this.pages.length && i < 60; i++) {
      const flow = this.pages[i].querySelector('.flow');
      let guard = 0;
      while (Pager.slackOf(flow) < -1 && flow.children.length > 1 && guard++ < 20) {
        const moved = flow.lastElementChild;
        let next = this.pages[i + 1];
        if (!next) { this.newPage(); next = this.pages[this.pages.length - 1]; }
        const nf = next.querySelector('.flow');
        nf.insertBefore(moved, nf.firstChild);
      }
    }
  }

  finish() {
    this.enforceBounds();
    this.tuckSignatures();
    this.balance();
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      const t = p.querySelector('[data-pgno]');
      if (t) t.textContent = n > 1
        ? `الصفحة ${AR_PAGE[i + 1] || toArabicDigits(i + 1)} (${toArabicDigits(i + 1)} / ${toArabicDigits(n)})`
        : 'صفحة واحدة';
    });
  }
}

/* =========================================================================
   بناء اللوحات
   ========================================================================= */
function panel(sec, bodyNode, opts) {
  opts = opts || {};
  const p = el('div', 'panel' + (sec.tone === 'red' ? ' red' : ''));
  const h = el('div', 'ph');
  h.innerHTML = `<span class="t">${escHtml(opts.label || sec.label)}</span>${svgIcon(sec.icon || 'book', 15, 'ic')}`;
  const b = el('div', 'pb');
  if (bodyNode) b.appendChild(bodyNode);
  p.appendChild(h); p.appendChild(b);
  p._body = b;
  return p;
}

function listNode(arr, path) {
  const ul = el('ul', 'plain');
  (arr && arr.length ? arr : ['—']).forEach((t, i) => {
    ul.appendChild(ed('li', '', t, path ? `${path}.${i}` : null));
  });
  return ul;
}

function groupsNode(sec, val, path) {
  const box = el('div', 'groups');
  (sec.groups || []).forEach(g => {
    const items = (val && val[g.key]) || [];
    if (!items.length) return;
    const lbl = (R_OBJ_LABEL[R_LTR ? 'en' : 'ar'][g.key]) || g.label;
    const d = el('div', 'g', `<b>${escHtml(lbl)}:</b>`);
    d.appendChild(listNode(items, `${path}.${g.key}`));
    box.appendChild(d);
  });
  if (!box.children.length) box.appendChild(el('div', '', '—'));
  return box;
}

function checklistNode(arr, path, numbered) {
  const ul = el('ul', 'check');
  (arr && arr.length ? arr : ['—']).forEach((t, i) => {
    const li = el('li');
    if (numbered) li.appendChild(el('span', 'num', RL.num(i + 1)));
    li.appendChild(el('span', 'box'));
    li.appendChild(ed('span', 'tx', t, path ? `${path}.${i}` : null));
    ul.appendChild(li);
  });
  return ul;
}

function qaNode(val, path) {
  const box = el('div', 'qa');
  const qs = (val && val.questions) || [];
  const dfl = R_LTR ? 'Question' : 'سؤال';
  (qs.length ? qs : [{ label: dfl, question: '—' }]).forEach((q, i) => {
    const d = el('div', 'q');
    d.appendChild(ed('div', 'lab', (q.label || dfl) + ':', `${path}.questions.${i}.label`));
    d.appendChild(ed('div', 'txt', q.question || '', `${path}.questions.${i}.question`));
    if (q.answer) d.appendChild(ed('div', 'ansbox', q.answer, `${path}.questions.${i}.answer`));
    else d.appendChild(el('div', 'ansline'));
    box.appendChild(d);
  });
  return box;
}

function drillsNode(val, path) {
  const box = el('div');
  if (val && val.instruction) box.appendChild(ed('div', 'ins', val.instruction, `${path}.instruction`));
  const rows = (val && val.rows) || [];
  const cols = (val && val.columns) || ['المطلوب'];
  const t = el('table', 'tbl');
  const thead = el('thead');
  const tr = el('tr');
  tr.appendChild(el('th', '', R_LTR ? '#' : 'م'));
  cols.forEach(c => tr.appendChild(el('th', '', bidiHtml(c))));
  tr.appendChild(el('th', '', R_LTR ? 'Answer' : 'الإجابة'));
  thead.appendChild(tr); t.appendChild(thead);
  const tb = el('tbody');
  (rows.length ? rows : [['—']]).forEach((r, i) => {
    const row = el('tr');
    row.appendChild(el('td', '', RL.num(i + 1)));
    const cells = Array.isArray(r) ? r : [r];
    cols.forEach((c, ci) => {
      const td = ed('td', '', cells[ci] != null ? cells[ci] : '', `${path}.rows.${i}.${ci}`);
      row.appendChild(td);
    });
    row.appendChild(el('td', 'fill', '.............'));
    tb.appendChild(row);
  });
  t.appendChild(tb); box.appendChild(t);
  return box;
}

function tableNode(tbl, path) {
  const t = el('table', 'tbl');
  const head = el('thead'); const hr = el('tr');
  (tbl.columns || []).forEach(c => hr.appendChild(el('th', '', bidiHtml(c))));
  head.appendChild(hr); t.appendChild(head);
  const tb = el('tbody');
  (tbl.rows || []).forEach((r, ri) => {
    const row = el('tr');
    (r || []).forEach((c, ci) => row.appendChild(ed('td', '', c, `${path}.rows.${ri}.${ci}`)));
    tb.appendChild(row);
  });
  t.appendChild(tb);
  return t;
}

function itemNode(it, idx, path) {
  const d = el('div', 'item');
  d.appendChild(el('span', 'n', RL.num(idx + 1)));
  const c = el('div', 'ic-body');
  if (it.heading) c.appendChild(ed('h4', '', it.heading, `${path}.heading`));
  if (it.body)    c.appendChild(ed('p', '', it.body, `${path}.body`));
  if (it.bullets && it.bullets.length) c.appendChild(listNode(it.bullets, `${path}.bullets`));
  if (it.table && it.table.columns)    c.appendChild(tableNode(it.table, `${path}.table`));
  d.appendChild(c);
  return d;
}

/* الشكل التوضيحي — رسم SVG يرسمه النموذج (لا قصّ من الكتاب) */
/* يعرض الشكل أيًّا كان مصدره: صورة من الكتاب أو رسم يرسمه النموذج.
   الشريط العلوي يحمل أزرار اختيار المصدر — تظهر على الشاشة وتختفي في الطباعة. */
function figureNode(fig, data) {
  if (!fig || (!fig.svg && !fig.src)) return null;
  const b = el('div', 'figbox' + (fig.source === 'ai' ? ' ai' : ''));
  const h = el('div', 'fh');
  h.appendChild(ed('span', 'cap', fig.caption || (R_LTR ? 'Figure' : 'الرسم التوضيحي'), 'figure.caption'));
  b.appendChild(h);
  /* الأزرار في سطر مستقلّ — مربع الرسم ضيّق فلا يتّسع للعنوان والأزرار معًا */
  if (data) b.appendChild(figPicker(data));
  const fi = el('div', 'fi');
  /* width/height على الوسم نفسه يحجز المساحة قبل تحميل الصورة */
  if (fig.src) fi.innerHTML = `<img src="${fig.src}" alt=""` +
    (fig.w && fig.h ? ` style="aspect-ratio:${fig.w}/${fig.h}"` : '') + '>';
  else fi.innerHTML = fig.svg;            /* مُعقَّم مسبقًا في figure.js */
  b.appendChild(fi);
  return b;
}

/* أزرار مصدر الرسم — القرار الأخير للمدرّس لا للنموذج */
function figPicker(data) {
  const alts = data.figAlts || {};
  const cur = data.figure ? (data.figure.source || 'book') : 'none';
  const box = el('div', 'fig-pick');
  const opts = [
    { k: 'book', t: 'رسم الكتاب', on: !!alts.book },
    { k: 'ai',   t: 'رسم التطبيق', on: !!alts.ai },
    { k: 'none', t: 'بدون رسم',   on: true }
  ];
  opts.forEach(o => {
    if (!o.on) return;
    const btn = el('button', 'fp' + (cur === o.k ? ' on' : ''), escHtml(o.t));
    btn.type = 'button';
    btn.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      data.figure = (o.k === 'none') ? null : (alts[o.k] || null);
      if (typeof onFigureChange === 'function') onFigureChange();
    };
    box.appendChild(btn);
  });
  return box;
}

function blankPanel(bp) {
  const sec = { label: bp.label, icon: bp.icon };
  const lines = el('div', 'lines');
  for (let i = 0; i < (bp.lines || 5); i++) lines.appendChild(el('i'));
  return panel(sec, lines);
}

/* =========================================================================
   تدفّق عناصر عرض الدرس عبر الصفحات
   ========================================================================= */
function flowItems(pg, sec, items, data, opts) {
  opts = opts || {};
  const base = opts.path || 'content';
  let idx = 0, firstPanel = true, guard = 0, figDone = false;

  while (idx < items.length && guard++ < 200) {
    const p = panel(sec, null, { label: firstPanel ? sec.label : sec.contLabel });
    const inner = el('div', 'items');
    p._body.appendChild(inner);

    pg.push(p);

    /* الشكل التوضيحي يدخل أول لوحة تتّسع له — لا أول لوحة دائمًا.
       إقحامه في لوحة لا تسعه كان يدفع اللوحة كلها لصفحة جديدة ويترك
       ثلث الورقة السابقة فارغًا. */
    if (!figDone && !opts.noFigure && readFigure(data)) {
      const f = figureNode(readFigure(data), data);
      if (f) {
        inner.parentNode.insertBefore(f, inner);
        if (pg.overflowing()) f.remove(); else figDone = true;
      }
    }

    let added = 0;
    while (idx < items.length) {
      const node = itemNode(items[idx], idx, `${base}.${idx}`);
      if (pg.pushInto(inner, node)) { idx++; added++; }
      else break;
    }

    if (added === 0) {
      p.remove();
      if (pg.flow.children.length === 0) {
        /* لا يتسع حتى في صفحة فارغة — نضعه قسرًا لتجنّب حلقة لا نهائية */
        pg.flow.appendChild(p);
        inner.appendChild(itemNode(items[idx], idx, `${base}.${idx}`));
        idx++;
      } else {
        pg.newPage();
        continue;                 /* أعد المحاولة في صفحة جديدة بنفس العنوان */
      }
    }
    firstPanel = false;
  }
}

/* =========================================================================
   الدالة الرئيسية
   ========================================================================= */
function renderDocument(root, data, meta, id) {
  R_LTR = (data && data.contentLang === 'en');
  const pg = new Pager(root, meta, id, data);
  const S = k => SECTIONS.find(s => s.key === k);
  const has = k => data[k] && (Array.isArray(data[k]) ? data[k].length : true);

  /* --- الأهداف --- */
  if (data.objectives) {
    const o = S('objectives');
    pg.push(panel(o, groupsNode(o, data.objectives, 'objectives')));
  }

  /* --- الثلاثي: متطلبات / وسائل / استراتيجيات --- */
  const trioKeys = ['prerequisites', 'resources', 'strategies'].filter(has);
  if (trioKeys.length) {
    const t = el('div', 'trio');
    trioKeys.forEach(k => t.appendChild(panel(S(k), listNode(data[k], k))));
    pg.push(t);
  }

  /* --- التمهيد --- */
  if (data.warmup) pg.push(panel(S('warmup'), ed('div', '', data.warmup, 'warmup')));

  /* --- عرض الدرس --- */
  flowItems(pg, S('content'), data.content || [], data);

  /* --- الصف الأول من اللوحات: تدريبات / أنشطة / تقويم --- */
  const r1 = el('div', 'trio');
  if (data.drills)      r1.appendChild(panel(S('drills'), drillsNode(data.drills, 'drills')));
  if (has('activities'))r1.appendChild(panel(S('activities'), checklistNode(data.activities, 'activities')));
  if (data.assessment)  r1.appendChild(panel(S('assessment'), qaNode(data.assessment, 'assessment')));
  if (r1.children.length) pg.push(r1);

  /* --- الصف الثاني: تنبيه / واجب / ملاحظات --- */
  const r2 = el('div', 'trio');
  if (data.warning)   r2.appendChild(panel(S('warning'), ed('div', '', data.warning, 'warning')));
  if (has('homework'))r2.appendChild(panel(S('homework'), checklistNode(data.homework, 'homework', true)));
  BLANK_PANELS.forEach(bp => r2.appendChild(blankPanel(bp)));
  if (r2.children.length) pg.push(r2);

  /* --- التوقيعات: تُوضع في نهاية كل تحضير، وتفتح صفحة إن لم تتسع --- */
  const sg = el('div', 'signs');
  SIGNATURES.forEach(sig => {
    const b = el('div', 's');
    const nm = sig.nameFrom ? (meta[sig.nameFrom] || '') : '';
    b.innerHTML = `<b>${escHtml(sig.label)}</b>` +
      (nm ? `<u>${escHtml(nm)}</u>` : '') + '<i></i>';
    sg.appendChild(b);
  });
  pg.push(sg);

  pg.finish();
  return pg.pages.length;
}

/* شعار افتراضي إلى أن يرفع المستخدم شعار الجهة */
function defaultLogoSvg(id) {
  return `<svg viewBox="0 0 100 100" width="100%" height="100%">
    <circle cx="50" cy="50" r="47" fill="#fff" stroke="${id.navy}" stroke-width="4"/>
    <circle cx="50" cy="50" r="38" fill="none" stroke="${id.red}" stroke-width="2"/>
    <path d="M50 26 38 56h9l-2 18 17-24h-9z" fill="${id.red}"/>
    <path d="M22 74c8-6 18-8 28-8s20 2 28 8" fill="none" stroke="${id.navy}" stroke-width="3"/>
    <text x="50" y="20" text-anchor="middle" font-size="9" font-weight="700" fill="${id.navy}">مركز التدريب</text>
  </svg>`;
}

/* ===== js/practical.js ===== */
/* =========================================================================
   practical.js — ورقة تحضير التدريب العملي (F-PR-03)

   نفس ترويسة وتذييل وهيكل الورقة النظرية، وأقسامها بترتيب النموذج المعتمد:
   الغرض · العناصر · الخامات · العدد والأدوات · رسم التمرين · طريقة التنفيذ ·
   الأمن الصناعي · مهمات الوقاية · ملاحظات المدرب، ثم التوقيعات الثلاثة.
   استمارة التقييم بأسماء الطلاب ليست جزءًا من التحضير — تُطبع منفصلة.
   ========================================================================= */

/* جدول العدد والأدوات: عمودان مرقّمان جنبًا إلى جنب كما في النموذج */
function pairsNode(arr, path) {
  const list = (arr && arr.length ? arr : ['—']);
  const half = Math.ceil(list.length / 2);
  const t = el('table', 'tbl pairs');

  const cg = el('colgroup');
  [8, 42, 8, 42].forEach(w => {
    const c = document.createElement('col');
    c.style.width = w + '%';
    cg.appendChild(c);
  });
  t.appendChild(cg);

  const th = el('thead');
  const hr = el('tr');
  ['م', 'العدة / الأداة', 'م', 'العدة / الأداة'].forEach(x => hr.appendChild(el('th', '', escHtml(x))));
  th.appendChild(hr); t.appendChild(th);

  const tb = el('tbody');
  for (let i = 0; i < half; i++) {
    const j = i + half;
    const tr = el('tr');
    tr.appendChild(el('td', 'c', RL.num(i + 1)));
    tr.appendChild(ed('td', '', list[i] || '', `tools.${i}`));
    if (j < list.length) {
      tr.appendChild(el('td', 'c', RL.num(j + 1)));
      tr.appendChild(ed('td', '', list[j] || '', `tools.${j}`));
    } else {
      tr.appendChild(el('td', 'c', ''));
      tr.appendChild(el('td', ''));
    }
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  return t;
}

/* مربع رسم التمرين — صورة مقصوصة من الكتاب، أو رسم بديل، أو إطار فارغ */
function drawNode(data) {
  const box = el('div', 'drawbox');
  const fig = readFigure(data);
  const kindLabel = (data.practKind === 'operation')
    ? 'رسم العملية / العدة والأدوات' : 'شكل التمرين المطلوب تنفيذه';

  const cap = el('div', 'dcap');
  cap.appendChild(ed('span', 'cap', data.drawing || (fig && fig.caption) || kindLabel, 'drawing'));
  if (data.figAlts) cap.appendChild(figPicker(data));
  box.appendChild(cap);

  const inner = el('div', 'dbody');
  if (fig && fig.src) {
    inner.innerHTML = `<img src="${fig.src}" alt=""` +
      (fig.w && fig.h ? ` style="aspect-ratio:${fig.w}/${fig.h}"` : '') + '>';
  } else if (fig && fig.svg) {
    inner.innerHTML = fig.svg;                  /* مُعقَّم مسبقًا في figure.js */
    inner.classList.add('svgfig');
  } else {
    inner.classList.add('empty');
    inner.textContent = 'مساحة الرسم — تُرسم بخط اليد';
  }
  box.appendChild(inner);
  return box;
}

/* ---------- الدالة الرئيسية ---------- */
function renderPractical(root, data, meta, id) {
  R_LTR = (data && data.contentLang === 'en');
  const pgId = Object.assign({}, id, IDENTITY_PRAC);
  const pg = new Pager(root, meta, pgId, data, PAGER_PR);
  const S = k => PRAC_SECTIONS.find(s => s.key === k);
  const has = k => data[k] && (Array.isArray(data[k]) ? data[k].length : true);

  /* --- الغرض من الموضوع وعناصره: لوحتان جنبًا إلى جنب --- */
  const intro = el('div', 'trio two');
  if (has('purpose'))  intro.appendChild(panel(S('purpose'),  listNode(data.purpose, 'purpose')));
  if (has('elements')) intro.appendChild(panel(S('elements'), listNode(data.elements, 'elements')));
  if (intro.children.length) pg.push(intro);

  /* --- الخامات المطلوبة --- */
  if (has('materials')) pg.push(panel(S('materials'), listNode(data.materials, 'materials')));

  /* --- العدد والأدوات --- */
  if (has('tools')) pg.push(panel(S('tools'), pairsNode(data.tools, 'tools')));

  /* --- رسم التمرين --- */
  pg.push(panel(S('drawing'), drawNode(data)));

  /* --- طريقة تنفيذ التمرين (تتدفّق على الصفحات) --- */
  flowItems(pg, S('steps'), data.steps || [], data, { path: 'steps', noFigure: true });

  /* --- الأمن الصناعي ومهمات الوقاية وملاحظات المدرب --- */
  const r1 = el('div', 'trio');
  if (has('safety')) r1.appendChild(panel(S('safety'), listNode(data.safety, 'safety')));
  if (has('ppe'))    r1.appendChild(panel(S('ppe'), checklistNode(data.ppe, 'ppe')));
  PRAC_BLANK_PANELS.forEach(bp => r1.appendChild(blankPanel(bp)));
  if (r1.children.length) pg.push(r1);

  /* --- التوقيعات --- */
  const sg = el('div', 'signs');
  PRAC_SIGNATURES.forEach(sig => {
    const b = el('div', 's');
    const nm = sig.nameFrom ? (meta[sig.nameFrom] || '') : '';
    b.innerHTML = `<b>${escHtml(sig.label)}</b>` + (nm ? `<u>${escHtml(nm)}</u>` : '') + '<i></i>';
    sg.appendChild(b);
  });
  pg.push(sg);

  pg.finish();
  return pg.pages.length;
}

/* ===== js/sheet.js ===== */
/* =========================================================================
   sheet.js — هيكل الورقة المشترك (شريط علوي · ترويسة الهوية · شريط سفلي)
   يستخدمه جدول الخطة الزمنية وغلاف المادة.
   ========================================================================= */

function barSlashes() {
  return '<i class="slash s1"></i><i class="slash s2"></i><i class="slash s3"></i><i class="slash s4"></i>';
}

function identityHead(id, opts) {
  opts = opts || {};
  const head = el('div', 'head' + (opts.big ? ' big' : ''));

  const org = el('div', 'org');
  org.innerHTML =
    `<div class="o1">${escHtml(id.org)}</div>` +
    `<div class="o2">${escHtml(id.dept1)}</div>` +
    `<div class="o3">${escHtml(id.dept2)}</div>`;

  const titles = el('div', 'titles');
  titles.innerHTML =
    `<h1>${escHtml(opts.title || '')}</h1>` +
    (opts.subtitle != null ? `<div class="pgno">${escHtml(opts.subtitle)}</div>` : '<div class="pgno" data-pgno></div>');

  const logo = el('div', 'logo');
  logo.innerHTML = id.logo ? `<img src="${id.logo}" alt="">` : defaultLogoSvg(id);

  head.appendChild(org); head.appendChild(titles); head.appendChild(logo);
  return head;
}

function footerBar(id, plainText) {
  const bot = el('div', 'pg-bot');
  if (plainText != null) {
    bot.innerHTML = barSlashes() +
      `<div class="fmeta"><span>${escHtml(plainText)}</span></div>`;
    return bot;
  }
  bot.innerHTML = barSlashes() +
    '<div class="fmeta">' +
    svgIcon('gear', 13, 'ic') +
    `<span class="sep">|</span><span>${escHtml(id.issueDate)}</span>` +
    `<span class="sep">|</span><span>تعديل (${escHtml(id.revision)})</span>` +
    `<span class="sep">|</span><span>اصدار (${escHtml(id.edition)})</span>` +
    `<span class="sep">|</span><span>${escHtml(id.formCode)}</span>` +
    '</div>';
  return bot;
}

function watermarkTech(navy, kind) {
  const box = el('div');
  if (kind === 'plain') {
    /* نمط هندسي عام يصلح لكل التخصصات */
    box.innerHTML =
      `<svg class="wm wm-geo" viewBox="0 0 200 200" fill="none" stroke="${navy}" stroke-width="1.4">
        <rect x="10" y="10" width="60" height="60" rx="6"/>
        <rect x="34" y="34" width="60" height="60" rx="6"/>
        <circle cx="150" cy="46" r="30"/><circle cx="150" cy="46" r="18"/>
        <path d="M6 130h80l24 24h84M6 166h50l22-22h116"/>
        <path d="M120 96l34 34 34-34"/>
      </svg>`;
  } else {
    box.innerHTML =
      `<svg class="wm wm-circ" viewBox="0 0 200 160" fill="none" stroke="${navy}" stroke-width="1.6">
        <path d="M4 26h44l14 14h40M4 60h30l16-16M4 96h52l18 18h46M200 20h-36l-16 16h-40M200 54h-28l-18 18M200 92h-46l-16-16H92"/>
        <circle cx="48" cy="26" r="4"/><circle cx="102" cy="40" r="4"/><circle cx="56" cy="96" r="4"/>
        <circle cx="164" cy="20" r="4"/><circle cx="154" cy="72" r="4"/><circle cx="120" cy="114" r="4"/>
        <rect x="150" y="104" width="26" height="26" rx="3"/><rect x="20" y="120" width="20" height="20" rx="3"/>
      </svg>`;
  }
  return box;
}

/**
 * ينشئ ورقة كاملة ويُرجع { page, main, flow }
 * opts: { landscape, title, subtitle, wm:'circuit'|'plain'|null, cover }
 */
function makeSheet(id, opts) {
  opts = opts || {};
  const page = el('div', 'page ' + themeClass(currentTheme()) +
    (opts.landscape ? ' land' : '') + (opts.cover ? ' cover' : ''));

  const top = el('div', 'pg-top');
  top.innerHTML = barSlashes();
  page.appendChild(top);

  const main = el('div', 'pg-main');
  if (opts.wm) main.appendChild(watermarkTech(id.navy, opts.wm));
  if (!opts.cover) main.appendChild(identityHead(id, opts));

  const flow = el('div', 'flow');
  main.appendChild(flow);
  page.appendChild(main);
  page.appendChild(footerBar(id, opts.cover ? (id.org + '   ·   ' + id.dept1) : null));

  return { page, main, flow };
}

/* خانات التوقيع — تُستخدم في التحضير والخطة */
function signRow(list, meta) {
  const sg = el('div', 'signs');
  sg.style.gridTemplateColumns = `repeat(${list.length},1fr)`;
  list.forEach(sig => {
    const b = el('div', 's');
    const nm = sig.nameFrom ? (meta[sig.nameFrom] || '') : '';
    b.innerHTML = `<b>${escHtml(sig.label)}</b>` + (nm ? `<u>${escHtml(nm)}</u>` : '') + '<i></i>';
    sg.appendChild(b);
  });
  return sg;
}

/* ===== js/plan.js ===== */
/* =========================================================================
   plan.js — الخطة الزمنية للفصل الدراسي: محرّر الصفوف + جدول A4 عرضي
   ========================================================================= */

const plan = {
  meta: {},
  rows: []          /* [{ unit, notes, items:[{name, desc}] }] */
};

/* ---------- بناء الصفوف من عدد الأسابيع ---------- */
function planEnsureRows(n) {
  n = Math.max(1, Math.min(40, parseInt(n, 10) || 15));
  while (plan.rows.length < n)
    plan.rows.push({ unit: '', notes: '', items: [{ name: '', desc: '' }], off: false, offReason: '' });
  if (plan.rows.length > n) plan.rows.length = n;
  /* توافق مع خطط محفوظة قبل إضافة «أسبوع بلا دروس» */
  plan.rows.forEach(r => { if (r.off == null) { r.off = false; r.offReason = ''; } });
}

/* الأسابيع التي يُدرَّس فيها فعلًا — يبني عليها التحضير ترقيمه وتواريخه */
function planTeachingWeeks(p) {
  const rows = (p && p.rows) || [];
  const start = (p && p.meta && p.meta.startDate) || '';
  const out = [];
  rows.forEach((r, i) => {
    if (r.off) return;
    const names = (r.items || []).map(x => (x.name || '').trim()).filter(Boolean);
    out.push({
      weekIndex: i,                       /* ترتيب الأسبوع في الخطة (من صفر) */
      weekNo: i + 1,
      weekLabel: weekName(i + 1),
      dateText: weekSaturday(start, i + 1),
      isoDate: weekSaturdayISO(start, i + 1),
      unit: r.unit || '',
      notes: r.notes || '',
      titles: names,
      descs: (r.items || []).map(x => (x.desc || '').trim())
    });
  });
  return out;
}

/* ---------- محرّر الصفوف في الواجهة ---------- */
function planRenderEditor() {
  const box = document.querySelector('#planRows');
  const start = (document.querySelector('#p_startDate') || {}).value || '';
  box.innerHTML = '';

  plan.rows.forEach((r, i) => {
    const card = el('div', 'wk');
    const date = weekSaturday(start, i + 1);

    const hd = el('div', 'wk-head');
    hd.innerHTML =
      `<span class="wk-n">${toArabicDigits(i + 1)}</span>` +
      `<b>${escHtml(weekName(i + 1))}</b>` +
      `<span class="wk-date">${escHtml(date || '—')}</span>`;
    card.appendChild(hd);

    /* أسبوع بلا دروس: امتحان أو تعريفي — يُطبع في الخطة ويتخطّاه التحضير */
    const offBar = el('div', 'wk-off');
    const lab = el('label', 'wk-off-lab');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!r.off;
    lab.appendChild(cb);
    lab.appendChild(el('span', '', 'أسبوع بلا دروس'));
    offBar.appendChild(lab);

    /* السبب: قائمة جاهزة، وآخر خيار يفتح كتابة حرّة */
    const known = PLAN_OFF_REASONS.includes(r.offReason);
    const isOther = !!(r.off && r.offReason && !known);

    const sel = document.createElement('select');
    sel.innerHTML = PLAN_OFF_REASONS.map(x => `<option>${escHtml(x)}</option>`).join('');
    sel.value = isOther ? PLAN_OFF_OTHER : (known ? r.offReason : PLAN_OFF_REASONS[0]);
    sel.hidden = !r.off;

    const free = document.createElement('input');
    free.type = 'text';
    free.className = 'wk-off-free';
    free.placeholder = 'اكتب السبب';
    free.value = isOther ? r.offReason : '';
    free.hidden = !(r.off && sel.value === PLAN_OFF_OTHER);

    const sync = () => {
      const other = sel.value === PLAN_OFF_OTHER;
      free.hidden = !(cb.checked && other);
      r.offReason = !cb.checked ? '' : (other ? free.value.trim() : sel.value);
    };
    cb.onchange = () => { r.off = cb.checked; sync(); planRenderEditor(); };
    sel.onchange = sync;
    free.oninput = sync;

    offBar.appendChild(sel);
    offBar.appendChild(free);
    card.appendChild(offBar);
    if (r.off) { box.appendChild(card); return; }

    const grid = el('div', 'wk-grid');
    grid.appendChild(planField('الوحدة', r.unit, 'الوحدة الأولى', v => { r.unit = v; }));
    grid.appendChild(planField('ملاحظات', r.notes, 'اختياري', v => { r.notes = v; }));
    card.appendChild(grid);

    const list = el('div', 'wk-items');
    r.items.forEach((it, j) => {
      const row = el('div', 'wk-item');
      row.appendChild(planField('اسم الدرس', it.name, 'مثال: شفرة ألوان المقاومات', v => { it.name = v; }));
      row.appendChild(planField('وصف مختصر', it.desc, 'سطر واحد يوضّح فكرة الدرس', v => { it.desc = v; }));
      const del = el('button', 'wk-del', '×');
      del.title = 'حذف الدرس';
      del.onclick = () => {
        if (r.items.length === 1) { it.name = ''; it.desc = ''; }
        else r.items.splice(j, 1);
        planRenderEditor();
      };
      row.appendChild(del);
      list.appendChild(row);
    });
    card.appendChild(list);

    const add = el('button', 'wk-add', '＋ درس آخر في نفس الأسبوع');
    add.onclick = () => { r.items.push({ name: '', desc: '' }); planRenderEditor(); };
    card.appendChild(add);

    box.appendChild(card);
  });
}

function planField(label, value, ph, onInput) {
  const l = el('label', 'field sm');
  l.innerHTML = `<span>${escHtml(label)}</span>`;
  const i = document.createElement('input');
  i.type = 'text'; i.value = value || ''; i.placeholder = ph || '';
  i.addEventListener('input', () => onInput(i.value));
  l.appendChild(i);
  return l;
}

/* ---------- رسم الجدول على صفحات A4 عرضية ---------- */
function planContentCell(items) {
  const box = el('div', 'pl-items');
  (items || []).filter(x => (x.name || '').trim() || (x.desc || '').trim()).forEach((it, k) => {
    const d = el('div', 'pl-item');
    if (it.name) d.appendChild(ed('b', '', it.name, null));
    if (it.desc) d.appendChild(ed('span', 'ds', it.desc, null));
    box.appendChild(d);
  });
  if (!box.children.length) box.appendChild(el('div', 'pl-item', '&nbsp;'));
  return box;
}

function planTableHead() {
  const t = el('table', 'tbl pl');
  const cg = el('colgroup');
  PLAN_COLUMNS.forEach(c => {
    const col = document.createElement('col');
    col.style.width = c.w + 'mm';
    cg.appendChild(col);
  });
  t.appendChild(cg);
  const th = el('thead');
  const tr = el('tr');
  PLAN_COLUMNS.forEach(c => tr.appendChild(el('th', '', escHtml(c.label))));
  th.appendChild(tr); t.appendChild(th);
  t.appendChild(el('tbody'));
  return t;
}

function planRowNode(r, i, start) {
  const tr = el('tr');
  if (r.off) {
    tr.className = 'off';
    tr.appendChild(el('td', 'c', toArabicDigits(i + 1)));
    tr.appendChild(el('td', 'c', escHtml(weekName(i + 1))));
    tr.appendChild(ed('td', 'c', weekSaturday(start, i + 1), null));
    const reason = (r.offReason && r.offReason !== PLAN_OFF_OTHER) ? r.offReason : 'أسبوع بلا دروس';
    const td = el('td', 'c off-cell', escHtml(reason));
    td.colSpan = 3;
    tr.appendChild(td);
    return tr;
  }
  const cells = {
    no:    () => el('td', 'c', toArabicDigits(i + 1)),
    week:  () => el('td', 'c', escHtml(weekName(i + 1))),
    date:  () => ed('td', 'c', weekSaturday(start, i + 1), null),
    unit:  () => ed('td', 'c', r.unit || '', null),
    items: () => { const td = el('td', 'x'); td.appendChild(planContentCell(r.items)); return td; },
    notes: () => ed('td', 'n', r.notes || '', null)
  };
  PLAN_COLUMNS.forEach(c => tr.appendChild(cells[c.key]()));
  return tr;
}

function renderPlan(root, p, id) {
  root.innerHTML = '';
  const meta = p.meta, rows = p.rows;
  const start = meta.startDate || '';
  const pages = [];
  let sheet = null, table = null, tbody = null;

  const openPage = () => {
    sheet = makeSheet(id, {
      wm: null,
      /* الاسم الطويل كان يلتفّ ثلاثة أسطر فيأكل ارتفاع الورقة — المادة في شريط البيانات */
      title: 'الخطة الزمنية',
      subtitle: null
    });
    root.appendChild(sheet.page);
    pages.push(sheet.page);
    /* سطر البيانات فوق الجدول في الصفحة الأولى */
    if (pages.length === 1) sheet.flow.appendChild(planMetaStrip(meta));
    table = planTableHead();
    tbody = table.querySelector('tbody');
    sheet.flow.appendChild(table);
  };
  const overflowing = () => sheet.flow.scrollHeight > sheet.flow.clientHeight + 1;

  openPage();
  let i = 0, guard = 0;
  while (i < rows.length && guard++ < 500) {
    const tr = planRowNode(rows[i], i, start);
    tbody.appendChild(tr);
    if (overflowing()) {
      tbody.removeChild(tr);
      if (!tbody.children.length) { tbody.appendChild(tr); i++; }   /* لا يتسع أصلًا */
      else { openPage(); continue; }
    } else i++;
  }

  /* التوقيعات في نهاية الخطة */
  const sg = signRow(PLAN_SIGNATURES, meta);
  sheet.flow.appendChild(sg);
  if (overflowing()) { sheet.flow.removeChild(sg); openPage(); sheet.flow.appendChild(sg); }

  /* الفراغ المتبقي يُوزَّع على صفوف الجدول كارتفاع إضافي — صفوف أوسع قليلًا
     أفضل من خُمس ورقة أبيض أسفلها. التوزيع محسوب بالضبط فلا يفيض. */
  pages.forEach(pg => {
    const fl = pg.querySelector('.flow');
    const tb = pg.querySelector('table.pl');
    if (!fl || !tb || !fl.children.length) return;
    const last = fl.lastElementChild;
    const r = fl.getBoundingClientRect();
    /* الورقة مُصغَّرة بـtransform في المعاينة، وgetBoundingClientRect يعطي
       بكسلات مُقاسة. الحشو يُكتب ببكسلات تخطيط غير مُقاسة، فنقسم على النسبة. */
    const scale = (r.height && fl.clientHeight) ? (r.height / fl.clientHeight) : 1;
    const slack = (r.bottom - last.getBoundingClientRect().bottom) / (scale || 1);
    const n = tb.querySelectorAll('tbody tr').length;
    if (slack < 16 || !n) return;
    tb.style.setProperty('--pl-extra', Math.floor((slack - 6) / n) + 'px');
    tb.classList.add('stretch');
  });

  /* أرقام الصفحات */
  pages.forEach((pg, k) => {
    const t = pg.querySelector('[data-pgno]');
    if (t) t.textContent = pages.length > 1
      ? `صفحة ${toArabicDigits(k + 1)} من ${toArabicDigits(pages.length)}`
      : (meta.term || '');
  });
  return pages.length;
}

function planMetaStrip(meta) {
  const s = el('div', 'pl-meta');
  const cell = (lab, val) => {
    const c = el('div', 'm');
    c.innerHTML = `<span class="lab">${escHtml(lab)}:</span><b>${escHtml(val || '—')}</b>`;
    return c;
  };
  s.appendChild(cell('المادة', meta.subject));
  s.appendChild(cell('الصف', meta.grade));
  if (meta.dept) s.appendChild(cell('القسم', meta.dept));
  s.appendChild(cell('العام الدراسي', meta.year));
  s.appendChild(cell('الفصل الدراسي', meta.term));
  s.appendChild(cell('المدرس', meta.teacher));
  return s;
}

/* ===== js/camera.js ===== */
/* =========================================================================
   camera.js — تصوير صفحات الكتاب داخل التطبيق

   لماذا لا نستخدم <input capture="environment">؟
   لأنه يفتح تطبيق الكاميرا الخارجي، فيخرج المستخدم من التطبيق، وأندرويد كثيرًا
   ما يقتل صفحة التطبيق تحت ضغط الذاكرة ثم يعيد تحميلها عند الرجوع — فيرجع
   المستخدم إلى شاشة المكتبة وتضيع الصور والبيانات المكتوبة. هذه الكاميرا تعمل
   داخل الصفحة عبر getUserMedia فلا يحدث خروج ولا إعادة تحميل.
   ========================================================================= */

const Cam = {
  stream: null,
  facing: 'environment',
  shots: [],            /* [{ file, url }] */
  onDone: null,

  supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  },

  async open(onDone) {
    Cam.onDone = onDone || null;
    Cam.shots = [];
    Cam.renderStrip();
    const back = document.querySelector('#camDlg');
    back.hidden = false;
    document.body.classList.add('cam-on');
    const ok = await Cam.start();
    if (!ok) return false;
    return true;
  },

  async start() {
    const msg = document.querySelector('#camMsg');
    const vid = document.querySelector('#camVideo');
    msg.hidden = true;
    Cam.stop();
    try {
      Cam.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: Cam.facing },
          width:  { ideal: 2560 },
          height: { ideal: 1440 }
        }
      });
      vid.srcObject = Cam.stream;
      await vid.play().catch(() => {});
      return true;
    } catch (e) {
      /* الإذن مرفوض أو لا توجد كاميرا — نرجع لطريقة النظام */
      msg.textContent = (e && e.name === 'NotAllowedError')
        ? 'التطبيق لا يملك إذن الكاميرا. اسمح به من إعدادات الموقع، أو استخدم «اختيار من الملفات».'
        : 'تعذّر تشغيل الكاميرا على هذا الجهاز — استخدم «اختيار من الملفات».';
      msg.hidden = false;
      return false;
    }
  },

  stop() {
    if (Cam.stream) { Cam.stream.getTracks().forEach(t => t.stop()); Cam.stream = null; }
    const vid = document.querySelector('#camVideo');
    if (vid) vid.srcObject = null;
  },

  async flip() {
    Cam.facing = (Cam.facing === 'environment') ? 'user' : 'environment';
    await Cam.start();
  },

  /** يلتقط إطارًا من الفيديو ويحوّله ملف JPEG */
  async shoot() {
    const vid = document.querySelector('#camVideo');
    const w = vid.videoWidth, h = vid.videoHeight;
    if (!w || !h) return toast('الكاميرا لم تجهز بعد', true);

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(vid, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) return toast('تعذّر حفظ الصورة', true);

    const n = Cam.shots.length + 1;
    const file = new File([blob], `صفحة-${n}.jpg`, { type: 'image/jpeg' });
    Cam.shots.push({ file, url: URL.createObjectURL(blob) });
    Cam.renderStrip();

    /* نبضة بصرية تؤكد الالتقاط */
    const v = document.querySelector('.cam-view');
    v.classList.add('flash');
    setTimeout(() => v.classList.remove('flash'), 160);
  },

  renderStrip() {
    const s = document.querySelector('#camStrip');
    if (!s) return;
    s.innerHTML = '';
    Cam.shots.forEach((sh, i) => {
      const b = document.createElement('div');
      b.className = 'cam-th';
      b.innerHTML = `<img src="${sh.url}" alt=""><button title="حذف">&times;</button>`;
      b.querySelector('button').onclick = () => {
        URL.revokeObjectURL(sh.url);
        Cam.shots.splice(i, 1);
        Cam.renderStrip();
      };
      s.appendChild(b);
    });
    const c = document.querySelector('#camCount');
    if (c) c.textContent = Cam.shots.length
      ? `${toArabicDigits(Cam.shots.length)} ${Cam.shots.length === 1 ? 'صفحة' : 'صفحات'}`
      : 'لم تُصوَّر صفحات بعد';
    const d = document.querySelector('#camDone');
    if (d) d.disabled = !Cam.shots.length;
  },

  close(keep) {
    Cam.stop();
    const files = keep ? Cam.shots.map(s => s.file) : [];
    if (!keep) Cam.shots.forEach(s => URL.revokeObjectURL(s.url));
    Cam.shots = [];
    Cam.renderStrip();
    document.querySelector('#camDlg').hidden = true;
    document.body.classList.remove('cam-on');
    if (files.length && Cam.onDone) Cam.onDone(files);
  }
};

function bindCamera() {
  const camIn = document.querySelector('#cameraInput');

  document.querySelector('#btnCamera').onclick = async () => {
    if (!Cam.supported()) return camIn.click();
    const ok = await Cam.open(files => addFiles(files));
    if (!ok) {
      /* لم تعمل الكاميرا الداخلية — نغلق ونستخدم كاميرا النظام كخطة بديلة */
      setTimeout(() => { Cam.close(false); camIn.click(); }, 1800);
    }
  };

  document.querySelector('#camShot').onclick  = () => Cam.shoot();
  document.querySelector('#camFlip').onclick  = () => Cam.flip();
  document.querySelector('#camClose').onclick = () => Cam.close(false);
  document.querySelector('#camDone').onclick  = () => Cam.close(true);

  /* لو خرج المستخدم من التطبيق والكاميرا مفتوحة، نطفئها لتوفير الطاقة */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Cam.stream) Cam.stop();
    else if (!document.hidden && !document.querySelector('#camDlg').hidden && !Cam.stream) Cam.start();
  });
}

/* ===== js/library.js ===== */
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
  let cls = 'bk', txt = '', act = '', act2 = '';

  if (Backup.status === 'ready') {
    cls += ' ok';
    txt = 'النسخ الاحتياطي التلقائي مُفعَّل' +
      (Backup.lastAt ? ' · آخر نسخة ' + new Date(Backup.lastAt).toLocaleString('ar-EG') : '');
  } else if (Backup.status === 'armed') {
    /* المجلد مختار والإذن سيُطلب عند أول حفظ — لا داعي لإزعاج المدرّس الآن */
    cls += ' ok';
    txt = 'النسخ الاحتياطي جاهز — يُطلب تأكيد الإذن عند أول حفظ' +
      (Backup.lastAt ? ' · آخر نسخة ' + new Date(Backup.lastAt).toLocaleString('ar-EG') : '');
  } else if (Backup.status === 'needPermission') {
    cls += ' warn';
    txt = 'شغلك جاهز للنسخ — اضغط «تأكيد» لحفظه في مجلدك';
    act = 'تأكيد'; act2 = 'إيقاف النسخ';
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
  if (act2) {
    const btn2 = el('button', 'bk-act ghosty', act2);
    btn2.onclick = async () => {
      const ok = await ask('إيقاف النسخ الاحتياطي التلقائي إلى المجلد؟ يبقى شغلك محفوظًا على الجهاز، ' +
        'ويمكنك دائمًا «تصدير نسخة» يدويًا.', { title: 'إيقاف النسخ التلقائي', yes: 'أوقفه', danger: false });
      if (ok !== true) return;
      await Backup.disable();
      toast('أُوقف النسخ التلقائي');
      renderBackupBar();
    };
    b.appendChild(btn2);
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

/* ===== js/draft.js ===== */
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

/* ===== js/cover.js ===== */
/* =========================================================================
   cover.js — غلاف المادة: ورقة A4 رسمية بهوية عامة تصلح لكل التخصصات
   ========================================================================= */

function renderCover(root, meta, id) {
  root.innerHTML = '';
  const sheet = makeSheet(id, { cover: true, wm: 'plain' });
  const f = sheet.flow;

  /* ترويسة الجهة: البيانات يمينًا واللوجو شمالًا */
  const top = el('div', 'cv-head');
  const org = el('div', 'org');
  org.innerHTML =
    `<div class="o1">${escHtml(id.org)}</div>` +
    `<div class="o2">${escHtml(id.dept1)}</div>` +
    `<div class="o3">${escHtml(id.dept2)}</div>`;
  const logo = el('div', 'logo');
  logo.innerHTML = id.logo ? `<img src="${id.logo}" alt="">` : defaultLogoSvg(id);
  top.appendChild(org); top.appendChild(logo);
  f.appendChild(top);

  /* العنوان الرئيسي */
  const hero = el('div', 'cv-hero');
  hero.innerHTML = '<div class="kicker">دفتر إعداد وتحضير مادة</div>';
  hero.appendChild(ed('div', 'cv-title', meta.subject || '—', null));
  hero.appendChild(el('div', 'rule'));
  hero.appendChild(ed('div', 'cv-grade', meta.grade || '', null));
  if (meta.dept) hero.appendChild(ed('div', 'cv-dept', meta.dept, null));
  f.appendChild(hero);

  /* بطاقات البيانات */
  const info = el('div', 'cv-info');
  const card = (icon, lab, val) => {
    const c = el('div', 'ci');
    c.innerHTML = `<div class="ico">${svgIcon(icon, 18)}</div>` +
      `<div class="tx"><span>${escHtml(lab)}</span></div>`;
    c.querySelector('.tx').appendChild(ed('b', '', val || '—', null));
    return c;
  };
  info.appendChild(card('clip', 'اسم المدرس', meta.teacher));
  info.appendChild(card('cal', 'العام الدراسي', meta.year));
  info.appendChild(card('unit', 'الفصل الدراسي', meta.term));
  f.appendChild(info);

  /* شريط ختامي */
  const foot = el('div', 'cv-foot');
  foot.innerHTML =
    `<div class="l"></div><div class="t">${escHtml(id.dept1)}</div><div class="l"></div>`;
  f.appendChild(foot);

  root.appendChild(sheet.page);
  return 1;
}

/* ===== js/app.js ===== */
/* =========================================================================
   app.js — منطق التطبيق
   ========================================================================= */
const LS = {
  key: 'thd.apiKey', model: 'thd.model', id: 'thd.identity',
  meta: 'thd.meta', pmeta: 'thd.pmeta', last: 'thd.last', review: 'thd.review',
  theme: 'thd.theme',
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

/* ستايل الورقة المختار — يُطبَّق على كل الأوراق المرسومة */
function currentTheme() {
  const t = store.get(LS.theme, THEME_DEFAULT);
  return SHEET_THEMES.some(x => x.id === t) ? t : THEME_DEFAULT;
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
  const hint = $('#metaHint');
  hint.placeholder = isPrac()
    ? 'مثال: التمرين يُنفّذ في مجموعتين، أو ركّز على القياس'
    : 'مثال: ركّز على التطبيق العملي، أو الدرس يُشرح في حصتين';
  /* التوجيه خاصّ بدرس واحد — لو بقي من الدرس السابق لوّث تحضير التالي */
  hint.value = '';
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
    /* تمريرة المراجعة: تصحّح الأرقام والقوانين مقابل الكتاب قبل بناء الورقة */
    let fixed = 0;
    if (store.get(LS.review, true)) {
      fixed = await reviewTahdeer({
        apiKey, model: currentModel(), pages: state.pages,
        data, prac: isPrac(), onProgress: m => busy(true, m)
      });
    }

    /* عنوان الخطة يغلب اجتهاد النموذج */
    if (meta.title) {
      if (isPrac()) data.topicTitle = meta.title; else data.lessonTitle = meta.title;
    }
    busy(true, 'جارٍ تجهيز الرسم التوضيحي وتنسيق الورقة…');
    const fg = resolveFigure(data.figure, state.pages, state.id);
    data.figure = fg.figure;
    data.figAlts = fg.alts;          /* البديلان محفوظان للتبديل من المعاينة */
    if (fg.why) console.info('صورة الكتاب رُفضت:', fg.why);
    state.data = data;
    await saveLesson();
    showResult();
    await draftClear();
    toast(fixed
      ? `تم التحضير وحفظه — وصُحِّح ${toArabicDigits(fixed)} ${fixed === 1 ? 'بند' : 'بنود'} في المراجعة`
      : (isPrac() ? 'تم إنشاء تحضير التدريب العملي وحفظه' : 'تم إنشاء التحضير وحفظه في المادة'));
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

/* يُنادى عند تبديل مصدر الرسم من المعاينة */
function onFigureChange() {
  saveLesson();
  showResult();
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

/* الورق كله A4 طولي — قاعدة @page واحدة في paper.css.
   السبب: متصفّح الموبايل يفرض مقاس ورق واحدًا على الملف كله ولا يحترم
   الصفحات المسمّاة، فكانت ورقة الخطة العرضية تُقصّ داخل ملف الترم. */

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

/* =========================================================================
   ملء بيانات التحضير من الخطة الزمنية
   الدرس رقم n يقع في الأسبوع رقم n من **أسابيع الدراسة** — أي بعد تخطّي
   الأسابيع المعلَّمة «بلا دروس» (التعريفي والامتحانات والأجازات). فيأخذ منها
   رقم الأسبوع وتاريخ سبته والوحدة، ويقترح عنوان الدرس المكتوب في الخطة.
   ========================================================================= */
async function fillFromPlan(sub, doneCount) {
  const doc = await DB.doc('plan', sub.id);
  if (!doc || !doc.payload) return;

  const pm = doc.payload.meta || {};
  const weeks = planTeachingWeeks({ meta: pm, rows: doc.payload.rows || [] });
  if (!weeks.length) return;

  const w = weeks[Math.min(doneCount, weeks.length - 1)];
  /* لا نطمس ما كتبه المدرّس بيده */
  const set = (k, v) => { const e = $('#m_' + k); if (e && v && !e.value) e.value = v; };

  set('week',    toArabicDigits(w.weekNo));
  set('unit',    w.unit);
  set('subject', pm.subject);
  set('grade',   pm.grade);
  set('dept',    pm.dept);              /* التخصص */
  set('teacher', pm.teacher);
  set('title',   w.titles[0] || '');    /* اسم الدرس كما في الخطة */
  
  if (w.isoDate) { const e = $('#m_date'); if (e) e.value = w.isoDate; }

  const title = w.titles[0] || '';
  const desc = (w.descs && w.descs[0]) || '';
  const hint = $('#metaHint');
  if (desc && hint && !hint.value) hint.value = 'وصف الخطة: ' + desc;

  const rest = weeks.length - doneCount - 1;
  const what = (state.mode === 'prac') ? 'الموضوع' : 'الدرس';
  setStatus(title
    ? `${what} ${toArabicDigits(w.weekNo)} — الأسبوع ${toArabicDigits(w.weekNo)} حسب الخطة: «${title}»` +
      (rest > 0 ? ` · باقي ${toArabicDigits(rest)} أسبوع دراسة` : ' · آخر أسبوع في الخطة')
    : `الأسبوع ${toArabicDigits(w.weekNo)} حسب الخطة`);
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
    /* جديد: البيانات تُملأ من الخطة الزمنية لتتماشى معها */
    const ls = (await DB.lessons(sub.id)).filter(l => (l.kind || 'prep') === mode);
    const nextNo = ls.reduce((m, l) => Math.max(m, parseInt(l.lessonNo, 10) || 0), 0) + 1;
    if ($('#m_lessonNo') && !$('#m_lessonNo').value) $('#m_lessonNo').value = nextNo;
    state.data = null; state.files = []; renderFiles();
    setStatus('');
    await fillFromPlan(sub, ls.length);
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
  $('#setReview').checked = store.get(LS.review, true);
  buildThemePicker();
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
  const lastTxt = Backup.lastAt ? ' — آخر نسخة ' + new Date(Backup.lastAt).toLocaleString('ar-EG') : '';
  const bkTxt = {
    ready: '<b class="g">مُفعَّل ✓</b>' + lastTxt,
    armed: '<b class="g">مُفعَّل ✓</b>' + lastTxt +
      ' — يُطلب تأكيد الإذن عند أول حفظ في كل جلسة ما لم يكن التطبيق مثبَّتًا',
    needPermission: '<b class="w">ينتظر تأكيد الإذن</b>',
    error: '<b class="r">تعذّر الكتابة</b> — ' + escHtml(Backup.lastError || ''),
    unsupported: '<b class="w">غير مدعوم</b> — استخدم التصدير اليدوي',
    off: '<b class="w">غير مُفعَّل</b> — شغلك على هذا الجهاز فقط'
  }[Backup.status] || '';

  b.innerHTML =
    `<div class="sr"><span>التخزين الدائم</span><div>${persistTxt}</div></div>` +
    `<div class="sr"><span>نسخة احتياطية تلقائية</span><div>${bkTxt}</div></div>` +
    ((Backup.status === 'armed' || Backup.status === 'needPermission') && Persist.state !== 'granted'
      ? '<div class="sr tip"><span></span><div>المتصفّح لا يحفظ إذن المجلد بين الجلسات إلا للتطبيق ' +
        '<b>المثبَّت على الشاشة الرئيسية</b> — ثبّته ليختفي طلب التأكيد نهائيًا.</div></div>' : '') +
    (u ? `<div class="sr"><span>المستخدم من مساحة الجهاز</span><div><b>${mb(u.used)}</b>${u.quota ? ' من ' + mb(u.quota) : ''}</div></div>` : '');

  const row = el('div', 'store-btns');
  const mk = (label, cls, fn) => { const x = el('button', cls, label); x.onclick = fn; return x; };
  if (Backup.status === 'ready' || Backup.status === 'armed') {
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
  store.set(LS.review, $('#setReview').checked);
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

async function doWord() {
  busy(true, 'جارٍ تجهيز ملف Word…');
  try {
    const blob = (state.mode === 'plan') ? await buildPlanDocx(plan, state.id)
      : (state.mode === 'prac') ? await buildPracDocx(state.data, state.meta, state.id)
      : await buildDocx(state.data, state.meta, state.id);
    download(blob, fileBase() + '.docx');
    toast('تم تنزيل ملف Word');
  } catch (e) {
    console.error(e); toast('تعذّر إنشاء ملف Word: ' + ((e && e.message) || e), true);
  } finally { busy(false); }
}

/* ---------------- اختيار شكل الورقة ---------------- */
function themeSwatch(t) {
  const on = (t.id === currentTheme());
  const c = el('button', 'thm' + (on ? ' on' : ''));
  c.type = 'button';
  c.innerHTML =
    `<span class="thm-pv ${t.cls || 't-official'}">
       <i class="b1"></i><i class="hd"></i><i class="r1"></i><i class="r2"></i>
       <i class="p1"></i><i class="p2"></i><i class="b2"></i>
     </span>
     <b>${escHtml(t.name)}</b><em>${escHtml(t.desc)}</em>`;
  c.onclick = () => {
    store.set(LS.theme, t.id);
    buildThemePicker();
    /* معاينة حيّة: نعيد رسم ما هو معروض الآن */
    if (state.data && Lib.screen === 'work') showResult();
    else if (Lib.screen === 'work' && state.mode === 'plan') makePlan();
    else if (Lib.screen === 'work' && state.mode === 'cover') makeCover();
    toast('شكل الورقة: ' + t.name);
  };
  return c;
}

function buildThemePicker() {
  const g = $('#themeGrid');
  if (!g) return;
  g.innerHTML = '';
  SHEET_THEMES.forEach(t => g.appendChild(themeSwatch(t)));
}

/* =========================================================================
   تحديث التطبيق — إشعار للمدرّس بدل تحديث صامت

   عامل الخدمة الجديد ينتظر (لا skipWaiting في install)، فنُظهر شريطًا
   ونفعّله بضغطة. بدون هذا يظلّ المدرّس على نسخة قديمة حتى يقفل التطبيق
   ثلاث مرات، أو يتبدّل التطبيق تحت يده وهو يحضّر درسًا.
   ========================================================================= */
const UPD_FLAG = 'thd.justUpdated';
let _waitingSW = null;

function showUpdateBar(sw) {
  _waitingSW = sw;
  const bar = $('#updBar');
  if (bar) bar.hidden = false;
}

function setupUpdates() {
  /* رسالة النجاح بعد إعادة التحميل */
  try {
    if (sessionStorage.getItem(UPD_FLAG)) {
      sessionStorage.removeItem(UPD_FLAG);
      setTimeout(() => toast('تم التحديث بنجاح · تحيات Mohamed_Eldawly'), 900);
    }
  } catch (_) {}

  $('#btnUpdLater').onclick = () => { $('#updBar').hidden = true; };
  $('#btnUpdate').onclick = () => {
    if (!_waitingSW) return location.reload();
    try { sessionStorage.setItem(UPD_FLAG, '1'); } catch (_) {}
    $('#updBar').hidden = true;
    busy(true, 'جارٍ تحميل التحديث…');
    _waitingSW.postMessage({ type: 'SKIP_WAITING' });
    /* لو لم يصل controllerchange لأي سبب، نعيد التحميل بأنفسنا */
    setTimeout(() => location.reload(), 2500);
  };

  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('sw.js').then(reg => {
    /* نسخة جاهزة ومنتظرة من جلسة سابقة */
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        /* controller موجود = ليست أول زيارة، إذن هذا تحديث لا تثبيت */
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(sw);
      });
    });

    /* نسأل عن تحديث عند الفتح وكل ربع ساعة وعند العودة للتطبيق */
    const check = () => reg.update().catch(() => {});
    setTimeout(check, 3000);
    setInterval(check, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }).catch(() => {});

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
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

  setupUpdates();

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
