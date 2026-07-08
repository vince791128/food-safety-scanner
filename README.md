# 食安掃描警示｜瀏覽器版 v5

這是給朋友使用的瀏覽器版 PWA，不需上架 App Store / Google Play。打開網址後允許相機權限，即可掃商品條碼；若同品項曾受影響，把鏡頭移到有效日期或批號，系統會自動讀取並更新結果。

## v5 重點

- 主畫面只顯示四種大結果：合格、不合格、需確認、無資料。
- 詳細資料收在「查看判斷明細」內，不干擾一般使用者。
- 更新失敗時不會直接卡死；會自動改用上次成功載入的本機暫存資料。
- service worker 改成對 `data/recalls.json` 使用 network-first，且用 canonical cache key，避免 query string 快取造成回退失敗。

## 部署

1. 將本資料夾內容上傳到 GitHub repository 根目錄。
2. GitHub Pages 設定：Settings → Pages → Deploy from a branch → main → / root。
3. 部署完成後用 `https://你的帳號.github.io/你的repo/` 開啟。

## 更新資料

更新 `data/recalls.json` 後 commit 到 GitHub。朋友重新整理或按右上角「更新」即可抓新版資料。若抓取失敗，頁面會先使用前一次成功資料並顯示提醒。

## 注意

這個工具不能取代官方公告。掃不到不代表安全；請以食藥署、地方衛生局與業者最新公告為準。
