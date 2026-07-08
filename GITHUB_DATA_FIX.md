# GitHub Pages 資料讀取排除

若畫面出現「資料讀取失敗」：

1. 先直接打開：`https://你的帳號.github.io/你的repo/data/recalls.json`
2. 如果 404：代表 `data/recalls.json` 沒有在 GitHub Pages 發布來源的根目錄。
3. 如果看到 HTML 而不是 JSON：代表路徑錯誤或 GitHub Pages 尚未部署完成。
4. 如果看到 JSON 但 App 仍失敗：確認 JSON 結構至少為 `{ "metadata": {...}, "products": [...] }`，本版也接受直接用產品陣列。
5. Commit 後到 repository 右側 Deployments 確認 GitHub Pages 成功。
6. 手機端關掉分頁重開，或按頁面「更新」。
