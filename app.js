const APP_VERSION = 'browser-pwa-v6-step-scan-simple';
const LOCAL_SNAPSHOT_KEY = 'foodSafetyRecallsSnapshotV2';

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
  stoppedBecauseFail: false,
  lastMatchedBy: '',
};

const $ = (id) => document.getElementById(id);
const els = {
  dataStrip: $('dataStrip'),
  dataFreshness: $('dataFreshness'),
  sourceSummary: $('sourceSummary'),
  refreshDataBtn: $('refreshDataBtn'),
  startScanBtn: $('startScanBtn'),
  stopScanBtn: $('stopScanBtn'),
  preview: $('preview'),
  liveOcrStatus: $('liveOcrStatus'),
  liveOcrHint: $('liveOcrHint'),
  nextAction: $('nextAction'),
  stepBarcode: $('stepBarcode'),
  stepName: $('stepName'),
  stepBatch: $('stepBatch'),
  barcodeInput: $('barcodeInput'),
  nameInput: $('nameInput'),
  lotInput: $('lotInput'),
  expiryInput: $('expiryInput'),
  lookupBtn: $('lookupBtn'),
  result: $('result'),
  resultWord: $('resultWord'),
  resultTitle: $('resultTitle'),
  resultMessage: $('resultMessage'),
  detailsList: $('detailsList'),
  sourceBox: $('sourceBox'),
  sampleList: $('sampleList'),
  clearOcrBtn: $('clearOcrBtn'),
  clearAllBtn: $('clearAllBtn'),
  ocrText: $('ocrText'),
};

function buildDataUrls() {
  const base = new URL('.', window.location.href);
  const origin = window.location.origin;
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const repoBase = pathParts.length ? `${origin}/${pathParts[0]}/` : `${origin}/`;
  const candidates = [
    new URL('data/recalls.json', base).href,
    new URL('recalls.json', base).href,
    `${repoBase}data/recalls.json`,
    `${repoBase}recalls.json`,
    `${origin}/data/recalls.json`,
    `${origin}/recalls.json`,
    `${repoBase}github_pages_upload_ready/data/recalls.json`,
    `${repoBase}food_safety_scanner_app/data/recalls.json`,
  ];
  return [...new Set(candidates)];
}

async function loadData({ force = false, allowSnapshot = true } = {}) {
  setRefreshState(true);
  setDataStrip('loading', '資料更新中', '正在抓取最新資料…');
  if (force && state.serviceWorkerRegistration) await state.serviceWorkerRegistration.update().catch(() => null);
  try {
    const data = await fetchFreshData(force);
    state.recalls = data;
    saveSnapshot(data);
    renderFreshness('fresh');
    renderSamples();
    setRefreshState(false);
    lookup();
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
        lookup();
        return { ok: true, source: 'snapshot' };
      }
    }
    setRefreshState(false);
    setDataStrip('error', '資料讀取失敗', String(networkError.message || networkError).slice(0, 180));
    throw networkError;
  }
}

async function fetchFreshData(force) {
  const attempts = [];
  for (const baseUrl of buildDataUrls()) {
    for (const url of [`${baseUrl}?v=${encodeURIComponent(APP_VERSION)}&t=${Date.now()}`, baseUrl]) {
      try {
        const response = await fetch(url, {
          cache: force ? 'reload' : 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const normalized = normalizeRecallData(data);
        validateRecallData(normalized);
        window.__lastRecallDataUrl = baseUrl;
        return normalized;
      } catch (err) {
        attempts.push(`${url} → ${err.message}`);
      }
    }
  }
  throw new Error(`資料讀取失敗：${attempts.join(' | ')}`);
}

function normalizeRecallData(data) {
  if (data && data.metadata && Array.isArray(data.products)) return data;
  if (Array.isArray(data)) return { metadata: fallbackMetadata(), products: data };
  const list = data?.items || data?.data || data?.records;
  if (Array.isArray(list)) return { metadata: data.metadata || fallbackMetadata(data), products: list };
  return data;
}

function fallbackMetadata(data = {}) {
  return {
    event_name: data.event_name || '自訂食安清單',
    last_updated_at: data.last_updated_at || new Date().toISOString(),
    official_update_policy: '由 GitHub recalls.json 更新',
    sources: data.sources || [],
    disclaimer: '自訂 JSON 已自動轉換。'
  };
}

function validateRecallData(data) {
  if (!data || !data.metadata || !Array.isArray(data.products)) {
    throw new Error('recalls.json 格式錯誤：根層需包含 metadata 與 products 陣列，或直接提供產品陣列。');
  }
}

function saveSnapshot(data) {
  try { localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify({ saved_at: new Date().toISOString(), data })); }
  catch (err) { console.warn('Snapshot save failed', err); }
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
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
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
      clearAll({ keepResult: true });
      setFieldValue(els.barcodeInput, btn.dataset.barcode);
      lookup();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function normalize(value) { return String(value || '').trim(); }
function normalizeLot(value) { return normalize(value).toUpperCase().replace(/\s+/g, ''); }
function normalizeGtin(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 14 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}
function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\u3000\-_/\\|:：;；,，.。()（）\[\]【】{}]/g, '')
    .replace(/臺/g, '台');
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
  const y = Number(year); const m = Number(month); const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function sameDate(inputDate, affectedDate) { return Boolean(inputDate && affectedDate && inputDate === affectedDate); }

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
  if (result.type === 'fail' && state.controls) {
    window.setTimeout(() => stopScanner('已判定不合格，掃描自動停止。'), 350);
  }
  return result;
}

function evaluate(scannedCode = null) {
  if (!state.recalls) return makeResult('neutral', '無資料', '?', '資料尚未載入', '請先按更新，或確認 recalls.json 已部署。');

  const parsed = scannedCode ? parseScannedPayload(scannedCode) : {};
  if (parsed.lot) setFieldValue(els.lotInput, parsed.lot);
  if (parsed.expiryDate) setFieldValue(els.expiryInput, parsed.expiryDate);

  const barcode = normalize(parsed.gtin || scannedCode || els.barcodeInput.value);
  if (scannedCode || parsed.gtin) setFieldValue(els.barcodeInput, barcode);
  const lot = normalizeLot(els.lotInput.value);
  const expiry = normalizeDateString(els.expiryInput.value) || normalize(els.expiryInput.value);
  const nameText = normalize(els.nameInput.value);

  const barcodeProduct = barcode ? findProductByBarcode(barcode) : null;
  const nameMatch = nameText ? findProductByName(nameText) : null;
  const product = barcodeProduct || nameMatch?.product || null;
  const matchedBy = barcodeProduct ? 'barcode' : (nameMatch ? 'name' : '');
  state.lastMatchedBy = matchedBy;

  const details = { barcode, nameText, lot, expiry, product, matchedBy, scannedPayload: scannedCode, parsed };

  if (!barcode && !nameText && !lot && !expiry) {
    return makeResult('neutral', '待掃描', '?', '請掃商品條碼', '按「一鍵開始掃描」，先對準條碼。', details, '請先掃商品條碼');
  }

  if (!product) {
    return makeResult('neutral', '無資料', '?', '資料庫未收錄', '目前資料庫沒有命中；不代表安全，可繼續掃品名與效期。', details, barcode ? '請掃包裝正面品名' : '請先掃商品條碼');
  }

  const batches = product.affected_batches || [];
  const allBatch = batches.find((batch) => batch.affects_all === true || (!normalizeLot(batch.lot_no) && !batch.expiry_date));
  if (allBatch) {
    details.matchedBatch = allBatch;
    return makeResult('fail', '不合格', '!', '此品項全批次列入', '請勿食用，保留包裝並依官方或通路公告處理。', details, '已完成，不用繼續掃描');
  }

  const matchedBatch = batches.find((batch) => batchMatches(batch, lot, expiry));
  if (matchedBatch) {
    details.matchedBatch = matchedBatch;
    return makeResult('fail', '不合格', '!', '命中受影響產品', '請勿食用，保留包裝並依官方或通路公告處理。', details, '已完成，不用繼續掃描');
  }

  const needsBatch = batches.length > 0 && !lot && !expiry;
  if (needsBatch) {
    return makeResult('warn', '需確認', '!', '同品項曾受影響', '請把鏡頭移到有效日期或批號；讀到後會自動更新。', details, '請掃效期或批號');
  }

  if (batches.length === 0) {
    return makeResult('pass', '合格', '✓', '目前未列入受影響清單', '以目前資料庫比對，這個品項未列入受影響資料。', details, '已完成');
  }

  return makeResult('pass', '合格', '✓', '此批號／效期目前未命中', '請肉眼確認日期與批號辨識正確；無資料仍以官方公告為準。', details, '已完成');
}

function batchMatches(batch, lot, expiry) {
  const batchLot = normalizeLot(batch.lot_no);
  const batchExpiry = normalizeDateString(batch.expiry_date) || batch.expiry_date;
  const lotMatched = batchLot ? lot === batchLot : false;
  const expiryMatched = batchExpiry ? sameDate(expiry, batchExpiry) : false;
  if (batchLot && batchExpiry) return Boolean(lotMatched && expiryMatched);
  return Boolean(lotMatched || expiryMatched);
}

function findProductByBarcode(barcode) {
  const normalized = normalizeGtin(barcode);
  return state.recalls.products.find((p) => normalizeGtin(p.barcode_gtin) === normalized) || null;
}

function findProductByName(text) {
  const hay = normalizeSearchText(text);
  if (!hay) return null;
  let best = null;
  for (const product of state.recalls.products) {
    const keywords = buildProductKeywords(product);
    let score = 0;
    const fullName = normalizeSearchText(product.product_name);
    if (fullName && hay.includes(fullName)) score += 8;
    for (const keyword of keywords) {
      const k = normalizeSearchText(keyword);
      if (k && hay.includes(k)) score += Math.min(4, Math.max(1, Math.ceil(k.length / 3)));
    }
    if (!best || score > best.score) best = { product, score, keywords };
  }
  return best && best.score >= 4 ? best : null;
}

function buildProductKeywords(product) {
  const base = [product.company_name, product.brand_name, product.product_name, product.category];
  const aliases = product.product_name_aliases || product.keywords || [];
  return [...base, ...aliases].filter(Boolean);
}

function makeResult(type, word, icon, title, message, details = {}, next = '') {
  return { type, word, icon, title, message, details, next };
}

function renderEvaluation(result) {
  showResult(result.type, result.word, result.icon, result.title, result.message);
  renderSteps(result);
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

function renderSteps(result) {
  const d = result.details || {};
  const barcodeDone = Boolean(d.barcode);
  const nameDone = Boolean(d.nameText || (d.product && d.matchedBy === 'barcode'));
  const batchDone = Boolean(d.lot || d.expiry);
  updateStep(els.stepBarcode, barcodeDone, !barcodeDone && result.type !== 'fail');
  updateStep(els.stepName, nameDone, barcodeDone && !nameDone && result.type !== 'fail');
  updateStep(els.stepBatch, batchDone, (d.product && !batchDone && result.type === 'warn'));
  if (result.type === 'fail') {
    [els.stepBarcode, els.stepName, els.stepBatch].forEach((el) => el?.classList.add('blocked'));
  }
  els.nextAction.textContent = result.next || '請依畫面提示掃描';
}

function updateStep(el, done, current) {
  if (!el) return;
  el.classList.remove('done', 'current', 'blocked');
  if (done) el.classList.add('done');
  else if (current) el.classList.add('current');
  const small = el.querySelector('small');
  const num = el.querySelector('span');
  if (done) { small.textContent = '已掃'; num.textContent = '✓'; }
  else { small.textContent = current ? '請掃' : '未掃'; num.textContent = el.id === 'stepBarcode' ? '1' : el.id === 'stepName' ? '2' : '3'; }
}

function updateScanHint(result) {
  if (!els.liveOcrStatus || !els.liveOcrHint) return;
  if (result.type === 'fail') {
    els.liveOcrStatus.textContent = '已命中不合格';
    els.liveOcrHint.textContent = '已不需繼續掃描。請停止食用並保留包裝。';
  } else if (result.type === 'pass') {
    els.liveOcrStatus.textContent = '目前顯示合格';
    els.liveOcrHint.textContent = '若 OCR 可能誤讀，請打開手動修正確認。';
  } else if (result.type === 'warn') {
    els.liveOcrStatus.textContent = '還缺效期或批號';
    els.liveOcrHint.textContent = '不用拍照，直接把鏡頭移到包裝印字處。';
  } else {
    els.liveOcrStatus.textContent = '等待掃描';
    els.liveOcrHint.textContent = '掃條碼；若無資料，再掃品名與效期。';
  }
}

function renderDetails({ barcode, nameText, lot, expiry, product, matchedBatch, matchedBy, scannedPayload } = {}) {
  if (!els.detailsList || !state.recalls) return;
  const rows = [
    ['條碼', barcode || '未取得'],
    ['品名文字', nameText || '未取得'],
    ['批號', lot || '未取得'],
    ['有效日期', expiry || '未取得'],
    ['命中方式', matchedBy || '未命中'],
  ];
  if (scannedPayload && scannedPayload !== barcode) rows.push(['原始掃描內容', scannedPayload]);
  if (product) {
    rows.push(
      ['公司／品牌', `${product.company_name || ''}｜${product.brand_name || ''}`],
      ['產品名稱', product.product_name || ''],
      ['受影響批次', product.affected_batches?.length ? product.affected_batches.map((b) => `${b.lot_no || '未列批號'} / ${b.expiry_date || '未列效期'}`).join('；') : '目前未列入'],
      ['命中批次', matchedBatch ? `${matchedBatch.lot_no || '未列批號'} / ${matchedBatch.expiry_date || '未列效期'}` : '未命中']
    );
  }
  els.detailsList.innerHTML = rows.map(([key, val]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(val)}</dd>`).join('');
  const sources = (product?.source_urls?.length ? product.source_urls : state.recalls.metadata.sources || []).map((source) => `<li>${escapeHtml(source)}</li>`).join('');
  els.sourceBox.innerHTML = `<strong>資料來源</strong><ul>${sources}</ul><p>${escapeHtml(product?.source_note || state.recalls.metadata.disclaimer || '')}</p>`;
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
  if (!result.gtin && /^\d{8,14}$/.test(normalized.replace(/\D/g, ''))) result.gtin = normalizeGtin(normalized.replace(/\D/g, ''));
  return result;
}

function aiDateToIso(value) {
  const v = String(value || '').replace(/\D/g, '');
  if (v.length !== 6) return '';
  return toIsoDate(String(2000 + Number(v.slice(0, 2))), v.slice(2, 4), v.slice(4, 6));
}
function cleanLot(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9\-\.]/g, '').slice(0, 24); }

async function startScanner() {
  if (!window.ZXingBrowser) {
    els.liveOcrStatus.textContent = '掃描套件載入失敗';
    els.liveOcrHint.textContent = '請改用手動輸入，或確認網路可連到 CDN。';
    return;
  }
  try {
    state.stoppedBecauseFail = false;
    state.codeReader = new ZXingBrowser.BrowserMultiFormatReader();
    els.startScanBtn.disabled = true;
    els.stopScanBtn.disabled = false;
    els.liveOcrStatus.textContent = '掃描中';
    els.liveOcrHint.textContent = '先對準條碼；若無資料，再掃品名與效期。';
    startLiveOcrLoop();
    state.controls = await state.codeReader.decodeFromVideoDevice(undefined, els.preview, (result) => {
      if (!result) return;
      handleBarcodeDetected(result.getText());
    });
  } catch (err) {
    console.error(err);
    showResult('neutral', '無法掃', '?', '相機無法開啟', '請確認 HTTPS、相機權限，或改用手動查詢。');
    els.liveOcrStatus.textContent = '相機無法使用';
    els.liveOcrHint.textContent = 'LINE 內建瀏覽器可能失敗，請改用 Safari / Chrome。';
    els.startScanBtn.disabled = false;
    els.stopScanBtn.disabled = true;
    stopLiveOcrLoop();
  }
}

function handleBarcodeDetected(code) {
  const now = Date.now();
  if (state.lastScannedCode === code && now - state.lastScanAt < 2500) return;
  state.lastScannedCode = code;
  state.lastScanAt = now;
  lookup(code);
}

function stopScanner(message = '掃描已停止') {
  stopLiveOcrLoop();
  if (state.controls) {
    state.controls.stop();
    state.controls = null;
  }
  els.startScanBtn.disabled = false;
  els.stopScanBtn.disabled = true;
  els.liveOcrStatus.textContent = message;
  if (message.includes('不合格')) els.liveOcrHint.textContent = '不用繼續掃描。';
  else els.liveOcrHint.textContent = '可重新開始掃描或手動查詢。';
}

function startLiveOcrLoop() {
  if (state.liveOcrEnabled) return;
  state.liveOcrEnabled = true;
  if (state.liveOcrTimer) window.clearInterval(state.liveOcrTimer);
  state.liveOcrTimer = window.setInterval(runLiveOcrIfNeeded, 2200);
}
function stopLiveOcrLoop() {
  state.liveOcrEnabled = false;
  state.liveOcrInProgress = false;
  if (state.liveOcrTimer) window.clearInterval(state.liveOcrTimer);
  state.liveOcrTimer = null;
}

async function runLiveOcrIfNeeded() {
  if (!state.liveOcrEnabled || state.liveOcrInProgress || !window.Tesseract) return;
  if (!els.preview?.videoWidth || !els.preview?.videoHeight) return;
  const current = evaluate();
  if (current.type === 'fail') return;
  const d = current.details || {};
  const missingUsefulInfo = !d.nameText || !d.lot || !d.expiry || current.type === 'neutral' || current.type === 'warn';
  if (!missingUsefulInfo) return;
  const now = Date.now();
  if (now - state.liveOcrLastRunAt < 3600) return;
  state.liveOcrLastRunAt = now;
  state.liveOcrInProgress = true;
  els.liveOcrStatus.textContent = '正在讀包裝文字';
  try {
    const canvas = captureVideoFrameForOcr();
    if (!canvas) return;
    const result = await window.Tesseract.recognize(canvas, 'chi_tra+eng');
    const text = result?.data?.text || '';
    if (els.ocrText) els.ocrText.textContent = text.trim() || '沒有讀到清楚文字';
    const parsed = parseOcrText(text);
    applyParsedOcr(parsed, text);
  } catch (err) {
    console.warn('Live OCR failed', err);
    els.liveOcrStatus.textContent = '文字辨識失敗';
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
  const cropH = Math.floor(sourceH * 0.68);
  const cropX = Math.floor((sourceW - cropW) / 2);
  const cropY = Math.floor((sourceH - cropH) / 2);
  const canvas = document.createElement('canvas');
  const targetW = 1200;
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
    data[i] = boosted; data[i + 1] = boosted; data[i + 2] = boosted;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function applyParsedOcr(parsed, originalText = '') {
  const changed = [];
  const combinedText = [els.nameInput.value, parsed.productText, originalText].filter(Boolean).join(' ');
  const nameMatch = findProductByName(combinedText);
  if (nameMatch && !els.nameInput.value) {
    setFieldValue(els.nameInput, nameMatch.product.product_name);
    changed.push(`品名 ${nameMatch.product.product_name}`);
  } else if (!els.nameInput.value && parsed.productText) {
    setFieldValue(els.nameInput, parsed.productText.slice(0, 60));
    changed.push('品名文字');
  }
  if (parsed.expiryDate && !els.expiryInput.value) { setFieldValue(els.expiryInput, parsed.expiryDate); changed.push(`有效日期 ${parsed.expiryDate}`); }
  if (parsed.lot && !els.lotInput.value) { setFieldValue(els.lotInput, parsed.lot); changed.push(`批號 ${parsed.lot}`); }
  if (changed.length) {
    els.liveOcrStatus.textContent = '已讀到資料';
    els.liveOcrHint.textContent = changed.join('、');
    lookup();
  } else {
    els.liveOcrStatus.textContent = '尚未讀到足夠資料';
    els.liveOcrHint.textContent = '請把品名、效期或批號移到框線中央，保持 1–2 秒。';
  }
}

function parseOcrText(text) {
  const raw = String(text || '');
  const compact = raw
    .replace(/[ＯO]/g, '0').replace(/[ＩIl|]/g, '1').replace(/[ＳS]/g, '5').replace(/[ＢB]/g, '8')
    .replace(/[：]/g, ':').toUpperCase();
  const result = { productText: raw.replace(/\s+/g, ' ').trim() };
  const datePatterns = [
    /(?:EXP|EXPIRY|USE BY|BEST BEFORE|BEST BY|VALID|DATE|BB|有效|效期|期限|保存期限)[^0-9]{0,12}(20\d{2})[\.\/\-年 ]?(\d{1,2})[\.\/\-月 ]?(\d{1,2})/i,
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
    /(\d{3}-\d{6,10})/,
    /([A-Z]\d{6,10}[A-Z]?)/i,
    /([A-Z]{1,3}\d{4,10})/i,
  ];
  for (const pattern of lotPatterns) {
    const m = compact.match(pattern);
    if (!m) continue;
    const candidate = cleanLot(m[1]);
    if (candidate && !looksLikeDateOnly(candidate)) { result.lot = candidate; break; }
  }
  return result;
}
function looksLikeDateOnly(value) { const digits = String(value || '').replace(/\D/g, ''); return digits.length === 6 || digits.length === 8; }

function clearOcr() {
  els.lotInput.value = '';
  els.expiryInput.value = '';
  if (els.ocrText) els.ocrText.textContent = '尚無文字';
  lookup();
}
function clearAll({ keepResult = false } = {}) {
  els.barcodeInput.value = ''; els.nameInput.value = ''; els.lotInput.value = ''; els.expiryInput.value = '';
  if (els.ocrText) els.ocrText.textContent = '尚無文字';
  state.lastScannedCode = ''; state.lastScanAt = 0; state.lastMatchedBy = '';
  if (!keepResult) lookup();
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
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
        if (worker.state === 'installed' && navigator.serviceWorker.controller) worker.postMessage({ type: 'SKIP_WAITING' });
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!window.__swReloaded) { window.__swReloaded = true; window.location.reload(); }
    });
  } catch (err) { console.warn('Service worker registration failed', err); }
}

els.lookupBtn?.addEventListener('click', () => lookup());
els.barcodeInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
els.nameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
els.lotInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
els.expiryInput?.addEventListener('change', () => lookup());
els.startScanBtn?.addEventListener('click', startScanner);
els.stopScanBtn?.addEventListener('click', () => stopScanner());
els.clearOcrBtn?.addEventListener('click', clearOcr);
els.clearAllBtn?.addEventListener('click', () => clearAll());
els.refreshDataBtn?.addEventListener('click', async () => {
  try {
    const status = await loadData({ force: true, allowSnapshot: true });
    if (status.source === 'snapshot') showResult('neutral', '舊資料', '?', '新版資料讀取失敗', '已先使用上次成功資料；可以繼續查詢但請稍後再更新。');
    else showResult('neutral', '已更新', '↻', '資料已重新整理', '請重新掃描或查詢。');
  } catch (err) {
    console.error(err);
    showResult('neutral', '無資料', '?', '資料更新失敗', String(err.message || err).slice(0, 120));
  }
});

window.addEventListener('pageshow', () => {
  loadData({ force: true, allowSnapshot: true }).catch((err) => {
    console.error(err);
    showResult('neutral', '無資料', '?', '資料讀取失敗', String(err.message || err).slice(0, 120));
  });
});
window.addEventListener('pagehide', () => stopScanner());
registerServiceWorker();
window.__FoodSafetyAppTest = { state, evaluate, lookup, parseScannedPayload, parseOcrText, normalizeGtin, normalizeSearchText, findProductByName, loadData };
