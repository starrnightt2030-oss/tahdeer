/* =========================================================================
   camera.js — تصوير صفحات الكتاب داخل التطبيق

   لماذا لا نستخدم <input capture="environment">؟
   لأنه يفتح تطبيق الكاميرا الخارجي، فيخرج المستخدم من التطبيق، وأندرويد كثيرًا
   ما يقتل صفحة التطبيق تحت ضغط الذاكرة ثم يعيد تحميلها عند الرجوع — فيرجع
   المستخدم إلى شاشة المكتبة وتضيع الصور والبيانات المكتوبة. هذه الكاميرا تعمل
   داخل الصفحة عبر getUserMedia فلا يحدث خروج ولا إعادة تحميل.
   ========================================================================= */

const Cam = {
  stream: null,
  facing: 'environment',
  shots: [],            /* [{ file, url }] */
  onDone: null,

  supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  },

  async open(onDone) {
    Cam.onDone = onDone || null;
    Cam.shots = [];
    Cam.renderStrip();
    const back = document.querySelector('#camDlg');
    back.hidden = false;
    document.body.classList.add('cam-on');
    const ok = await Cam.start();
    if (!ok) return false;
    return true;
  },

  async start() {
    const msg = document.querySelector('#camMsg');
    const vid = document.querySelector('#camVideo');
    msg.hidden = true;
    Cam.stop();
    try {
      Cam.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: Cam.facing },
          width:  { ideal: 2560 },
          height: { ideal: 1440 }
        }
      });
      vid.srcObject = Cam.stream;
      await vid.play().catch(() => {});
      return true;
    } catch (e) {
      /* الإذن مرفوض أو لا توجد كاميرا — نرجع لطريقة النظام */
      msg.textContent = (e && e.name === 'NotAllowedError')
        ? 'التطبيق لا يملك إذن الكاميرا. اسمح به من إعدادات الموقع، أو استخدم «اختيار من الملفات».'
        : 'تعذّر تشغيل الكاميرا على هذا الجهاز — استخدم «اختيار من الملفات».';
      msg.hidden = false;
      return false;
    }
  },

  stop() {
    if (Cam.stream) { Cam.stream.getTracks().forEach(t => t.stop()); Cam.stream = null; }
    const vid = document.querySelector('#camVideo');
    if (vid) vid.srcObject = null;
  },

  async flip() {
    Cam.facing = (Cam.facing === 'environment') ? 'user' : 'environment';
    await Cam.start();
  },

  /** يلتقط إطارًا من الفيديو ويحوّله ملف JPEG */
  async shoot() {
    const vid = document.querySelector('#camVideo');
    const w = vid.videoWidth, h = vid.videoHeight;
    if (!w || !h) return toast('الكاميرا لم تجهز بعد', true);

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(vid, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) return toast('تعذّر حفظ الصورة', true);

    const n = Cam.shots.length + 1;
    const file = new File([blob], `صفحة-${n}.jpg`, { type: 'image/jpeg' });
    Cam.shots.push({ file, url: URL.createObjectURL(blob) });
    Cam.renderStrip();

    /* نبضة بصرية تؤكد الالتقاط */
    const v = document.querySelector('.cam-view');
    v.classList.add('flash');
    setTimeout(() => v.classList.remove('flash'), 160);
  },

  renderStrip() {
    const s = document.querySelector('#camStrip');
    if (!s) return;
    s.innerHTML = '';
    Cam.shots.forEach((sh, i) => {
      const b = document.createElement('div');
      b.className = 'cam-th';
      b.innerHTML = `<img src="${sh.url}" alt=""><button title="حذف">&times;</button>`;
      b.querySelector('button').onclick = () => {
        URL.revokeObjectURL(sh.url);
        Cam.shots.splice(i, 1);
        Cam.renderStrip();
      };
      s.appendChild(b);
    });
    const c = document.querySelector('#camCount');
    if (c) c.textContent = Cam.shots.length
      ? `${toArabicDigits(Cam.shots.length)} ${Cam.shots.length === 1 ? 'صفحة' : 'صفحات'}`
      : 'لم تُصوَّر صفحات بعد';
    const d = document.querySelector('#camDone');
    if (d) d.disabled = !Cam.shots.length;
  },

  close(keep) {
    Cam.stop();
    const files = keep ? Cam.shots.map(s => s.file) : [];
    if (!keep) Cam.shots.forEach(s => URL.revokeObjectURL(s.url));
    Cam.shots = [];
    Cam.renderStrip();
    document.querySelector('#camDlg').hidden = true;
    document.body.classList.remove('cam-on');
    if (files.length && Cam.onDone) Cam.onDone(files);
  }
};

function bindCamera() {
  const camIn = document.querySelector('#cameraInput');

  document.querySelector('#btnCamera').onclick = async () => {
    if (!Cam.supported()) return camIn.click();
    const ok = await Cam.open(files => addFiles(files));
    if (!ok) {
      /* لم تعمل الكاميرا الداخلية — نغلق ونستخدم كاميرا النظام كخطة بديلة */
      setTimeout(() => { Cam.close(false); camIn.click(); }, 1800);
    }
  };

  document.querySelector('#camShot').onclick  = () => Cam.shoot();
  document.querySelector('#camFlip').onclick  = () => Cam.flip();
  document.querySelector('#camClose').onclick = () => Cam.close(false);
  document.querySelector('#camDone').onclick  = () => Cam.close(true);

  /* لو خرج المستخدم من التطبيق والكاميرا مفتوحة، نطفئها لتوفير الطاقة */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Cam.stream) Cam.stop();
    else if (!document.hidden && !document.querySelector('#camDlg').hidden && !Cam.stream) Cam.start();
  });
}
