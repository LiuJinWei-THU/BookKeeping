/* 本地 OCR：Tesseract.js（中文 fast 模型，按需从 CDN 动态加载） */
window.OCR = (function () {
  const TESS_VERSION = '5.1.1';
  const SCRIPT_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist/tesseract.min.js`;
  const WORKER_URL = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist/worker.min.js`;
  const CORE_PATH = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0';
  const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0_fast';

  let scriptLoading = null;
  let workerPromise = null;
  let progressCb = null;
  let phaseBase = 0, phaseSpan = 1;

  function loadScript() {
    if (window.Tesseract) return Promise.resolve();
    if (scriptLoading) return scriptLoading;
    scriptLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error('OCR 引擎下载失败，请检查网络（需要访问 cdn.jsdelivr.net）'));
      document.head.appendChild(s);
    });
    return scriptLoading;
  }

  const STATUS_MAP = {
    'loading tesseract core': '加载识别引擎',
    'initializing tesseract': '初始化引擎',
    'loading language traineddata': '下载中文识别模型（首次约 4MB，之后有缓存）',
    'initializing api': '准备识别',
    'recognizing text': '正在识别文字'
  };

  async function getWorker() {
    await loadScript();
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('chi_sim', 1, {
        workerPath: WORKER_URL,
        corePath: CORE_PATH,
        langPath: LANG_PATH,
        logger: m => {
          if (progressCb && m && typeof m.progress === 'number') {
            const label = STATUS_MAP[m.status] || m.status || '处理中';
            progressCb(label, Math.min(1, phaseBase + phaseSpan * m.progress));
          }
        }
      }).catch(e => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  /* 图片预处理：限制尺寸 + 灰度 + 对比度增强，提高识别率与速度 */
  function preprocess(img, maxSize) {
    maxSize = maxSize || 1600;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    let scale = 1;
    if (Math.max(w, h) > maxSize) scale = maxSize / Math.max(w, h);
    else if (Math.max(w, h) < 900) scale = Math.min(2, 900 / Math.max(w, h));
    w = Math.round(w * scale); h = Math.round(h * scale);

    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    // 灰度 + 轻度对比度拉伸
    for (let i = 0; i < px.length; i += 4) {
      let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      g = (g - 128) * 1.25 + 128;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      px[i] = px[i + 1] = px[i + 2] = g;
    }
    ctx.putImageData(data, 0, 0);
    return cv;
  }

  /* 裁剪顶部金额带并缩放到固定宽度：超大字号金额在全图识别中易丢失，缩到常规字号后可识别 */
  function cropAmountZone(img, y0, y1, outW) {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const ch = Math.round(H * (y1 - y0));
    const scale = outW / W;
    const cv = document.createElement('canvas');
    cv.width = outW; cv.height = Math.max(40, Math.round(ch * scale));
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, Math.round(H * y0), W, ch, 0, 0, cv.width, cv.height);
    return cv;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = src;
    });
  }

  // 生成压缩预览（确认卡片显示用，不入库）
  function thumbDataUrl(img, maxW) {
    const scale = Math.min(1, maxW / (img.naturalWidth || img.width));
    const cv = document.createElement('canvas');
    cv.width = Math.round((img.naturalWidth || img.width) * scale);
    cv.height = Math.round((img.naturalHeight || img.height) * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.8);
  }

  /**
   * 识别一张图片（多 pass：金额带双尺度 + 全图），返回合并 OCR 文本
   * @param {string} dataUrl 图片 dataURL
   * @param {(label:string, ratio:number)=>void} onProgress 进度回调
   * @returns {Promise<string>} OCR 全文
   */
  async function recognize(dataUrl, onProgress) {
    progressCb = onProgress || null;
    const img = await loadImage(dataUrl);
    const worker = await getWorker();

    // pass 1：顶部金额带。超大字号金额需缩到常规字号才能识别，
    // 不同 App 金额字号不同（支付宝 > 微信），从大到小两个尺度尝试，出现金额即停
    const AMT_HINT = /[0-9OoIl]{1,3}\s*[.．]\s*[0-9OolI]{1,2}/;
    let zoneText = '';
    for (let i = 0; i < 2; i++) {
      phaseBase = 0.05 + i * 0.2; phaseSpan = 0.2;
      const zone = cropAmountZone(img, 0.10, 0.32, i === 0 ? 430 : 330);
      const dz = await worker.recognize(zone);
      zoneText = (dz && dz.data && dz.data.text) || '';
      if (AMT_HINT.test(zoneText)) break;
    }

    // pass 2：全图（字段、时间、单号）
    phaseBase = 0.45; phaseSpan = 0.55;
    const canvas = preprocess(img);
    const df = await worker.recognize(canvas);

    progressCb = null;
    // 金额带文本放前面：parser 的"首个金额"与顶部商户名策略依赖此顺序
    return zoneText + '\n' + ((df && df.data && df.data.text) || '');
  }

  return { recognize, loadImage, thumbDataUrl, preprocess, cropAmountZone };
})();
