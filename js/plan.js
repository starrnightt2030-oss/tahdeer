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
  while (plan.rows.length < n) plan.rows.push({ unit: '', notes: '', items: [{ name: '', desc: '' }] });
  if (plan.rows.length > n) plan.rows.length = n;
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
      landscape: true, wm: 'circuit',
      title: 'الخطة الزمنية — ' + (meta.subject || ''),
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
