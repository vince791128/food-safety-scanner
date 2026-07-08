# GitHub Pages 部署注意事項

## 正確檔案結構

`index.html` 必須在 repository 根目錄：

```text
food-safety-scanner/
├── index.html
├── styles.css
├── app.js
├── service-worker.js
├── manifest.json
├── data/recalls.json
└── assets/icon.svg
```

不要變成：

```text
food-safety-scanner/
└── food_safety_scanner_app/
    └── index.html
```

否則 `data/recalls.json` 可能讀取失敗。

## 更新失敗排查

1. 確認網址可以直接打開：`https://你的帳號.github.io/你的repo/data/recalls.json`
2. 確認 JSON 格式正確。
3. 若剛更新 GitHub Pages，等部署完成再重整。
4. 手機瀏覽器按右上角「更新」，抓不到新版時會自動使用上次成功資料。
