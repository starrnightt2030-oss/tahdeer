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
    figures: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          caption: S_STR,
          page:    { type: 'INTEGER' },
          box_2d:  { type: 'ARRAY', items: { type: 'INTEGER' } }
        },
        propertyOrdering: ['caption', 'page', 'box_2d']
      }
    }
  },
  propertyOrdering: ['lessonTitle', 'objectives', 'prerequisites', 'resources', 'strategies',
    'warmup', 'content', 'drills', 'activities', 'assessment', 'warning', 'homework', 'figures']
};

/* ---------- التعليمات ---------- */
function buildPrompt(meta, pageCount) {
  return `أنت موجّه تربوي خبير في إعداد تحضير دروس التخصصات الفنية (كهرباء وإلكترونيات) في مركز تدريب معتمد.

مرفق ${toArabicDigits(pageCount)} صورة لصفحات درس من كتاب مدرسي. اقرأها كاملة بعناية — النصوص والجداول والأشكال والأمثلة المحلولة — ثم حوّلها إلى **تحضير درس احترافي** يُطبع على نموذج معتمد.

بيانات الحصة كما أدخلها المعلّم:
• المادة: ${meta.subject || '—'}   • الصف: ${meta.grade || '—'}   • القسم: ${meta.dept || '—'}
• رقم الدرس: ${meta.lessonNo || '—'}   • الأسبوع: ${meta.week || '—'}   • الحصة: ${meta.period || '—'}
• زمن الحصة: ${meta.duration || '٤٥ دقيقة'}   • الوحدة: ${meta.unit || '—'}
${meta.hint ? '• توجيه من المعلّم: ' + meta.hint : ''}

الحقول المطلوبة:
1. lessonTitle — عنوان الدرس كما ورد في الكتاب، مختصر ودقيق.
2. objectives — أهداف سلوكية تبدأ بـ«أن يَـ…» وقابلة للقياس: cognitive (٣–٤)، skill (٢–٣)، affective (١–٢).
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
10. assessment.questions — سؤالان: label مثل «سؤال قراءة» و«سؤال عكسي»، question بصيغته الكاملة بالأرقام، وanswer اتركه فارغًا دائمًا.
11. warning — تنبيه واحد (سطران) عن خطأ شائع أو اشتراط سلامة في هذا الدرس تحديدًا.
12. homework — تكليفان محدّدان بقيم حقيقية من الدرس.
13. figures — الأشكال والرسوم التوضيحية المفيدة الموجودة في الصفحات المرفقة (من صفر إلى ٢).
    لكل شكل: caption عنوان عربي قصير، page رقم الصورة المرفقة (يبدأ من ١)،
    box_2d إحداثيات الإطار [y1, x1, y2, x2] بقيم من ٠ إلى ١٠٠٠ نسبةً لأبعاد تلك الصورة.
    اختر الشكل الأهم لفهم الدرس (رسم/مخطط/دائرة)، ولا تختر فقرات نصية أو ترويسات.

قواعد إلزامية:
- كل المحتوى مستخرج من الدرس المرفق نفسه — ممنوع الكلام العام الذي يصلح لأي درس.
- عربية فصحى تربوية، والمصطلحات الأجنبية بين قوسين عند أول ذكر.
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
async function generateTahdeer({ apiKey, model, pages, meta, onProgress }) {
  if (!apiKey) throw new Error('لم يتم إدخال مفتاح Gemini. افتح الإعدادات وأدخل المفتاح أولًا.');
  if (!pages || !pages.length) throw new Error('ارفع ملف الدرس (PDF أو صور) أولًا.');

  const parts = pages.map(canvasToPart);
  parts.push({ text: buildPrompt(meta, pages.length) });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA
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
  return normalize(data);
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
  d.figures = Array.isArray(d.figures) ? d.figures.slice(0, 2) : [];
  return d;
}
