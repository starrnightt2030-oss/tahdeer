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
  const page = el('div', 'page' + (opts.landscape ? ' land' : '') + (opts.cover ? ' cover' : ''));

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
