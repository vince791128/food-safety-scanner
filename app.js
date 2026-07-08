const APP_VERSION = 'browser-pwa-v5-simple-result';
const DATA_PATH = './data/recalls.json';
const LOCAL_SNAPSHOT_KEY = 'foodSafetyRecallsSnapshotV1';

const state = {
  recalls: null,
  codeReader: null,
  controls: null,
  serviceWorkerRegistration: null,
  lastScannedCode: '',
  lastScanAt: 0,
  liveOcrTimer: null,
  liveOcrInProgress: false,
  liveOcrEnabled: false,
  liveOcrLastRunAt: 0,
};

const $ = (id) => document.getElementById(id);
const els = {
  dataStrip: $('dataStrip'),
  dataFreshness: $('dataFreshness'),
  sourceSummary: $('sourceSummary'),
  refreshDataBtn: $('refreshDataBtn'),
  startScanBtn: $('startScanBtn'),
  stopScanBtn: $('stopScanBtn'),
  startLiveTextBtn: $('startLiveTextBtn'),
  preview: $('preview'),
  liveOcrStatus: $('liveOcrStatus'),
  liveOcrHint: $('liveOcrHint'),
  barcodeInput: $('barcodeInput'),
  lotInput: $('lotInput'),
  expiryInput: $('expiryInput'),
  lookupBtn: $('lookupBtn'),
  result: $('result'),
  resultWord: $('resultWord'),
  resultTitle: $('resultTitle'),
  resultMessage: $('resultMessage'),
  detailsCard: $('detailsCard'),
  detailsList: $('detailsList'),
  sourceBox: $('sourceBox'),
  sampleList: $('sampleList'),
  clearOcrBtn: $('clearOcrBtn'),
  ocrText: $('ocrText'),
};

async function loadData({ force = false, allowSnapshot = true } = {}) {
  setRefreshState(true);
  setDataStrip('loading', '資料更新中', '正在抓取最新資料…');

  if (force && state.serviceWorkerRegistration) {
    await state.serviceWorkerRegistration.update().catch(() => null);
  }

  try {
    const data = await fetchFreshData(force);
    state.recalls = data;
    saveSnapshot(data);
    renderFreshness('fresh');
    renderSamples();
    setRefreshState(false);
    return { ok: true, source: 'network' };
  } catch (networkError) {
    console.warn('Network data load failed', networkError);
    if (allowSnapshot) {
      const snapshot = loadSnapshot();
      if (snapshot) {
        state.recalls = snapshot;
        renderFreshness('snapshot');
        renderSamples();
        setRefreshState(false);
        return { ok: true, source: 'snapshot' };
      }
    }
    setRefreshState(false);
    setDataStrip('error', '資料讀取失敗', '找不到 recalls.json，請確認 GitHub Pages 檔案路徑或稍後重整。');
    throw networkError;
  }
}

async function fetchFreshData(force) {
  const urls = [
    `${DATA_PATH}?v=${encodeURIComponent(APP_VERSION)}&t=${Date.now()}`,
    DATA_PATH,
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        cache: force ? 'reload' : 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      validateRecallData(data);
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('資料讀取失敗');
}

function validateRecallData(data) {
  if (!data || !data.metadata || !Array.isArray(data.products)) {
    throw new Error('recalls.json 格式錯誤');
  }
}

function saveSnapshot(data) {
  try {
    localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify({ saved_at: new Date().toISOString(), data }));
  } catch (err) {
    console.warn('Snapshot save failed', err);
  }
}

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(LOCAL_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    validateRecallData(parsed.data);
    return parsed.data;
  } catch (err) {
    console.warn('Snapshot load failed', err);
    return null;
  }
}

function setRefreshState(isUpdating) {
  if (!els.refreshDataBtn) return;
  els.refreshDataBtn.disabled = isUpdating;
  els.refreshDataBtn.classList.toggle('updating', isUpdating);
  els.refreshDataBtn.textContent = isUpdating ? '更新中…' : '更新';
}

function setDataStrip(type, text, subtext) {
  if (!els.dataStrip) return;
  els.dataStrip.classList.remove('offline', 'error');
  if (type === 'snapshot') els.dataStrip.classList.add('offline');
  if (type === 'error') els.dataStrip.classList.add('error');
  els.dataFreshness.textContent = text;
  els.sourceSummary.textContent = subtext;
}

function renderFreshness(mode) {
  const updated = new Date(state.recalls.metadata.last_updated_at);
  const now = new Date();
  const hoursOld = Number.isFinite(updated.getTime()) ? Math.round((now - updated) / 36e5) : null;
  const formatted = Number.isFinite(updated.getTime()) ? updated.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }) : '未知時間';

  if (mode === 'snapshot') {
    setDataStrip('snapshot', `使用上次成功資料｜${formatted}`, '新版資料讀取失敗，先使用本機暫存資料。');
    return;
  }
  const stale = hoursOld !== null && hoursOld > 24;
  setDataStrip(stale ? 'snapshot' : 'fresh', stale ? `資料可能過舊｜${formatted}` : `資料已更新｜${formatted}`, state.recalls.metadata.official_update_policy || '每日 07:00 更新；事件期間 15:10 補更新');
}

function renderSamples() {
  if (!els.sampleList || !state.recalls) return;
  const samples = state.recalls.products.filter((p) => p.barcode_gtin).slice(0, 8);
  els.sampleList.innerHTML = samples.map((p) => (
    `<button class="sample-btn" type="button" data-barcode="${escapeHtml(p.barcode_gtin)}">${escapeHtml(p.barcode_gtin)}｜${escapeHtml(p.product_name)}</button>`
  )).join('');
  els.sampleList.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      els.barcodeInput.value = btn.dataset.barcode;
      lookup();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function normalize(value) {
  return String(value || '').trim();
}

function normalizeLot(value) {
  return normalize(value).toUpperCase().replace(/\s+/g, '');
}

function normalizeDateString(value) {
  if (!value) return '';
  const v = String(value).trim();
  const iso = v.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (iso) return v;
  const m = v.match(/(20\d{2})[\.\/\-年 ]?(\d{1,2})[\.\/\-月 ]?(\d{1,2})/);
  if (m) return toIsoDate(m[1], m[2], m[3]);
  const compact8 = v.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact8) return toIsoDate(compact8[1], compact8[2], compact8[3]);
  const compact6 = v.match(/(?:^|\D)(\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (compact6) return toIsoDate(String(2000 + Number(compact6[1])), compact6[2], compact6[3]);
  return '';
}

function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function sameDate(inputDate, affectedDate) {
  if (!inputDate || !affectedDate) return false;
  return inputDate === affectedDate;
}

function setFieldValue(input, value) {
  if (!input || !value) return false;
  input.value = value;
  input.classList.add('autofilled');
  window.setTimeout(() => input.classList.remove('autofilled'), 1600);
  return true;
}

function lookup(scannedCode = null) {
  const result = evaluate(scannedCode);
  renderEvaluation(result);
  return result;
}

function evaluate(scannedCode = null) {
  if (!state.recalls) {
    return {
      type: 'neutral', word: '無資料', icon: '?', title: '資料尚未載入',
      message: '請先按更新，或確認 data/recalls.json 已部署。', details: {}
    };
  }

  const parsed = scannedCode ? parseScannedPayload(scannedCode) : {};
  if (parsed.lot) setFieldValue(els.lotInput, parsed.lot);
  if (parsed.expiryDate) setFieldValue(els.expiryInput, parsed.expiryDate);

  const barcode = normalize(parsed.gtin || scannedCode || els.barcodeInput.value);
  if (scannedCode || parsed.gtin) setFieldValue(els.barcodeInput, barcode);

  const lot = normalizeLot(els.lotInput.value);
  const expiry = normalizeDateString(els.expiryInput.value) || normalize(els.expiryInput.value);

  if (!barcode) {
    return {
      type: 'neutral', word: '待掃描', icon: '?', title: '請掃商品條碼',
      message: '掃到條碼後會立刻判斷。', details: { barcode, lot, expiry }
    };
  }

  const normalizedBarcode = normalizeGtin(barcode);
  const product = state.recalls.products.find((p) => normalizeGtin(p.barcode_gtin) === normalizedBarcode);

  if (!product) {
    return {
      type: 'neutral', word: '無資料', icon: '?', title: '資料庫未收錄',
      message: '目前公開資料未列入此條碼；不等於保證安全。', details: { barcode, lot, expiry, scannedPayload: scannedCode, parsed }
    };
  }

  const batches = product.affected_batches || [];
  if (batches.length === 0) {
    return {
      type: 'pass', word: '合格', icon: '✓', title: '目前未列入受影響清單',
      message: '以目前資料庫比對，這個條碼未命中受影響批次。', details: { barcode, lot, expiry, product, scannedPayload: scannedCode, parsed }
    };
  }

  const matchedBatch = batches.find((batch) => {
    const batchLot = normalizeLot(batch.lot_no);
    const lotMatched = batchLot ? lot === batchLot : false;
    const expiryMatched = sameDate(expiry, batch.expiry_date);
    if (batchLot && batch.expiry_date) return lotMatched && expiryMatched;
    return lotMatched || expiryMatched;
  });

  if (matchedBatch) {
    return {
      type: 'fail', word: '不合格', icon: '!', title: '命中受影響產品',
      message: '請勿食用，保留包裝並依官方或通路公告處理。', details: { barcode, lot, expiry, product, matchedBatch, scannedPayload: scannedCode, parsed }
    };
  }

  if (!lot && !expiry) {
    return {
      type: 'warn', word: '需確認', icon: '!', title: '同品項曾受影響',
      message: '請把鏡頭移到有效日期或批號；讀到後會自動更新結果。', details: { barcode, lot, expiry, product, scannedPayload: scannedCode, parsed }
    };
  }

  return {
    type: 'pass', word: '合格', icon: '✓', title: '此批號／效期目前未命中',
    message: '請肉眼確認日期與批號辨識正確。', details: { barcode, lot, expiry, product, scannedPayload: scannedCode, parsed }
  };
}

function renderEvaluation(result) {
  showResult(result.type, result.word, result.icon, result.title, result.message);
  renderDetails(result.details || {});
  updateScanHint(result);
}

function showResult(type, word, icon, title, message) {
  els.result.className = `result-card ${type}`;
  els.resultWord.textContent = word;
  els.result.querySelector('.result-icon').textContent = icon;
  els.resultTitle.textContent = title;
  els.resultMessage.textContent = message;
}

function updateScanHint(result) {
  if (!els.liveOcrStatus || !els.liveOcrHint) return;
  if (result.type === 'fail') {
    els.liveOcrStatus.textContent = '已命中不合格';
    els.liveOcrHint.textContent = '請停止食用並保留包裝。';
  } else if (result.type === 'pass') {
    els.liveOcrStatus.textContent = '目前顯示合格';
    els.liveOcrHint.textContent = '若 OCR 可能誤讀，請打開手動修正確認。';
  } else if (result.type === 'warn') {
    els.liveOcrStatus.textContent = '需要效期或批號';
    els.liveOcrHint.textContent = '不用拍照，直接把鏡頭移到包裝印字處。';
  } else {
    els.liveOcrStatus.textContent = '等待掃描';
    els.liveOcrHint.textContent = '掃到條碼會立刻跳出結果。';
  }
}

function renderDetails({ barcode, lot, expiry, product, matchedBatch, scannedPayload, parsed } = {}) {
  if (!els.detailsList || !state.recalls) return;
  const rows = [
    ['條碼', barcode || '未取得'],
    ['批號', lot || '未取得'],
    ['有效日期', expiry || '未取得'],
  ];
  if (scannedPayload && scannedPayload !== barcode) rows.push(['原始掃描內容', scannedPayload]);
  if (product) {
    rows.push(
      ['公司／品牌', `${product.company_name}｜${product.brand_name}`],
      ['產品名稱', product.product_name],
      ['受影響批次', product.affected_batches?.length ? product.affected_batches.map((b) => `${b.lot_no || '未列批號'} / ${b.expiry_date || '未列效期'}`).join('；') : '目前未列入'],
      ['命中批次', matchedBatch ? `${matchedBatch.lot_no || '未列批號'} / ${matchedBatch.expiry_date || '未列效期'}` : '未命中']
    );
  }
  els.detailsList.innerHTML = rows.map(([key, val]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(val)}</dd>`).join('');
  const sources = state.recalls.metadata.sources?.map((source) => `<li>${escapeHtml(source)}</li>`).join('') || '';
  els.sourceBox.innerHTML = `
    <strong>資料來源</strong>
    <ul>${sources}</ul>
    <p>${escapeHtml(product?.source_note || state.recalls.metadata.disclaimer || '')}</p>
  `;
}

function parseScannedPayload(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return {};

  const normalized = raw.replace(/\u001d/g, '\x1d').replace(/[\[\]{}]/g, '');
  const result = { raw };

  if (normalized.match(/\(\d{2,4}\)/)) {
    const gtin = normalized.match(/\(01\)\s*(\d{14})/);
    const expiry = normalized.match(/\(17\)\s*(\d{6})/);
    const bestBefore = normalized.match(/\(15\)\s*(\d{6})/);
    const lot = normalized.match(/\(10\)\s*([A-Z0-9\-\.]{1,24})/i);
    if (gtin) result.gtin = normalizeGtin(gtin[1]);
    if (expiry || bestBefore) result.expiryDate = aiDateToIso((expiry || bestBefore)[1]);
    if (lot) result.lot = cleanLot(lot[1]);
    return result;
  }

  const gtin = normalized.match(/(?:^|\D)01(\d{14})/);
  const expiry = normalized.match(/(?:^|\D)17(\d{6})/);
  const bestBefore = normalized.match(/(?:^|\D)15(\d{6})/);
  if (gtin) result.gtin = normalizeGtin(gtin[1]);
  if (expiry || bestBefore) result.expiryDate = aiDateToIso((expiry || bestBefore)[1]);

  const gs = normalized.includes('\x1d') ? normalized.split('\x1d') : [];
  const lotSegment = gs.find((part) => part.startsWith('10'));
  if (lotSegment) result.lot = cleanLot(lotSegment.slice(2));

  if (!result.lot) {
    const lot = normalized.match(/(?:^|\D)10([A-Z0-9][A-Z0-9\-\.]{2,20})(?:\x1d|$)/i);
    if (lot) result.lot = cleanLot(lot[1]);
  }

  if (!result.gtin && /^\d{8,14}$/.test(normalized.replace(/\D/g, ''))) {
    result.gtin = normalizeGtin(normalized.replace(/\D/g, ''));
  }
  return result;
}

function normalizeGtin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 14 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

function aiDateToIso(value) {
  const v = String(value || '').replace(/\D/g, '');
  if (v.length !== 6) return '';
  return toIsoDate(String(2000 + Number(v.slice(0, 2))), v.slice(2, 4), v.slice(4, 6));
}

function cleanLot(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9\-\.]/g, '').slice(0, 24);
}

async function startScanner() {
  if (!window.ZXingBrowser) {
    els.liveOcrStatus.textContent = '掃描套件載入失敗';
    els.liveOcrHint.textContent = '請改用手動輸入，或確認網路可連到 CDN。';
    return;
  }

  try {
    state.codeReader = new ZXingBrowser.BrowserMultiFormatReader();
    els.startScanBtn.disabled = true;
    els.stopScanBtn.disabled = false;
    if (els.startLiveTextBtn) els.startLiveTextBtn.disabled = true;
    els.liveOcrStatus.textContent = '掃描中';
    els.liveOcrHint.textContent = '先對準商品條碼；如顯示需確認，再移到效期／批號。';
    startLiveOcrLoop();

    state.controls = await state.codeReader.decodeFromVideoDevice(
      undefined,
      els.preview,
      (result) => {
        if (!result) return;
        handleBarcodeDetected(result.getText());
      }
    );
  } catch (err) {
    console.error(err);
    showResult('neutral', '無法掃', '?', '相機無法開啟', '請確認 HTTPS、相機權限，或改用手動查詢。');
    els.liveOcrStatus.textContent = '相機無法使用';
    els.liveOcrHint.textContent = 'LINE 內建瀏覽器可能失敗，請改用 Safari / Chrome。';
    els.startScanBtn.disabled = false;
    els.stopScanBtn.disabled = true;
    if (els.startLiveTextBtn) els.startLiveTextBtn.disabled = false;
    stopLiveOcrLoop();
  }
}

async function startTextOnlyScanner() {
  await startScanner();
}

function handleBarcodeDetected(code) {
  const now = Date.now();
  if (state.lastScannedCode === code && now - state.lastScanAt < 2500) return;
  state.lastScannedCode = code;
  state.lastScanAt = now;
  lookup(code);
}

function stopScanner() {
  stopLiveOcrLoop();
  if (state.controls) {
    state.controls.stop();
    state.controls = null;
  }
  els.startScanBtn.disabled = false;
  els.stopScanBtn.disabled = true;
  if (els.startLiveTextBtn) els.startLiveTextBtn.disabled = false;
  els.liveOcrStatus.textContent = '掃描已停止';
  els.liveOcrHint.textContent = '可重新開始掃描或手動查詢。';
}

function startLiveOcrLoop() {
  if (state.liveOcrEnabled) return;
  state.liveOcrEnabled = true;
  if (state.liveOcrTimer) window.clearInterval(state.liveOcrTimer);
  state.liveOcrTimer = window.setInterval(runLiveOcrIfNeeded, 1900);
  runLiveOcrIfNeeded();
}

function stopLiveOcrLoop() {
  state.liveOcrEnabled = false;
  state.liveOcrInProgress = false;
  if (state.liveOcrTimer) window.clearInterval(state.liveOcrTimer);
  state.liveOcrTimer = null;
}

async function runLiveOcrIfNeeded() {
  if (!state.liveOcrEnabled || state.liveOcrInProgress) return;
  if (!window.Tesseract) return;
  if (!els.preview?.videoWidth || !els.preview?.videoHeight) return;

  const barcode = normalize(els.barcodeInput.value);
  const missingLotOrDate = !normalize(els.lotInput.value) || !normalize(els.expiryInput.value);
  if (!barcode || !missingLotOrDate) return;

  const now = Date.now();
  if (now - state.liveOcrLastRunAt < 3200) return;
  state.liveOcrLastRunAt = now;
  state.liveOcrInProgress = true;
  els.liveOcrStatus.textContent = '正在讀效期／批號';

  try {
    const canvas = captureVideoFrameForOcr();
    if (!canvas) return;
    const result = await window.Tesseract.recognize(canvas, 'eng');
    const text = result?.data?.text || '';
    if (els.ocrText) els.ocrText.textContent = text.trim() || '沒有讀到清楚文字';
    const parsed = parseOcrText(text);
    applyParsedOcr(parsed);
  } catch (err) {
    console.warn('Live OCR failed', err);
    els.liveOcrStatus.textContent = '效期辨識失敗';
    els.liveOcrHint.textContent = '請靠近一點、避免反光，或打開手動修正。';
  } finally {
    state.liveOcrInProgress = false;
  }
}

function captureVideoFrameForOcr() {
  const video = els.preview;
  if (!video?.videoWidth || !video?.videoHeight) return null;
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  const cropW = Math.floor(sourceW * 0.92);
  const cropH = Math.floor(sourceH * 0.62);
  const cropX = Math.floor((sourceW - cropW) / 2);
  const cropY = Math.floor((sourceH - cropH) / 2);
  const canvas = document.createElement('canvas');
  const targetW = 1100;
  const targetH = Math.round(targetW * cropH / cropW);
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    const boosted = gray > 145 ? 255 : Math.max(0, gray - 24);
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function applyParsedOcr(parsed) {
  const changed = [];
  if (parsed.expiryDate && !els.expiryInput.value) {
    setFieldValue(els.expiryInput, parsed.expiryDate);
    changed.push(`有效日期 ${parsed.expiryDate}`);
  }
  if (parsed.lot && !els.lotInput.value) {
    setFieldValue(els.lotInput, parsed.lot);
    changed.push(`批號 ${parsed.lot}`);
  }
  if (changed.length) {
    els.liveOcrStatus.textContent = '已讀到效期／批號';
    els.liveOcrHint.textContent = changed.join('、');
    if (els.barcodeInput.value) lookup();
  } else {
    els.liveOcrStatus.textContent = '尚未讀到效期／批號';
    els.liveOcrHint.textContent = '請把印字移到框線中央，保持 1–2 秒。';
  }
}

function parseOcrText(text) {
  const compact = String(text || '')
    .replace(/[ＯO]/g, '0')
    .replace(/[ＩIl|]/g, '1')
    .replace(/[ＳS]/g, '5')
    .replace(/[ＢB]/g, '8')
    .replace(/[：]/g, ':')
    .toUpperCase();
  const result = {};
  const datePatterns = [
    /(?:EXP|EXPIRY|USE BY|BEST BEFORE|BEST BY|VALID|DATE|BB|有效|效期|期限)[^0-9]{0,12}(20\d{2})[\.\/\-年 ]?(\d{1,2})[\.\/\-月 ]?(\d{1,2})/i,
    /(?:EXP|EXPIRY|USE BY|BEST BEFORE|BEST BY|VALID|DATE|BB)[^0-9]{0,12}(\d{2})[\.\/\- ]?(\d{2})[\.\/\- ]?(\d{2})/i,
    /(20\d{2})[\.\/\-年 ]?(\d{1,2})[\.\/\-月 ]?(\d{1,2})/,
    /(?:^|\D)(20\d{2})(\d{2})(\d{2})(?:\D|$)/,
    /(?:^|\D)(\d{2})[\.\/\- ]?(\d{2})[\.\/\- ]?(\d{2})(?:\D|$)/,
  ];
  for (const pattern of datePatterns) {
    const m = compact.match(pattern);
    if (!m) continue;
    if (m[1]?.startsWith('20')) result.expiryDate = toIsoDate(m[1], m[2], m[3]);
    else result.expiryDate = toIsoDate(String(2000 + Number(m[1])), m[2], m[3]);
    if (result.expiryDate) break;
  }
  const lotPatterns = [
    /(?:LOT|L\/N|L\.?NO\.?|BATCH|批號|批号|批次)[^A-Z0-9]{0,8}([A-Z0-9][A-Z0-9\-\.]{2,24})/i,
    /([A-Z]\d{6,10}[A-Z]?)/i,
    /(\d{3}-\d{6,10})/,
    /([A-Z]{1,3}\d{4,10})/i,
  ];
  for (const pattern of lotPatterns) {
    const m = compact.match(pattern);
    if (!m) continue;
    const candidate = cleanLot(m[1]);
    if (candidate && !looksLikeDateOnly(candidate)) {
      result.lot = candidate;
      break;
    }
  }
  return result;
}

function looksLikeDateOnly(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 6 || digits.length === 8;
}

function clearOcr() {
  els.lotInput.value = '';
  els.expiryInput.value = '';
  if (els.ocrText) els.ocrText.textContent = '尚無文字';
  if (els.barcodeInput.value) lookup();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js');
    state.serviceWorkerRegistration = registration;
    await registration.update().catch(() => null);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!window.__swReloaded) {
        window.__swReloaded = true;
        window.location.reload();
      }
    });
  } catch (err) {
    console.warn('Service worker registration failed', err);
  }
}

els.lookupBtn?.addEventListener('click', () => lookup());
els.barcodeInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
els.lotInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
els.expiryInput?.addEventListener('change', () => { if (els.barcodeInput.value) lookup(); });
els.startScanBtn?.addEventListener('click', startScanner);
els.stopScanBtn?.addEventListener('click', stopScanner);
els.startLiveTextBtn?.addEventListener('click', startTextOnlyScanner);
els.clearOcrBtn?.addEventListener('click', clearOcr);
els.refreshDataBtn?.addEventListener('click', async () => {
  try {
    const status = await loadData({ force: true, allowSnapshot: true });
    if (status.source === 'snapshot') {
      showResult('neutral', '舊資料', '?', '新版資料讀取失敗', '已先使用上次成功資料；可以繼續查詢但請稍後再更新。');
    } else {
      showResult('neutral', '已更新', '↻', '資料已重新整理', '請重新掃描或查詢。');
    }
  } catch (err) {
    console.error(err);
    showResult('neutral', '無資料', '?', '資料更新失敗', '找不到 recalls.json，請檢查部署路徑。');
  }
});

window.addEventListener('pageshow', () => {
  loadData({ force: true, allowSnapshot: true }).catch((err) => {
    console.error(err);
    showResult('neutral', '無資料', '?', '資料讀取失敗', '請確認 data/recalls.json 有上傳到網站根目錄。');
  });
});
window.addEventListener('pagehide', stopScanner);
registerServiceWorker();

// Minimal hooks for local simulation tests. Not shown in the UI.
window.__FoodSafetyAppTest = { state, evaluate, lookup, parseScannedPayload, parseOcrText, normalizeGtin, loadData };
