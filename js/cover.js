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
  hero.appendChild(ed('div', 'subj', meta.subject || '—', null));
  hero.appendChild(el('div', 'rule'));
  hero.appendChild(ed('div', 'grade', meta.grade || '', null));
  if (meta.dept) hero.appendChild(ed('div', 'dept', meta.dept, null));
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
