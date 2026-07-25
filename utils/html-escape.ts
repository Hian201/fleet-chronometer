// HTML 跳脫與 extension-page 圖示 markup。零 chrome.*、零 i18n 依賴，panel／overview
// 共用；勿讓 state.ts／battle.ts 依賴此模組（核心須可獨立編譯）。

/** HTML 跳脫：文字節點與屬性值（title／value／class 片段）皆涵蓋 & < > " '。 */
export const esc = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** 裝備圖示（extension 根 root-relative）。icon<=0 用文字退路避免破圖。 */
export const gearIconHtml = (icon: number, short = '') =>
    icon > 0 ? `<img class="g-icon" src="/icons/equipment/${icon}.svg" alt="${esc(short)}" loading="lazy">` : esc(short);

/** 資源圖示；`file` 為檔名（fuel／ammo／…），不含路徑與副檔名。 */
export const matIconHtml = (file: string, alt = '') =>
    `<img class="m-icon" src="/icons/resource/${file}.svg" alt="${esc(alt)}">`;
