# 直接上傳 GitHub 步驟

1. 下載 ZIP 並解壓縮。
2. 打開解壓縮後的資料夾。
3. 全選裡面的所有檔案與資料夾。
4. 拖到 GitHub repository 的 **Add file → Upload files**。
5. Commit changes。
6. 到 **Settings → Pages**，確認 Source 為 `Deploy from a branch`、Branch 為 `main`、Folder 為 `/ root`。
7. 部署完成後測試：

```text
https://你的帳號.github.io/data/recalls.json
```

或專案頁：

```text
https://你的帳號.github.io/你的repo名稱/data/recalls.json
```

只要看得到 JSON，App 就可以讀取資料。
