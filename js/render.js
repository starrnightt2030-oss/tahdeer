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
class Pager {
  constructor(root, meta, id, data) {
    this.root = root; this.meta = meta; this.id = id; this.data = data;
    this.pages = [];
    root.innerHTML = '';
    this.newPage();
  }

  newPage() {
    const id = this.id, meta = this.meta, data = this.data;
    const page = el('div', 'page');

    /* الشريط العلوي */
    const top = el('div', 'pg-top');
    top.innerHTML =
      '<i class="slash s1"></i><i class="slash s2"></i><i class="slash s3"></i><i class="slash s4"></i>' +
      `<div class="ribbon"><span class="brace">{</span><b>${escHtml(id.ribbon)}</b><span class="brace">}</span></div>`;
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
      `<h1>تحضير الدرس ${escHtml(lessonOrdinal(meta.lessonNo || 1))}</h1>` +
      `<div class="pgno" data-pgno></div>`;
    const org = el('div', 'org');
    org.innerHTML =
      `<div class="o1">${escHtml(id.org)}</div>` +
      `<div class="o2">${escHtml(id.dept1)}</div>` +
      `<div class="o3">${escHtml(id.dept2)}</div>`;
    head.appendChild(logo); head.appendChild(titles); head.appendChild(org);
    main.appendChild(head);

    /* عنوان الدرس */
    const lt = el('div', 'lesson-title');
    lt.innerHTML = 'عنوان الدرس: ';
    lt.appendChild(ed('span', '', data.lessonTitle || '—', 'lessonTitle'));
    main.appendChild(lt);

    /* شريط المعلومات */
    main.appendChild(this.strip());
    /* صفوف المادة/الصف/القسم */
    main.appendChild(this.rows());

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

    STRIP_FIELDS.filter(k => k !== 'date').forEach(k => {
      const f = META_FIELDS.find(x => x.key === k);
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
    ROW_FIELDS.forEach(k => {
      const f = META_FIELDS.find(x => x.key === k);
      const line = el('div', 'rowline');
      line.innerHTML =
        `<div class="tag"><span>${escHtml(f.label)}</span>${svgIcon(ROW_ICONS[k] || 'book', 15, 'ic')}</div>`;
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

  finish() {
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
    const d = el('div', 'g', `<b>${escHtml(g.label)}:</b>`);
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
    if (numbered) li.appendChild(el('span', 'num', toArabicDigits(i + 1)));
    li.appendChild(el('span', 'box'));
    li.appendChild(ed('span', 'tx', t, path ? `${path}.${i}` : null));
    ul.appendChild(li);
  });
  return ul;
}

function qaNode(val, path) {
  const box = el('div', 'qa');
  const qs = (val && val.questions) || [];
  (qs.length ? qs : [{ label: 'سؤال', question: '—' }]).forEach((q, i) => {
    const d = el('div', 'q');
    d.appendChild(ed('div', 'lab', (q.label || 'سؤال') + ':', `${path}.questions.${i}.label`));
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
  tr.appendChild(el('th', '', 'م'));
  cols.forEach(c => tr.appendChild(el('th', '', bidiHtml(c))));
  tr.appendChild(el('th', '', 'الإجابة'));
  thead.appendChild(tr); t.appendChild(thead);
  const tb = el('tbody');
  (rows.length ? rows : [['—']]).forEach((r, i) => {
    const row = el('tr');
    row.appendChild(el('td', '', toArabicDigits(i + 1)));
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
  d.appendChild(el('span', 'n', toArabicDigits(idx + 1)));
  const c = el('div', 'ic-body');
  if (it.heading) c.appendChild(ed('h4', '', it.heading, `${path}.heading`));
  if (it.body)    c.appendChild(ed('p', '', it.body, `${path}.body`));
  if (it.bullets && it.bullets.length) c.appendChild(listNode(it.bullets, `${path}.bullets`));
  if (it.table && it.table.columns)    c.appendChild(tableNode(it.table, `${path}.table`));
  d.appendChild(c);
  return d;
}

function figureNode(fig, i) {
  const b = el('div', 'figbox');
  b.innerHTML = `<div class="fh">${escHtml((fig && fig.caption) || 'الرسم التوضيحي')}</div>`;
  const fi = el('div', 'fi' + (fig && fig.src ? '' : ' empty'));
  if (fig && fig.src) fi.innerHTML = `<img src="${fig.src}" alt="">`;
  else fi.textContent = 'مساحة الرسم التوضيحي';
  b.appendChild(fi);
  return b;
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
function flowItems(pg, sec, items, data) {
  let idx = 0, firstPanel = true, guard = 0;

  while (idx < items.length && guard++ < 200) {
    const p = panel(sec, null, { label: firstPanel ? sec.label : sec.contLabel });
    const inner = el('div', 'items');
    p._body.appendChild(inner);

    /* الشكل التوضيحي يوضع في أول لوحة */
    if (firstPanel && data.figures && data.figures[0]) {
      p._body.insertBefore(figureNode(data.figures[0], 0), inner);
    }
    pg.push(p);

    let added = 0;
    while (idx < items.length) {
      const node = itemNode(items[idx], idx, `content.${idx}`);
      if (pg.pushInto(inner, node)) { idx++; added++; }
      else break;
    }

    if (added === 0) {
      p.remove();
      if (pg.flow.children.length === 0) {
        /* لا يتسع حتى في صفحة فارغة — نضعه قسرًا لتجنّب حلقة لا نهائية */
        pg.flow.appendChild(p);
        inner.appendChild(itemNode(items[idx], idx, `content.${idx}`));
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

  /* --- التوقيعات (تُضاف إن اتسعت الصفحة) --- */
  const sg = el('div', 'signs');
  SIGNATURES.forEach(s => {
    const b = el('div', 's');
    b.innerHTML = `<b>${escHtml(s)}</b><i></i>`;
    sg.appendChild(b);
  });
  const before = pg.pages.length;
  pg.flow.appendChild(sg);
  if (pg.overflowing()) pg.flow.removeChild(sg);   /* لا نفتح صفحة جديدة لأجل التوقيعات فقط */

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
