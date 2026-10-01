// fleet-photo-panel 預覽的瀏覽器端入口：以正式 mountFleetPhoto／fitHeaderScale 搭配假資料，
// 檢查托盤、header 縮放與輸出圖。擷取請求由假的 browser.runtime 回傳佔位卡（不含遊戲素材）。
import { mountFleetPhoto, type PhotoTarget } from '../../entrypoints/panel/fleet-photo';
import { fitHeaderScale } from '../../entrypoints/panel/header-fit';
import { MSG_FLEET_PHOTO_SOURCES } from '../../utils/game-page';
import { PHOTO_REGIONS } from '../../utils/fleet-photo';
import { setLang, t } from '../../utils/ui-i18n';
import type { GameState } from '../../utils/state';

const params = new URLSearchParams(location.search);
const lang = (['zh-TW', 'ja', 'en'].includes(params.get('lang') ?? '') ? params.get('lang') : 'zh-TW') as Parameters<typeof setLang>[0];
setLang(lang);
document.documentElement.lang = lang;
if (params.has('theme')) document.documentElement.dataset.theme = params.get('theme')!;

// ── 假資料 ──
const ship = (id: number, name: string, stype: string, lv: number) => ({
    id, mst: id, name, nameJa: name, stype, lv, gears: [{ mst: 9, level: 10 }, { mst: 50, level: 4 }, null], exGear: null,
});
const fleets = [
    [ship(1, '山城改二補', 'BBV', 148), ship(2, '龍鳳改二', 'CVL', 183), ship(3, '最上改二特', 'CAV', 185), ship(4, '時雨改三', 'DD', 187), ship(5, '満潮改二', 'DD', 164), ship(6, '吹雪改三護', 'DD', 183)],
    [ship(11, '大和改二重', 'BB', 173), ship(12, '武蔵改二', 'BB', 175), ship(13, '矢矧改二乙', 'CL', 140), ship(14, '鈴谷改二', 'CA', 150), ship(15, '雪風改二', 'DD', 120), ship(16, '初霜改二', 'DD', 110)],
    [ship(21, '阿武隈改二', 'CL', 165), ship(22, '不知火改二', 'DD', 152), ship(23, '霞改二乙', 'DD', 160), ship(24, '大潮改二', 'DD', 140), ship(25, '朝潮改二丁', 'DD', 158), ship(26, '霰改二', 'DD', 120), ship(27, '陽炎改二', 'DD', 130)],
    [ship(31, '長門改二', 'BB', 175), ship(32, '陸奥改二', 'BB', 170), ship(33, '翔鶴改二甲', 'CV', 165), ship(34, '瑞鶴改二甲', 'CV', 165), ship(35, '綾波改二', 'DD', 150), ship(36, '敷波改二', 'DD', 150)],
];
const baseCount = Math.min(3, Math.max(1, Number(params.get('bases')) || 3));
const bases = [
    { areaId: 6, rid: 1, name: '第一基地航空隊', actionKind: 1, distance: 5 },
    { areaId: 6, rid: 2, name: '第二基地航空隊', actionKind: 1, distance: 7 },
    { areaId: 6, rid: 3, name: '第三基地航空隊', actionKind: 2, distance: 6 },
].slice(0, baseCount).map(b => ({ ...b, squadrons: [1, 2, 3, 4].map(i => ({ state: 1, mst: 168 + i, level: 0 })) }));
const summary = (air: number, f33: number, speedKey: string, tp: number) =>
    ({ air: { min: air, max: air }, airStale: false, f33, speedKey, tp: { total: tp, gear: 0 }, lvSum: 0, speed: '' });
const mockState = {
    combinedFlag: 1,
    nickname: params.get('nick') ?? 'イケン',
    fleets: () => fleets.map(ships => ({ ships })),
    airBases_: () => bases,
    mapAreaName: () => '中部海域',
    fleetSummary: (deck: number) => [summary(312, 18.6, 'slow', 0), summary(96, 24.1, 'fast', 0), summary(0, 31.5, 'fast', 52), summary(268, 40.2, 'fast', 0)][deck],
    combinedSummary: () => summary(408, 48.9, 'slow', 8),
} as unknown as GameState;

// ── 佔位卡（假擷取）──
let seq = 0;
function placeholder(width: number, height: number): string {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const g = c.getContext('2d')!;
    const hue = (seq++ * 47) % 360;
    g.fillStyle = '#efe9dc'; g.fillRect(0, 0, width, height);
    if (width === PHOTO_REGIONS.ship.width) {
        for (let i = 0; i < 5; i++) { g.fillStyle = '#e1d8c6'; g.fillRect(60, 92 + i * 47, 270, 34); }
        for (let r = 0; r < 6; r++) for (let k = 0; k < 2; k++) { g.fillStyle = '#e4dccb'; g.fillRect(36 + k * 152, 334 + r * 34, 144, 30); }
        g.fillStyle = `hsl(${hue},30%,62%)`; g.fillRect(356, 4, 320, 466);
    } else {
        g.fillStyle = '#e1d8c6'; g.fillRect(12, 6, 310, 28);
        for (let i = 0; i < 4; i++) { g.fillStyle = `hsl(${(hue + i * 30) % 360},25%,58%)`; g.fillRect(150, 66 + i * 94, 170, 58); }
    }
    g.fillStyle = '#3a3a3a'; g.font = '24px sans-serif'; g.fillText('PLACEHOLDER', 24, 40);
    return c.toDataURL('image/png');
}
(globalThis as any).browser = {
    runtime: {
        sendMessage: async (msg: { type: string; region: { width: number; height: number } }) => msg.type === MSG_FLEET_PHOTO_SOURCES
            ? [{ tabId: 1, title: 'KanColle A' }, ...(params.has('multi') ? [{ tabId: 2, title: 'KanColle B' }] : [])]
            : params.has('error') ? { error: params.get('error') } : { dataUrl: placeholder(msg.region.width, msg.region.height) },
    },
    commands: { getAll: async () => [{ name: 'fleet-photo-shoot', shortcut: 'Alt+Shift+S' }] },
};

// 「輸出 PNG」改成把圖顯示在頁面上，供核對
const outEl = document.getElementById('out')!;
HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!this.download) return;
    const img = new Image();
    img.src = this.href;
    img.onload = () => { document.getElementById('out-meta')!.textContent = `${img.naturalWidth}×${img.naturalHeight}`; };
    outEl.replaceChildren(img);
};

// ── 面板骨架 ──
const header = document.getElementById('header')!;
const nick = mockState.nickname;
header.innerHTML = `<span class="idbox" title="${nick}"><span class="nick">${nick}</span><span class="num">Lv120</span></span>` +
    `<span class="stat first"><img class="h-icon" src="/public/icons/ui/ship.svg" alt=""> <b>${params.get('ships') ?? '425/430'}</b></span>` +
    `<span class="stat"><img class="h-icon" src="/public/icons/ui/equip.svg" alt=""> <b>${params.get('gears') ?? '2141/2200'}</b></span>` +
    `<button type="button" class="h-cam" aria-pressed="true"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.2h2.6L5.8 3.4h4.4l1.2 1.8H14v7.4H2z"/><circle cx="8" cy="8.6" r="2.4"/></svg></button>`;
const tabs = document.getElementById('tabs')!;
tabs.innerHTML = ['tab.general', 'tab.sortie', 'tab.exped', 'tab.factory', 'tab.order'].map(k => `<button>${t(k)}</button>`).join('');

let target: PhotoTarget = { kind: 'fleet', deck: 0 };
const mode = params.get('mode') ?? '1';
if (mode === 'c') target = { kind: 'combined' };
else if (mode === 'lbas') target = { kind: 'lbas', area: null };
else target = { kind: 'fleet', deck: Math.min(3, Math.max(0, Number(mode) - 1)) };

const nav = document.getElementById('fleetnav')!;
function renderNav() {
    const on = (x: boolean) => (x ? 'on' : '');
    nav.innerHTML = [0, 1, 2, 3].map(i => `<button data-i="${i}" class="${on(target.kind === 'fleet' && target.deck === i)}">${i + 1}</button>`).join('') +
        `<button data-c="1" class="${on(target.kind === 'combined')}">${t('fleet.combinedType.1')}</button>` +
        `<span class="grow"></span><button data-l="1" class="${on(target.kind === 'lbas')}">${t('lbas.button')}</button>`;
}
renderNav();

const photo = mountFleetPhoto({
    root: document.getElementById('photo-tray')!,
    state: mockState,
    target: () => target,
    cn: () => 1,
    onOpenChange: () => { /* 預覽固定開啟 */ },
});
nav.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.i) target = { kind: 'fleet', deck: Number(b.dataset.i) };
    else if (b.dataset.c) target = { kind: 'combined' };
    else if (b.dataset.l) target = { kind: 'lbas', area: null };
    renderNav();
    photo.refresh();
});
photo.setOpen(true);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
void (async () => {
    await document.fonts?.ready;
    const scale = fitHeaderScale(header);
    const nickEl = header.querySelector<HTMLElement>('.nick')!;
    document.getElementById('measure-header')!.textContent =
        `header ${header.offsetHeight}px · scale ${scale.toFixed(2)} · name ${getComputedStyle(nickEl).fontSize} · ` +
        (nickEl.scrollWidth > nickEl.clientWidth + 1 ? 'CUT' : 'full');
    const n = Number(params.get('shots')) || 0;
    for (let i = 0; i < n; i++) { photo.shoot(); await sleep(40); }
    if (params.get('stale')) {
        fleets[0][2].gears = [{ mst: 9, level: 9 }, null, null];
        photo.refresh();
    }
    if (params.get('opts')) document.querySelector<HTMLDetailsElement>('.ph-opts')!.open = true;
    if (params.get('outLang')) {
        const sel = document.querySelector<HTMLSelectElement>('[data-opt="lang"]')!;
        sel.value = params.get('outLang')!;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (params.get('export')) document.querySelector<HTMLButtonElement>('[data-out="png"]')!.click();
    await sleep(300);
    const tray = document.getElementById('photo-tray')!;
    const cells = [...tray.querySelectorAll<HTMLElement>('.ph-cell')];
    const grid = tray.querySelector<HTMLElement>('.ph-grid')!;
    const thumb = cells[0]?.querySelector<HTMLElement>('.ph-thumb')?.getBoundingClientRect();
    const overflow = cells.some(c => c.getBoundingClientRect().bottom > grid.getBoundingClientRect().bottom + 0.5)
        || tray.scrollHeight > tray.clientHeight;
    document.getElementById('measure-tray')!.textContent =
        `tray ${tray.offsetHeight}px · thumb ${Math.round(thumb?.width ?? 0)}×${Math.round(thumb?.height ?? 0)} · ${overflow ? 'OVERFLOW' : 'fits'}`;
})();
