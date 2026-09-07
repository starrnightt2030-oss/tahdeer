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
const Backup = {
  dir: null,
  status: 'off',        /* off | ready | needPermission | error | unsupported */
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
      Backup.status = (p === 'granted') ? 'ready' : 'needPermission';
    } catch (_) { Backup.status = 'needPermission'; }
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
    Backup.dir = null; Backup.status = 'off';
    await DB.set('backupDir', null);
  },

  async run(force) {
    if (!Backup.dir) return false;
    try {
      const p = await Backup.dir.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') { Backup.status = 'needPermission'; return false; }
      const fh = await Backup.dir.getFileHandle(BACKUP_FILE, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(await DB.exportAll()));
      await w.close();
      Backup.status = 'ready';
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
