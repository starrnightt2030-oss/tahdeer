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
  const fig = (data.figures && data.figures[0]) || null;
  const kindLabel = (data.practKind === 'operation')
    ? 'رسم العملية / العدة والأدوات' : 'شكل التمرين المطلوب تنفيذه';

  const cap = el('div', 'dcap');
  cap.appendChild(ed('span', '', (fig && fig.caption) || data.drawing || kindLabel, 'drawing'));
  box.appendChild(cap);

  const inner = el('div', 'dbody');
  if (fig && fig.src) {
    inner.innerHTML = `<img src="${fig.src}" alt="">`;
  } else if (data.drawSvg) {
    inner.innerHTML = data.drawSvg;             /* رسم تخطيطي بديل */
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
