// 介紹頁與隱私權頁共用的主題：<html data-theme="dark|light">。
// 預設跟隨系統外觀；使用者按過「亮／暗」後記在 SITE_THEME_KEY，之後以它為準。
// 這段放在 <head> 內聯執行，讓頁面第一次繪製就是正確主題，不會先閃另一種顏色。
// 儲存被拒（隱私模式等）時只是不記憶選擇，仍依系統外觀顯示。
export const SITE_THEME_KEY = 'site-theme';

export const THEME_BOOT = `<script>(function(){var t;try{t=localStorage.getItem('${SITE_THEME_KEY}')}catch(e){}`
    + `if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';`
    + `document.documentElement.dataset.theme=t})()</script>`;
