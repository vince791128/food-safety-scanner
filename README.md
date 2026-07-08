# 食安掃描警示｜瀏覽器版 PWA v4 Live Scan

這是一個只需瀏覽器網址即可使用的食安掃描工具原型，設計給朋友私下使用，不需要上架 App Store / Google Play。

## v4 重點

- 開啟相機後進入「連續掃描模式」。
- 鏡頭掃到商品條碼後，立即顯示紅／綠／黃／灰結果。
- 若同品項曾受影響但缺批號或有效日期，使用者不用拍照，只要把同一個鏡頭移到包裝印字處。
- 系統會每隔數秒讀取鏡頭畫面，用 OCR 自動辨識 EXP、有效日期、Best Before、Lot No.、批號。
- OCR 辨識到資料後會自動填入欄位並重新比對。
- 若掃到 GS1-128 / DataMatrix / QR 且包含 AI `01`、`10`、`15`、`17`，會自動解析 GTIN、批號、最佳賞味日／有效日期。
- 重整瀏覽器或按「立即更新」會重新抓取 `data/recalls.json`。

## 使用方式

### 本機測試

```bash
python3 -m http.server 8080
```

開啟：

```text
http://localhost:8080
```

### 給朋友使用

建議部署到 Netlify Drop、GitHub Pages 或 Cloudflare Pages，取得 HTTPS 網址後傳給朋友。

相機掃描需要 HTTPS 或 localhost。若朋友從 LINE 內建瀏覽器開啟相機失敗，請改用 Safari、Chrome 或 Edge。

## 資料更新

正式資料請更新：

```text
data/recalls.json
```

建議政策：

```text
每日 07:00 Asia/Taipei 固定更新
食安事件期間每日 15:10 Asia/Taipei 補更新
```

## 注意

本工具不得把「未命中」寫成「絕對安全」。正確文案應保留：

```text
目前公開資料未列入此條碼／批號；資料仍可能滾動更新，請以官方最新公告為準。
```
