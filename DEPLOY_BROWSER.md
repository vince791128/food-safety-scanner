# 瀏覽器版部署說明

## 最快方式：Netlify Drop

1. 解壓縮 ZIP。
2. 將 `food_safety_scanner_app` 整個資料夾拖到 Netlify Drop。
3. Netlify 會產生 HTTPS 網址。
4. 把網址傳給朋友。

## 為什麼需要 HTTPS

此工具使用手機相機連續掃描條碼與包裝文字。多數行動瀏覽器要求相機 API 必須在 HTTPS 或 localhost 等安全環境下使用。

## 更新資料

只要更新部署中的：

```text
data/recalls.json
```

朋友重新整理瀏覽器，或按 App 內的「立即更新」，就會強制重新抓最新版資料。

## 隱私

v4 的即時 OCR 在瀏覽器端從相機畫面擷取 frame 辨識；此原型不把照片或影像上傳到你的伺服器。
