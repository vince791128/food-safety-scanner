const APP_VERSION = 'browser-pwa-uiux-v4-live-scan';

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
  liveOcrStableText: '',
  liveOcrStableCount: 0,
};

const $ = (id) => document.getElementById(id);
const els = {
  dataFreshness: $('dataFreshness'),
  sourceSummary: $('sourceSummary'),
  refreshDataBtn: $('refreshDataBtn'),
  startScanBtn: $('startScanBtn'),
  stopScanBtn: $('stopScanBtn'),
  startLiveTextBtn: $('startLiveTextBtn'),
  preview: $('preview'),
  scannerHint: $('scannerHint'),
  liveOcrPanel: $('liveOcrPanel'),
  liveOcrBadge: $('liveOcrBadge'),
  liveOcrStatus: $('liveOcrStatus'),
  liveOcrHint: $('liveOcrHint'),
  barcodeInput: $('barcodeInput'),
  lotInput: $('lotInput'),
  expiryInput: $('expiryInput'),
  lookupBtn: $('lookupBtn'),
  result: $('result'),
  resultKicker: $('resultKicker'),
  resultTitle: $('resultTitle'),
  resultMessage: $('resultMessage'),
  actionList: $('actionList'),
  detailsCard: $('detailsCard'),
  detailsList: $('detailsList'),
  sourceBox: $('sourceBox'),
  sampleList: $('sampleList'),
  clearOcrBtn: $('clearOcrBtn'),
  ocrPreview: $('ocrPreview'),
  ocrStatus: $('ocrStatus'),
  ocrHint: $('ocrHint'),
  ocrText: $('ocrText'),
};

async function loadData({ force = false } = {}) {
  setRefreshState(true);

  if (force && state.serviceWorkerRegistration) {
    await state.serviceWorkerRegistration.update().catch(() => null);
  }

  const cacheBuster = force ? `?t=${Date.now()}` : `?v=${APP_VERSION}&t=${Date.now()}`;
  const response = await fetch(`./data/recalls.json${cacheBuster}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw new Error('資料讀取失敗');
  state.recalls = await response.json();
  renderFreshness();
  renderSamples();
  setRefreshState(false);
}

function setRefreshState(isUpdating) {
  if (!els.refreshDataBtn) return;
  els.refreshDataBtn.disabled = isUpdating;
  els.refreshDataBtn.classList.toggle('updating', isUpdating);
  els.refreshDataBtn.textContent = isUpdating ? '更新中…' : '立即更新';
}

function renderFreshness() {
  const updated = new Date(state.recalls.metadata.last_updated_at);
  const now = new Date();
  const hoursOld = Math.round((now - updated) / 36e5);
  const formatted = updated.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  els.dataFreshness.textContent = hoursOld > 24 ? `資料可能過舊｜${formatted}` : `已更新｜${formatted}`;
  els.sourceSummary.textContent = state.recalls.metadata.official_update_policy || '每日 07:00 更新；事件期間 15:10 補更新';
}

function renderSamples() {
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
  window.setTimeout(() => input.classList.remove('autofilled'), 1800);
  return true;
}

function lookup(scannedCode = null) {
  if (!state.recalls) {
    showResult('neutral', '?', '資料尚未載入', '請先更新資料後再查詢。', ['按「立即更新」重新抓取資料。']);
    return;
  }

  const parsed = scannedCode ? parseScannedPayload(scannedCode) : {};
  if (parsed.lot) setFieldValue(els.lotInput, parsed.lot);
  if (parsed.expiryDate) setFieldValue(els.expiryInput, parsed.expiryDate);

  const barcode = normalize(parsed.gtin || scannedCode || els.barcodeInput.value);
  if (scannedCode || parsed.gtin) setFieldValue(els.barcodeInput, barcode);

  const lot = normalizeLot(els.lotInput.value);
  const expiry = normalize(els.expiryInput.value);

  if (!barcode) {
    showResult('neutral', '?', '請先掃條碼', '請掃描或輸入產品條碼後再查詢。沒有條碼無法精準比對品項。', ['找不到條碼時，可用產品名稱人工核對官方公告。']);
    setLiveOcrStatus('idle', '等待條碼', '先讓鏡頭掃到商品條碼；掃到後會自動開始讀效期／批號。');
    return;
  }

  const product = state.recalls.products.find((p) => p.barcode_gtin === barcode || normalizeGtin(p.barcode_gtin) === normalizeGtin(barcode));

  if (!product) {
    showResult(
      'neutral',
      '?',
      '資料庫未收錄',
      '目前公開資料未列入此條碼。這不等於絕對安全，請再核對品名、批號與有效日期。',
      ['確認是否掃到外箱條碼或商品條碼。', '若品名相近，請改用官方清單人工核對。']
    );
    setLiveOcrStatus('idle', '條碼未收錄', '目前不需要讀效期；請先確認掃到的是商品條碼。');
    renderDetails({ barcode, lot, expiry, scannedPayload: scannedCode, parsed });
    return;
  }

  const hasAffectedBatches = product.affected_batches?.length > 0;

  if (!hasAffectedBatches) {
    showResult(
      'pass',
      '✓',
      '合格｜目前未列入受影響清單',
      '此資料庫中未列入受影響批次。正式版仍須以官方最新資料為準。',
      ['仍建議確認產品品名、批號與有效日期是否輸入或辨識正確。']
    );
    setLiveOcrStatus('success', '目前不需補資料', '此品項未列受影響批次；若仍想確認，可手動修正欄位後再查。');
    renderDetails({ barcode, lot, expiry, product, scannedPayload: scannedCode, parsed });
    return;
  }

  const matchedBatch = product.affected_batches.find((batch) => {
    const batchLot = normalizeLot(batch.lot_no);
    const lotMatched = batchLot ? lot === batchLot : false;
    const expiryMatched = sameDate(expiry, batch.expiry_date);
    if (batchLot && batch.expiry_date) return lotMatched && expiryMatched;
    return lotMatched || expiryMatched;
  });

  if (matchedBatch) {
    showResult(
      'fail',
      '!',
      '不合格｜受影響產品',
      '此條碼與批號／有效日期已命中受影響資料。請勿食用。',
      ['停止食用並保留完整包裝。', '截圖或拍照保存條碼、批號、有效日期。', '依官方或原購買通路公告辦理退貨／回收。']
    );
    setLiveOcrStatus('success', '已命中受影響批次', '請勿食用，建議保留包裝並依公告辦理。');
    renderDetails({ barcode, lot, expiry, product, matchedBatch, scannedPayload: scannedCode, parsed });
    return;
  }

  if (!lot && !expiry) {
    showResult(
      'warn',
      '!',
      '需掃效期／批號｜同品項曾受影響',
      '此條碼對應的品項曾列入事件相關資料，但尚未取得批號或有效日期。請不要關閉相機，把鏡頭移到包裝上的日期或批號印字處。',
      ['鏡頭讀到 EXP、有效日期、Lot No. 或批號後會自動帶入。', '不用按拍照；保持文字清楚、水平、靠近鏡頭即可。']
    );
    setLiveOcrStatus('working', '請對準效期／批號', '系統正在定時讀取鏡頭畫面；辨識到後會自動重新比對。');
    renderDetails({ barcode, lot, expiry, product, scannedPayload: scannedCode, parsed });
    return;
  }

  showResult(
    'pass',
    '✓',
    '合格｜此批號／效期目前未命中',
    '此條碼屬於曾受影響品項，但目前取得的批號／效期未命中受影響批次。',
    ['請再次確認即時 OCR 辨識無誤。', '資料仍可能更新，疑似產品仍建議保留包裝。']
  );
  setLiveOcrStatus('success', '已取得批號／效期', '目前未命中受影響批次；請肉眼再確認一次辨識內容。');
  renderDetails({ barcode, lot, expiry, product, scannedPayload: scannedCode, parsed });
}

function parseScannedPayload(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return {};

  const normalized = raw.replace(/\u001d/g, '\x1d').replace(/[\[\]{}]/g, '');
  const result = { raw };

  const parenthesized = normalized.match(/\((\d{2,4})\)/);
  if (parenthesized) {
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

function showResult(type, icon, title, message, actions = []) {
  els.result.className = `result-card ${type}`;
  els.result.querySelector('.result-icon').textContent = icon;
  const kickerMap = {
    pass: '目前未命中',
    fail: '立即注意',
    warn: '需要補充資訊',
    neutral: '尚無明確判斷',
  };
  els.resultKicker.textContent = kickerMap[type] || '查詢結果';
  els.resultTitle.textContent = title;
  els.resultMessage.textContent = message;
  els.actionList.innerHTML = actions.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderDetails({ barcode, lot, expiry, product, matchedBatch, scannedPayload, parsed }) {
  els.detailsCard.hidden = false;
  const rows = [
    ['掃描條碼', barcode || '未輸入'],
    ['批號來源', lot ? `${lot} ${parsed?.lot ? '（掃描／即時 OCR 自動帶入）' : ''}` : '未取得'],
    ['有效日期來源', expiry ? `${expiry} ${parsed?.expiryDate ? '（掃描／即時 OCR 自動帶入）' : ''}` : '未取得'],
  ];
  if (scannedPayload && scannedPayload !== barcode) {
    rows.push(['原始掃描內容', scannedPayload]);
  }
  if (product) {
    rows.push(
      ['公司／品牌', `${product.company_name}｜${product.brand_name}`],
      ['產品名稱', product.product_name],
      ['產品類別', product.category],
      ['受影響批次', product.affected_batches?.length ? product.affected_batches.map((b) => `${b.lot_no || '未列批號'} / ${b.expiry_date || '未列效期'}`).join('；') : '目前未列入'],
      ['命中批次', matchedBatch ? `${matchedBatch.lot_no || '未列批號'} / ${matchedBatch.expiry_date || '未列效期'}` : '未命中']
    );
  }

  els.detailsList.innerHTML = rows.map(([key, val]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(val)}</dd>`).join('');
  const sources = state.recalls.metadata.sources.map((source) => `<li>${escapeHtml(source)}</li>`).join('');
  els.sourceBox.innerHTML = `
    <strong>資料來源與警語</strong>
    <ul>${sources}</ul>
    <p>${escapeHtml(product?.source_note || state.recalls.metadata.disclaimer)}</p>
  `;
}

async function startScanner() {
  if (!window.ZXingBrowser) {
    els.scannerHint.textContent = '掃描套件載入失敗，請改用手動輸入。';
    return;
  }

  try {
    state.codeReader = new ZXingBrowser.BrowserMultiFormatReader();
    els.startScanBtn.disabled = true;
    els.stopScanBtn.disabled = false;
    if (els.startLiveTextBtn) els.startLiveTextBtn.disabled = true;
    els.scannerHint.textContent = '連續掃描中：先對準商品條碼；掃到後若需要批號／效期，直接把鏡頭移到包裝印字處。';
    setLiveOcrStatus('working', '相機已開啟', '正在等待條碼；掃到後會自動查詢。');
    startLiveOcrLoop();

    state.controls = await state.codeReader.decodeFromVideoDevice(
      undefined,
      els.preview,
      (result) => {
        if (!result) return;
        const code = result.getText();
        handleBarcodeDetected(code);
      }
    );
  } catch (err) {
    console.error(err);
    showResult('neutral', '?', '無法開啟相機', '請確認瀏覽器相機權限，或使用 HTTPS 網址開啟；也可以手動輸入條碼查詢。', ['iPhone 建議使用 Safari 或 Chrome。', '若朋友用 LINE 內建瀏覽器打不開相機，請改用外部瀏覽器。']);
    els.scannerHint.textContent = '相機無法使用，請改用手動輸入條碼。';
    els.startScanBtn.disabled = false;
    els.stopScanBtn.disabled = true;
    if (els.startLiveTextBtn) els.startLiveTextBtn.disabled = false;
    stopLiveOcrLoop();
  }
}

async function startTextOnlyScanner() {
  if (!els.barcodeInput.value) {
    showResult('warn', '!', '請先有條碼', '即時辨識效期／批號前，建議先掃條碼或手動輸入條碼。', ['若已手動輸入條碼，按查詢後再啟動即時辨識。']);
  }
  await startScanner();
}

function handleBarcodeDetected(code) {
  const now = Date.now();
  if (state.lastScannedCode === code && now - state.lastScanAt < 2500) return;
  state.lastScannedCode = code;
  state.lastScanAt = now;

  const parsed = parseScannedPayload(code);
  const label = parsed.gtin || normalizeGtin(code) || code;
  setLiveOcrStatus('working', `已掃到條碼 ${label}`, '若畫面顯示需要效期／批號，請把鏡頭移到包裝印字處，不用按拍照。');
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
  els.scannerHint.textContent = '掃描已停止。可重新開啟連續掃描，或用下方欄位手動修正。';
  setLiveOcrStatus('idle', '掃描已停止', '重新開啟後即可連續掃條碼與效期／批號。');
}

function startLiveOcrLoop() {
  if (state.liveOcrEnabled) return;
  state.liveOcrEnabled = true;
  if (state.liveOcrTimer) window.clearInterval(state.liveOcrTimer);
  state.liveOcrTimer = window.setInterval(runLiveOcrIfNeeded, 1700);
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
  if (!window.Tesseract) {
    setOcrState('failed', 'OCR 套件尚未載入', '請確認網路可連到 CDN，或改用手動修正。');
    return;
  }
  if (!els.preview?.videoWidth || !els.preview?.videoHeight) return;

  const barcode = normalize(els.barcodeInput.value);
  const missingLotOrDate = !normalize(els.lotInput.value) || !normalize(els.expiryInput.value);
  if (!barcode || !missingLotOrDate) return;

  const now = Date.now();
  if (now - state.liveOcrLastRunAt < 2800) return;
  state.liveOcrLastRunAt = now;
  state.liveOcrInProgress = true;

  setOcrState('working', '即時辨識中…', '請保持包裝印字清楚、水平、不要反光。');
  setLiveOcrStatus('working', '正在讀取畫面文字', '辨識到效期或批號後會自動帶入並重新比對。');

  try {
    const canvas = captureVideoFrameForOcr();
    if (!canvas) return;

    const result = await window.Tesseract.recognize(canvas, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          els.ocrStatus.textContent = `即時辨識中… ${pct}%`;
        }
      },
    });

    const text = result?.data?.text || '';
    els.ocrText.textContent = text.trim() || '沒有讀到清楚文字';
    const parsed = parseOcrText(text);
    applyParsedOcr(parsed, text);
  } catch (err) {
    console.warn('Live OCR failed', err);
    setOcrState('failed', '即時 OCR 失敗', '請讓文字更靠近鏡頭，或用下方欄位手動修正。');
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
  const cropH = Math.floor(sourceH * 0.66);
  const cropX = Math.floor((sourceW - cropW) / 2);
  const cropY = Math.floor((sourceH - cropH) / 2);
  const canvas = document.createElement('canvas');
  const targetW = 1100;
  const targetH = Math.round(targetW * cropH / cropW);
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);

  // Basic grayscale + contrast boost helps faint package prints without uploading images.
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

function applyParsedOcr(parsed, text) {
  const signature = `${parsed.expiryDate || ''}|${parsed.lot || ''}`;
  if (signature && signature === state.liveOcrStableText) state.liveOcrStableCount += 1;
  else {
    state.liveOcrStableText = signature;
    state.liveOcrStableCount = signature ? 1 : 0;
  }

  if (!parsed.expiryDate && !parsed.lot) {
    setOcrState('working', '尚未讀到效期／批號', '請把日期或批號移到框線中央，保持 1–2 秒。');
    return;
  }

  // Require one stable read. If both date and lot are present, apply immediately.
  const hasBoth = Boolean(parsed.expiryDate && parsed.lot);
  if (!hasBoth && state.liveOcrStableCount < 1) return;

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
    setOcrState('success', `已自動帶入：${changed.join('、')}`, '系統已用即時 OCR 結果重新比對；請肉眼確認一次。');
    setLiveOcrStatus('success', '已讀到效期／批號', '結果已更新。若辨識錯誤，可清除後重新掃。');
    if (els.barcodeInput.value) lookup();
  } else {
    setOcrState('success', '已讀到文字', '欄位已有資料；若要重新辨識，請先按「清除辨識」。');
  }
}

function parseOcrText(text) {
  const raw = String(text || '');
  const compact = raw
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

function setOcrState(type, status, hint) {
  const box = els.ocrStatus.closest('.ocr-status-box');
  box.classList.remove('working', 'success', 'failed');
  if (type) box.classList.add(type);
  els.ocrStatus.textContent = status;
  els.ocrHint.textContent = hint;
}

function setLiveOcrStatus(type, status, hint) {
  if (!els.liveOcrPanel) return;
  els.liveOcrPanel.classList.remove('idle', 'working', 'success', 'failed');
  els.liveOcrPanel.classList.add(type || 'idle');
  els.liveOcrBadge.textContent = type === 'success' ? '已讀取' : type === 'working' ? '掃描中' : type === 'failed' ? '注意' : '待命';
  els.liveOcrStatus.textContent = status;
  els.liveOcrHint.textContent = hint;
  if (els.ocrPreview) {
    els.ocrPreview.textContent = `${els.liveOcrBadge.textContent}｜${status}`;
  }
}

function clearOcr() {
  els.lotInput.value = '';
  els.expiryInput.value = '';
  els.ocrText.textContent = '尚無文字';
  state.liveOcrStableText = '';
  state.liveOcrStableCount = 0;
  setOcrState('', '待命', '請讓日期與批號水平、清楚、充滿畫面。即時 OCR 可能誤讀，紅色命中前仍建議肉眼確認。');
  setLiveOcrStatus('working', '已清除，等待重新辨識', '把鏡頭對準有效日期或批號印字處。');
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

els.lookupBtn.addEventListener('click', () => lookup());
els.barcodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
els.lotInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
els.expiryInput.addEventListener('change', () => { if (els.barcodeInput.value) lookup(); });
els.startScanBtn.addEventListener('click', startScanner);
els.stopScanBtn.addEventListener('click', stopScanner);
if (els.startLiveTextBtn) els.startLiveTextBtn.addEventListener('click', startTextOnlyScanner);
els.clearOcrBtn.addEventListener('click', clearOcr);
els.refreshDataBtn.addEventListener('click', async () => {
  try {
    await loadData({ force: true });
    showResult('neutral', '↻', '資料已重新整理', '已重新抓取最新 recalls.json。請重新掃描或查詢產品。', ['若後台已更新資料，重新整理後會立即反映。']);
  } catch (err) {
    console.error(err);
    setRefreshState(false);
    showResult('neutral', '?', '資料更新失敗', '請確認網路連線，或稍後重新整理瀏覽器。', ['若網站剛部署，請等待主機完成發布後再試。']);
  }
});

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

window.addEventListener('pageshow', () => {
  loadData({ force: true }).catch((err) => {
    console.error(err);
    setRefreshState(false);
    showResult('neutral', '?', '資料讀取失敗', '請確認 data/recalls.json 是否存在，或稍後重新整理。', ['若是手機相機問題，仍可手動輸入條碼。']);
    els.dataFreshness.textContent = '資料讀取失敗';
  });
});

window.addEventListener('pagehide', stopScanner);
registerServiceWorker();
