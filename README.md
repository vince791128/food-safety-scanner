# 食安掃描 v6｜逐項掃描簡化版

這版是 GitHub Pages 直接上傳版。目標是讓使用者只看到最重要的判斷：

- 合格
- 不合格
- 需確認
- 無資料

## 使用流程

1. 按「一鍵開始掃描」
2. 先掃商品條碼
3. 若需要，繼續掃包裝正面的品名
4. 若需要，繼續掃有效日期或批號
5. 一旦命中不合格，系統會自動停止掃描

## GitHub Pages 上傳方式

請把本資料夾內的所有檔案直接上傳到 repository 根目錄，不要再包一層資料夾。

正確：

```text
index.html
app.js
styles.css
service-worker.js
manifest.json
data/recalls.json
recalls.json
assets/icon.svg
.nojekyll
```

錯誤：

```text
food_safety_scanner_app/index.html
food_safety_scanner_app/data/recalls.json
```

## 更新資料

只更新食安資料時，改這兩個檔案即可：

```text
data/recalls.json
recalls.json
```

兩個檔案內容保持一致，GitHub Pages 部署後，朋友重新整理網頁即可讀取新版資料。

## 注意

這是示範資料，不是完整官方清單。正式使用前，應由後台整理食藥署、地方衛生局與業者公告後更新 recalls.json。
