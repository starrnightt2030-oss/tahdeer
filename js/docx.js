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
  const body = Array.isArray(content) ? content.join('') : content;
  return `<w:tc><w:tcPr>${w}${span}${shd}${mar}${va}</w:tcPr>${body || wPara('')}</w:tc>`;
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

function dataTable(columns, rows, navy, extraCol) {
  const cols = extraCol ? columns.concat([extraCol]) : columns;
  const first = 600;
  const rest = Math.floor((CONTENT_W - first) / cols.length);
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
  return wTable([hr, ...body], { grid, ltr: CONTENT_LTR });
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

/* ---------- المستند ---------- */
function buildDocumentXml(data, meta, id) {
  const navy = id.navy, red = id.red;
  let b = '';

  /* الهوية */
  b += wTable([
    `<w:tr>${wCell([
      wPara(id.org, { b: true, size: 13, color: navy, align: 'center', after: 0 }),
      wPara(id.dept1, { b: true, size: 10.5, color: red, align: 'center', before: 0, after: 0 }),
      wPara(id.dept2, { size: 10, color: navy, align: 'center', before: 0 })
    ], { w: CONTENT_W })}</w:tr>`,
    `<w:tr>${wCell([
      wPara('تحضير الدرس ' + lessonOrdinal(meta.lessonNo || 1), { b: true, size: 15, color: '#FFFFFF', align: 'center', after: 0 }),
      wPara('عنوان الدرس: ' + (data.lessonTitle || ''), { b: true, size: 11.5, color: '#FFFFFF', align: 'center', before: 0 })
    ], { w: CONTENT_W, shade: navy })}</w:tr>`
  ], { border: navy, grid: [CONTENT_W] }) + gap();

  /* البيانات */
  b += head('البيانات الأساسية', navy);
  const pairs = [];
  META_FIELDS.filter(f => !f.noPrint)
    .forEach(f => pairs.push([f.label, f.key === 'date' ? (meta.dateText || meta.date || '') : (meta[f.key] || '')]));
  const cw = Math.floor(CONTENT_W / 6), vw = Math.floor(CONTENT_W / 3) - cw;
  const rows = [];
  for (let i = 0; i < pairs.length; i += 3) {
    let r = '';
    for (let j = 0; j < 3; j++) {
      const p = pairs[i + j] || ['', ''];
      r += wCell(wPara(p[0], { b: true, size: 9.5, color: navy }), { w: cw, shade: '#EDF1F9' }) +
           wCell(wPara(p[1], { size: 9.5 }), { w: vw });
    }
    rows.push(r);
  }
  b += wTable(rows, { grid: [cw, vw, cw, vw, cw, vw] }) + gap();

  /* الأهداف */
  const objSec = SECTIONS.find(s => s.key === 'objectives');
  if (data.objectives) {
    const inner = [];
    (objSec.groups || []).forEach(g => {
      const it = (data.objectives[g.key] || []).filter(Boolean);
      if (!it.length) return;
      inner.push(cPara(OBJ_LABEL[CONTENT_LTR ? 'en' : 'ar'][g.key] || g.label, { b: true, color: red, size: 10.5, before: 40 }));
      inner.push(...bullets(it));
    });
    b += head(objSec.label, navy) + box(inner.length ? inner : [cPara('—')]) + gap();
  }

  /* الثلاثي */
  [['prerequisites', 'المتطلبات السابقة'], ['resources', 'الوسائل والمعينات'], ['strategies', 'استراتيجيات التدريس']]
    .forEach(([k, l]) => { if (data[k] && data[k].length) b += head(l, navy) + box(bullets(data[k])) + gap(70); });

  /* التمهيد */
  if (data.warmup) b += head('التمهيد والتهيئة', navy) + box([cPara(data.warmup)]) + gap();

  /* عرض الدرس */
  b += head('عرض الدرس / خطوات سير الدرس', navy) + box(contentItems(data.content, navy, red)) + gap();

  /* تدريبات */
  if (data.drills && data.drills.rows && data.drills.rows.length) {
    const inner = [];
    if (data.drills.instruction) inner.push(cPara(data.drills.instruction, { b: true, size: 10 }));
    inner.push(dataTable(data.drills.columns || ['المطلوب'], data.drills.rows, navy, CONTENT_LTR ? 'Answer' : 'الإجابة'));
    b += head('تدريبات سريعة', navy) + box(inner) + gap();
  }

  /* أنشطة */
  if (data.activities && data.activities.length)
    b += head('أنشطة صفية', navy) + box(data.activities.map(t => cPara('☐  ' + t, { ind: 110 }))) + gap(70);

  /* التقويم */
  if (data.assessment && data.assessment.questions && data.assessment.questions.length) {
    const inner = [];
    data.assessment.questions.forEach(q => {
      inner.push(cPara((q.label || (CONTENT_LTR ? 'Question' : 'سؤال')) + ':', { b: true, color: red, size: 10.5, before: 40, after: 0 }));
      inner.push(cPara(q.question || '', { ind: 110, after: 0 }));
      inner.push(cPara((CONTENT_LTR ? 'Answer: ' : 'الإجابة: ') + '.'.repeat(70), { size: 9.5, color: '#8A97B4', ind: 110 }));
    });
    b += head('التقويم', navy) + box(inner) + gap();
  }

  /* تنبيه */
  if (data.warning)
    b += wTable([`<w:tr>${wCell([
      wPara('تنبيه', { b: true, color: red, align: 'center', size: 11, after: 0 }),
      cPara(data.warning, { align: 'center', b: true })
    ], { w: CONTENT_W, shade: '#FDF2F3' })}</w:tr>`], { border: red, grid: [CONTENT_W] }) + gap();

  /* الواجب */
  if (data.homework && data.homework.length)
    b += head('الواجب المنزلي', navy) +
      box(data.homework.map((t, i) => cPara((CONTENT_LTR ? String(i + 1) : toArabicDigits(i + 1)) + ')  ' + t, { ind: 110 }))) + gap(70);

  /* ملاحظات المعلم */
  b += head('ملاحظات المعلم', navy) +
    box([1, 2, 3, 4].map(() => wPara('.'.repeat(95), { size: 9.5, color: '#8A97B4' }))) + gap();

  /* التوقيعات */
  const sw = Math.floor(CONTENT_W / SIGNATURES.length);
  b += wTable([
    '<w:tr>' + SIGNATURES.map(sig => wCell(wPara(sig.label,
      { b: true, align: 'center', size: 9.5, color: navy }), { w: sw, shade: '#EDF1F9' })).join('') + '</w:tr>',
    '<w:tr>' + SIGNATURES.map(sig => wCell([
      wPara(sig.nameFrom ? (meta[sig.nameFrom] || '') : '', { align: 'center', size: 9.5, b: true, after: 0 }),
      wPara(''), wPara('')
    ], { w: sw, vAlign: 'top' })).join('') + '</w:tr>'
  ], { grid: SIGNATURES.map(() => sw) });

  const sect = '<w:sectPr>' +
    '<w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/>' +
    `<w:pgSz w:w="${TW.pageW}" w:h="${TW.pageH}"/>` +
    `<w:pgMar w:top="1000" w:right="${TW.marg}" w:bottom="900" w:left="${TW.marg}" w:header="420" w:footer="380"/>` +
    '<w:bidi/></w:sectPr>';

  return xmlHead('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${b}${sect}</w:body></w:document>`);
}

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
  const fld = (f) => '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
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

function buildDocx(data, meta, id) {
  id = id || IDENTITY_DEFAULT;
  CONTENT_LTR = (data && data.contentLang === 'en');
  const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const files = [
    { name: '[Content_Types].xml', data: xmlHead(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>` +
      `<Override PartName="/word/header1.xml" ContentType="${CT}.header+xml"/>` +
      `<Override PartName="/word/footer1.xml" ContentType="${CT}.footer+xml"/>` +
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
      '</Relationships>') },
    { name: 'word/document.xml', data: buildDocumentXml(data, meta, id) },
    { name: 'word/styles.xml',   data: STYLES_XML },
    { name: 'word/settings.xml', data: SETTINGS_XML },
    { name: 'word/header1.xml',  data: headerXml(id) },
    { name: 'word/footer1.xml',  data: footerXml(id) }
  ];
  return makeZip(files, CT + '.document');
}

/* =========================================================================
   الخطة الزمنية — ملف Word عرضي (A4 landscape)
   ========================================================================= */
const TW_L = { pageW: 16838, pageH: 11906, marg: 680 };
const PLAN_W = TW_L.pageW - TW_L.marg * 2;

function buildPlanDocumentXml(p, id) {
  const navy = id.navy, red = id.red, meta = p.meta;
  const total = PLAN_COLUMNS.reduce((a, c) => a + c.w, 0);
  const grid = PLAN_COLUMNS.map(c => Math.round(PLAN_W * c.w / total));
  let b = '';

  /* الهوية */
  b += wTable([
    `<w:tr>${wCell([
      wPara(id.org, { b: true, size: 13, color: navy, align: 'center', after: 0 }),
      wPara(id.dept1, { b: true, size: 10.5, color: red, align: 'center', before: 0, after: 0 }),
      wPara(id.dept2, { size: 10, color: navy, align: 'center', before: 0 })
    ], { w: PLAN_W })}</w:tr>`,
    `<w:tr>${wCell([
      wPara('الخطة الزمنية — ' + (meta.subject || ''), { b: true, size: 15, color: '#FFFFFF', align: 'center', after: 0 }),
      wPara((meta.term || '') + '   ·   العام الدراسي ' + (meta.year || ''),
        { b: true, size: 11, color: '#FFFFFF', align: 'center', before: 0 })
    ], { w: PLAN_W, shade: navy })}</w:tr>`
  ], { border: navy, grid: [PLAN_W], w: PLAN_W }) + gap();

  /* شريط البيانات */
  const info = [['المادة', meta.subject], ['الصف', meta.grade], ['القسم', meta.dept],
                ['العام الدراسي', meta.year], ['الفصل الدراسي', meta.term], ['المدرس', meta.teacher]];
  const cw = Math.floor(PLAN_W / 12), vw = Math.floor(PLAN_W / 6) - cw;
  let ir = '';
  info.forEach(x => {
    ir += wCell(wPara(x[0], { b: true, size: 9, color: navy }), { w: cw, shade: '#EDF1F9' }) +
          wCell(wPara(x[1] || '—', { size: 9 }), { w: vw });
  });
  b += wTable([ir], { grid: [cw, vw, cw, vw, cw, vw, cw, vw, cw, vw, cw, vw], w: PLAN_W }) + gap();

  /* الجدول */
  const hr = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + PLAN_COLUMNS.map((c, k) =>
    wCell(wPara(c.label, { b: true, color: '#FFFFFF', align: 'center', size: 9.5 }),
      { w: grid[k], shade: navy })).join('') + '</w:tr>';

  const rows = p.rows.map((r, i) => {
    const items = (r.items || []).filter(x => (x.name || '').trim() || (x.desc || '').trim());
    const inner = items.length ? [] : [wPara('')];
    items.forEach(it => {
      if (it.name) inner.push(wPara(it.name, { b: true, color: navy, size: 9.5, after: 0 }));
      if (it.desc) inner.push(wPara(it.desc, { size: 9, before: 0 }));
    });
    const shade = i % 2 ? '#F3F6FC' : null;
    const byKey = {
      no:    () => wCell(wPara(toArabicDigits(i + 1), { align: 'center', size: 9.5, b: true }), { w: 0, shade }),
      week:  () => wCell(wPara(weekName(i + 1), { align: 'center', size: 9.5, b: true }), { w: 0, shade }),
      date:  () => wCell(wPara(weekSaturday(meta.startDate, i + 1), { align: 'center', size: 9.5 }), { w: 0, shade }),
      unit:  () => wCell(wPara(r.unit || '', { align: 'center', size: 9.5 }), { w: 0, shade }),
      items: () => wCell(inner, { w: 0, shade, vAlign: 'top' }),
      notes: () => wCell(wPara(r.notes || '', { size: 9 }), { w: 0, shade, vAlign: 'top' })
    };
    return '<w:tr>' + PLAN_COLUMNS.map((c, k) => {
      const cell = byKey[c.key]();
      return cell.replace('<w:tcW w:w="0" w:type="auto"/>', `<w:tcW w:w="${grid[k]}" w:type="dxa"/>`);
    }).join('') + '</w:tr>';
  });
  b += wTable([hr, ...rows], { grid, w: PLAN_W }) + gap(180);

  /* التوقيعات الخمسة */
  const sw = Math.floor(PLAN_W / PLAN_SIGNATURES.length);
  b += wTable([
    '<w:tr>' + PLAN_SIGNATURES.map(sig => wCell(wPara(sig.label,
      { b: true, align: 'center', size: 9, color: navy }), { w: sw, shade: '#EDF1F9' })).join('') + '</w:tr>',
    '<w:tr>' + PLAN_SIGNATURES.map(sig => wCell([
      wPara(sig.nameFrom ? (meta[sig.nameFrom] || '') : '', { align: 'center', size: 9, b: true, after: 0 }),
      wPara(''), wPara('')
    ], { w: sw, vAlign: 'top' })).join('') + '</w:tr>'
  ], { grid: PLAN_SIGNATURES.map(() => sw), w: PLAN_W });

  const sect = '<w:sectPr>' +
    `<w:pgSz w:w="${TW_L.pageW}" w:h="${TW_L.pageH}" w:orient="landscape"/>` +
    `<w:pgMar w:top="${TW_L.marg}" w:right="${TW_L.marg}" w:bottom="${TW_L.marg}" w:left="${TW_L.marg}" w:header="400" w:footer="360"/>` +
    '<w:bidi/></w:sectPr>';

  return xmlHead('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${b}${sect}</w:body></w:document>`);
}

function buildPlanDocx(p, id) {
  id = id || IDENTITY_DEFAULT;
  CONTENT_LTR = false;
  const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const files = [
    { name: '[Content_Types].xml', data: xmlHead(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>` +
      '</Types>') },
    { name: '_rels/.rels', data: xmlHead(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>') },
    { name: 'word/_rels/document.xml.rels', data: xmlHead(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      '</Relationships>') },
    { name: 'word/document.xml', data: buildPlanDocumentXml(p, id) },
    { name: 'word/styles.xml',   data: STYLES_XML },
    { name: 'word/settings.xml', data: SETTINGS_XML }
  ];
  return makeZip(files, CT + '.document');
}

/* =========================================================================
   تحضير التدريب العملي — ملف Word (F-PR-03)
   ========================================================================= */
function buildPracDocumentXml(data, meta, id) {
  const navy = id.navy, red = id.red;
  let b = '';

  /* الهوية */
  b += wTable([
    `<w:tr>${wCell([
      wPara(id.org, { b: true, size: 13, color: navy, align: 'center', after: 0 }),
      wPara(id.dept1, { b: true, size: 10.5, color: red, align: 'center', before: 0, after: 0 }),
      wPara(id.dept2, { size: 10, color: navy, align: 'center', before: 0 })
    ], { w: CONTENT_W })}</w:tr>`,
    `<w:tr>${wCell([
      wPara('تحضير الموضوع ' + lessonOrdinal(meta.lessonNo || 1) + ' — تدريب عملي',
        { b: true, size: 15, color: '#FFFFFF', align: 'center', after: 0 }),
      wPara('اسم الموضوع: ' + (data.topicTitle || ''),
        { b: true, size: 11.5, color: '#FFFFFF', align: 'center', before: 0 })
    ], { w: CONTENT_W, shade: navy })}</w:tr>`
  ], { border: navy, grid: [CONTENT_W] }) + gap();

  /* البيانات الأساسية */
  b += head('البيانات الأساسية', navy);
  const pairs = [];
  PRAC_FIELDS.filter(f => !f.noPrint).forEach(f => pairs.push([f.label,
    f.key === 'date' ? (meta.dateText || meta.date || '') : (meta[f.key] || '')]));
  const cw = Math.floor(CONTENT_W / 6), vw = Math.floor(CONTENT_W / 3) - cw;
  const rows = [];
  for (let i = 0; i < pairs.length; i += 3) {
    let r = '';
    for (let j = 0; j < 3; j++) {
      const p = pairs[i + j] || ['', ''];
      r += wCell(wPara(p[0], { b: true, size: 9.5, color: navy }), { w: cw, shade: '#EDF1F9' }) +
           wCell(wPara(p[1], { size: 9.5 }), { w: vw });
    }
    rows.push(r);
  }
  b += wTable(rows, { grid: [cw, vw, cw, vw, cw, vw] }) + gap();

  /* الغرض · العناصر · الخامات */
  [['purpose', 'الغرض من الموضوع'], ['elements', 'عناصر الموضوع'], ['materials', 'الخامات المطلوبة']]
    .forEach(([k, l]) => { if (data[k] && data[k].length) b += head(l, navy) + box(bullets(data[k])) + gap(70); });

  /* العدد والأدوات — عمودان مرقّمان */
  if (data.tools && data.tools.length) {
    const list = data.tools, half = Math.ceil(list.length / 2);
    const nw = Math.floor(CONTENT_W * 0.08), tw = Math.floor(CONTENT_W * 0.42);
    const hr = '<w:tr>' +
      wCell(wPara('م', { b: true, size: 9.5, color: '#FFFFFF', align: 'center' }), { w: nw, shade: navy }) +
      wCell(wPara('العدة / الأداة', { b: true, size: 9.5, color: '#FFFFFF', align: 'center' }), { w: tw, shade: navy }) +
      wCell(wPara('م', { b: true, size: 9.5, color: '#FFFFFF', align: 'center' }), { w: nw, shade: navy }) +
      wCell(wPara('العدة / الأداة', { b: true, size: 9.5, color: '#FFFFFF', align: 'center' }), { w: tw, shade: navy }) +
      '</w:tr>';
    const trs = [hr];
    for (let i = 0; i < half; i++) {
      const j = i + half;
      trs.push('<w:tr>' +
        wCell(wPara(toArabicDigits(i + 1), { size: 9.5, align: 'center' }), { w: nw, shade: '#F5F8FD' }) +
        wCell(cPara(list[i] || '', { size: 9.5 }), { w: tw }) +
        wCell(wPara(j < list.length ? toArabicDigits(j + 1) : '', { size: 9.5, align: 'center' }), { w: nw, shade: '#F5F8FD' }) +
        wCell(cPara(list[j] || '', { size: 9.5 }), { w: tw }) +
        '</w:tr>');
    }
    b += head('العدد والأدوات اللازمة', navy) +
      wTable(trs, { border: navy, grid: [nw, tw, nw, tw] }) + gap();
  }

  /* رسم التمرين — إطار للرسم اليدوي، وتحته وصف ما يجب أن يظهر */
  const drawTitle = (data.practKind === 'operation') ? 'رسم العملية / العدة والأدوات' : 'رسم التمرين';
  const dInner = [];
  if (data.drawing) dInner.push(cPara(data.drawing, { size: 9.5, b: true, color: navy }));
  for (let i = 0; i < 10; i++) dInner.push(wPara('', { size: 11 }));
  b += head(drawTitle, navy) + box(dInner) + gap();

  /* طريقة تنفيذ التمرين */
  if (data.steps && data.steps.length)
    b += head('طريقة تنفيذ التمرين', navy) + box(contentItems(data.steps, navy, red)) + gap();

  /* الأمن الصناعي */
  if (data.safety && data.safety.length)
    b += wTable([`<w:tr>${wCell(
      [wPara('قواعد الأمن الصناعي', { b: true, color: red, align: 'center', size: 11, after: 0 })]
        .concat(bullets(data.safety)),
      { w: CONTENT_W, shade: '#FDF2F3' })}</w:tr>`], { border: red, grid: [CONTENT_W] }) + gap();

  /* مهمات الوقاية الشخصية */
  if (data.ppe && data.ppe.length)
    b += head('مهمات الوقاية الشخصية', navy) +
      box(data.ppe.map(t => cPara('☐  ' + t, { ind: 110 }))) + gap(70);

  /* ملاحظات المدرب */
  b += head('ملاحظات المدرب', navy) +
    box([1, 2, 3, 4].map(() => wPara('.'.repeat(95), { size: 9.5, color: '#8A97B4' }))) + gap();

  /* التوقيعات */
  const sw = Math.floor(CONTENT_W / PRAC_SIGNATURES.length);
  b += wTable([
    '<w:tr>' + PRAC_SIGNATURES.map(sig => wCell(wPara(sig.label,
      { b: true, align: 'center', size: 9.5, color: navy }), { w: sw, shade: '#EDF1F9' })).join('') + '</w:tr>',
    '<w:tr>' + PRAC_SIGNATURES.map(sig => wCell([
      wPara(sig.nameFrom ? (meta[sig.nameFrom] || '') : '', { align: 'center', size: 9.5, b: true, after: 0 }),
      wPara(''), wPara('')
    ], { w: sw, vAlign: 'top' })).join('') + '</w:tr>'
  ], { grid: PRAC_SIGNATURES.map(() => sw) });

  const sect = '<w:sectPr>' +
    '<w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/>' +
    `<w:pgSz w:w="${TW.pageW}" w:h="${TW.pageH}"/>` +
    `<w:pgMar w:top="1000" w:right="${TW.marg}" w:bottom="900" w:left="${TW.marg}" w:header="420" w:footer="380"/>` +
    '<w:bidi/></w:sectPr>';

  return xmlHead('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${b}${sect}</w:body></w:document>`);
}

function buildPracDocx(data, meta, id) {
  const pid = Object.assign({}, id || IDENTITY_DEFAULT, IDENTITY_PRAC);
  CONTENT_LTR = (data && data.contentLang === 'en');
  const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const files = [
    { name: '[Content_Types].xml', data: xmlHead(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
      `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>` +
      `<Override PartName="/word/header1.xml" ContentType="${CT}.header+xml"/>` +
      `<Override PartName="/word/footer1.xml" ContentType="${CT}.footer+xml"/>` +
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
      '</Relationships>') },
    { name: 'word/document.xml', data: buildPracDocumentXml(data, meta, pid) },
    { name: 'word/styles.xml',   data: STYLES_XML },
    { name: 'word/settings.xml', data: SETTINGS_XML },
    { name: 'word/header1.xml',  data: headerXml(pid) },
    { name: 'word/footer1.xml',  data: footerXml(pid) }
  ];
  return makeZip(files, CT + '.document');
}
