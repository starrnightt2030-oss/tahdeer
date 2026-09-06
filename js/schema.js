/* =========================================================================
   schema.js — مصدر الحقيقة الوحيد لقالب التحضير
   النموذج + برومبت الذكاء الاصطناعي + المعاينة + ملف Word كلها تُبنى من هنا.
   ========================================================================= */

const IDENTITY_DEFAULT = {
  org:        'شركة ترسانة الإسكندرية',
  dept1:      'الإدارة العامة لمركز التدريب',
  dept2:      'إدارة التعليم النظري',
  ribbon:     'نظري ٣',
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
  { key: 'dept',     label: 'القسم',     type: 'text', ph: 'التركيبات الكهربائية',            remember: true  }
];

/* الحقول التي تظهر في شريط المعلومات العلوي (بالترتيب من اليمين) */
const STRIP_FIELDS = ['date', 'week', 'period', 'duration', 'unit'];
/* الصفوف الثلاثة تحت الشريط */
const ROW_FIELDS   = ['subject', 'grade', 'dept'];

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

const SIGNATURES = ['المعلّم', 'رئيس القسم', 'مدير عام مركز التدريب'];

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
