# 介紹頁功能截圖

介紹頁「面板上看得到什麼」用的實拍圖，由 demo 面板拍下，三語 × 亮暗各一張：

- `port-<lang>-<theme>.webp`：母港（demo 第 0 步）
- `sortie-<lang>-<theme>.webp`：Z 點夜戰後（demo 第 15 步）

面板版面或 demo 資料變動後重拍：

```bash
npm run site:build && node tools/site-shots/shoot.mjs
```

需要本機 Google Chrome 與 `cwebp`。截圖上的編號位置寫在 `site/page.ts` 的 `SHOT_MARKS`（面板 CSS px），重拍後要核對圓點是否仍對準說明的區塊。
