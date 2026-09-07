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

/* ---------- بيانات يدخلها المعلّم ---------- */
const META_FIELDS = [
  { key: 'lessonNo', label: 'رقم الدرس', type: 'text', ph: 'مثال: ٤',                       remember: false, req: true },
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

/* أعمدة جدول الخطة — العرض بالملّيمتر على ورقة A4 عرضية */
const PLAN_COLUMNS = [
  { key: 'no',    label: 'م',          w: 10, align: 'center' },
  { key: 'week',  label: 'الأسبوع',    w: 26, align: 'center' },
  { key: 'date',  label: 'التاريخ',    w: 24, align: 'center' },
  { key: 'unit',  label: 'الوحدة',     w: 30, align: 'center' },
  { key: 'items', label: 'المحتوى',    w: 145, align: 'right' },
  { key: 'notes', label: 'الملاحظات',  w: 42, align: 'right' }
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
