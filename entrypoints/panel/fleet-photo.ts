// 編成寫真：面板拍照托盤。逐艘（或逐基地）讀取遊戲畫面的狀態面板，依遊戲編成畫面的
// 順序合成一張圖，頂端加上本擴充繪製的標題列。開啟時取代固定 270px 的 #tabpanel，
// 拍攝對象跟著下方的艦隊切換鈕（1–4／連合艦隊／基地航空隊）。
//
// 截圖只暫存在這個面板視窗的記憶體：不寫 DB、不進備份，關閉面板即清空。
import type { GameState } from '@/utils/state';
import type { Lang } from '@/utils/gamedata-i18n';
import { esc } from '@/utils/html-escape';
import { getLang, LANGS, t, tFor } from '@/utils/ui-i18n';
import {
    FLEET_PHOTO_TYPES, PHOTO_REGIONS,
    basePhotoSignature, defaultFleetPhotoType, photoLayout, shipPhotoSignature,
    type FleetPhotoType, type PhotoRegion,
} from '@/utils/fleet-photo';
import {
    COMMAND_FLEET_PHOTO_SHOOT, MSG_FLEET_PHOTO_CAPTURE, MSG_FLEET_PHOTO_SOURCES,
    type FleetPhotoCaptureMessage, type FleetPhotoCaptureReply, type FleetPhotoSource,
} from '@/utils/game-page';

export type PhotoTarget = { kind: 'fleet'; deck: number } | { kind: 'combined' } | { kind: 'lbas'; area: number | null };

interface Item { name: string; sub: string; sig: string }
interface Group { key: string; region: PhotoRegion; items: Item[]; hint: string }
interface Shot { dataUrl: string; sig: string }

export interface FleetPhotoDeps {
    root: HTMLElement;
    state: GameState;
    target: () => PhotoTarget;
    /** 面板目前的索敵分岐點係數（標題列的索敵值與面板一致）。 */
    cn: () => number;
    onOpenChange: (open: boolean) => void;
}

const BG = '#161c27';
const CELL_BG = '#e9e3d4';
const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans TC", "Noto Sans JP", sans-serif';

export function mountFleetPhoto(deps: FleetPhotoDeps) {
    const { root, state } = deps;
    let open = false;
    let busy = false;
    let part: 'main' | 'escort' = 'main';
    let message: { text: string; kind: 'toast' | 'err' } | null = null;
    let shortcut = '';
    const shots = new Map<string, Shot>();
    const cursor = new Map<string, number>();
    // 輸出設定（本視窗期間有效）
    const typeChosen = new Map<string, FleetPhotoType>();
    const show = { header: true, air: true, los: true, speed: true, tp: true, action: true, radius: true };
    let size: '23' | '1' = '23';
    let outLang: Lang | '' = '';
    let optsKey = '';
    let lastTargetKey = '';
    let sources: FleetPhotoSource[] = [];
    let sourceTabId: number | undefined;
    let selectionVersion = 0;

    void browser.commands?.getAll().then(list => {
        shortcut = list.find(c => c.name === COMMAND_FLEET_PHOTO_SHOOT)?.shortcut ?? '';
        refresh();
    }).catch(() => { /* 取不到就顯示「未設定」 */ });

    root.innerHTML =
        '<div class="ph-head"><span class="ph-title"></span><span class="ph-target"></span>' +
        '<span class="ph-count"></span><button type="button" class="ph-close">✕</button></div>' +
        '<div class="ph-hint"></div><div class="ph-grid"></div>' +
        '<div class="ph-foot"><button type="button" class="ph-shoot"></button><span class="grow"></span>' +
        '<details class="ph-opts"><summary></summary><div class="ph-opts-panel"></div></details>' +
        '<button type="button" class="ph-btn" data-out="png"></button><button type="button" class="ph-btn" data-out="copy"></button></div>';
    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    const titleEl = q('.ph-title'), targetEl = q('.ph-target'), countEl = q('.ph-count'), closeEl = q<HTMLButtonElement>('.ph-close');
    const hintEl = q('.ph-hint'), gridEl = q('.ph-grid'), shootEl = q<HTMLButtonElement>('.ph-shoot');
    const optsSummary = q('.ph-opts > summary'), optsPanel = q('.ph-opts-panel');
    const saveEl = q<HTMLButtonElement>('[data-out="png"]'), copyEl = q<HTMLButtonElement>('[data-out="copy"]');

    // ── 拍攝對象 ──────────────────────────────────
    const fleetGroup = (deck: number, hint: string): Group => {
        const ships = state.fleets()[deck]?.ships ?? [];
        return {
            key: `f${deck}`, region: 'ship', hint,
            items: ships.map((s, i) => ({ name: s.name, sub: `${i + 1} · Lv${s.lv}`, sig: shipPhotoSignature(s) })),
        };
    };
    const lbasArea = (want: number | null): number | null => {
        const areas = [...new Set(state.airBases_().map(b => b.areaId))].sort((a, b) => b - a);
        return want !== null && areas.includes(want) ? want : areas[0] ?? null;
    };
    const basesOf = (area: number | null) =>
        area === null ? [] : state.airBases_().filter(b => b.areaId === area).sort((a, b) => a.rid - b.rid);
    const keyText = () => shortcut || t('photo.noKey');
    /** 托盤目前顯示的那一組（連合艦隊時為主力或護衛其中之一）。 */
    function currentGroup(): Group {
        const tg = deps.target();
        if (tg.kind === 'lbas') {
            const area = lbasArea(tg.area);
            return {
                key: `b${area}`, region: 'lbas', hint: t('photo.hintLbas', { key: keyText() }),
                items: basesOf(area).map(ab => ({ name: ab.name, sub: '', sig: basePhotoSignature(ab.squadrons) })),
            };
        }
        if (tg.kind === 'combined') {
            return part === 'main'
                ? fleetGroup(0, t('photo.hintFleet', { key: keyText() }))
                : fleetGroup(1, t('photo.hintEscort', { key: keyText() }));
        }
        return fleetGroup(tg.deck, tg.deck === 0
            ? t('photo.hintFleet', { key: keyText() })
            : t('photo.hintFleetN', { n: tg.deck + 1, key: keyText() }));
    }
    /** 輸出圖涵蓋的所有組（連合艦隊＝主力＋護衛）。 */
    function outputGroups(): Group[] {
        const tg = deps.target();
        if (tg.kind === 'combined') return [fleetGroup(0, ''), fleetGroup(1, '')];
        return [currentGroup()];
    }
    const targetKey = () => {
        const tg = deps.target();
        return tg.kind === 'fleet' ? `f${tg.deck}` : tg.kind === 'combined' ? 'c' : `b${lbasArea(tg.area)}`;
    };
    const fresh = (g: Group, i: number) => {
        const shot = shots.get(`${g.key}:${i}`);
        return !!shot && shot.sig === g.items[i].sig;
    };
    const firstPending = (g: Group, from: number) => {
        for (let k = 0; k < g.items.length; k++) {
            const j = (from + k) % g.items.length;
            if (!fresh(g, j)) return j;
        }
        return -1;
    };
    const cursorOf = (g: Group) => {
        const c = cursor.get(g.key);
        if (c !== undefined && c >= 0 && c < g.items.length) return c;
        return firstPending(g, 0);
    };
    const freshCount = (g: Group) => g.items.reduce((n, _, i) => n + (fresh(g, i) ? 1 : 0), 0);

    // ── 繪製 ──────────────────────────────────────
    function refresh() {
        if (!open) return;
        const tg = deps.target();
        const tk = targetKey();
        if (tk !== lastTargetKey) { selectionVersion++; lastTargetKey = tk; message = null; if (tg.kind !== 'combined') part = 'main'; }
        const g = currentGroup();
        const groups = outputGroups();
        const cur = cursorOf(g);

        titleEl.textContent = t('photo.title');
        closeEl.title = t('photo.close');
        closeEl.setAttribute('aria-label', t('photo.close'));
        if (tg.kind === 'combined') {
            const [a, b] = groups;
            targetEl.className = 'ph-seg';
            targetEl.innerHTML =
                `<button type="button" data-part="main" aria-pressed="${part === 'main'}">${esc(t('photo.main'))} ${freshCount(a)}/${a.items.length}</button>` +
                `<button type="button" data-part="escort" aria-pressed="${part === 'escort'}">${esc(t('photo.escort'))} ${freshCount(b)}/${b.items.length}</button>`;
        } else {
            targetEl.className = 'ph-target';
            targetEl.textContent = tg.kind === 'lbas'
                ? (() => { const area = lbasArea(tg.area); return area === null ? '' : state.mapAreaName(area); })()
                : t('photo.fleetN', { n: tg.deck + 1 });
        }
        const taken = groups.reduce((n, x) => n + freshCount(x), 0);
        const total = groups.reduce((n, x) => n + x.items.length, 0);
        countEl.innerHTML = `<b>${taken}</b>/${total}`;

        hintEl.className = `ph-hint${message ? ` ${message.kind}` : ''}`;
        hintEl.textContent = message?.text ?? g.hint;

        if (!g.items.length) {
            gridEl.className = 'ph-grid';
            gridEl.innerHTML = `<div class="ph-empty">${esc(t(g.region === 'lbas' ? 'photo.noLbas' : 'photo.noShips'))}</div>`;
        } else if (g.region === 'lbas') {
            gridEl.className = 'ph-grid lbas';
            gridEl.style.setProperty('--n', String(g.items.length));
            gridEl.innerHTML = g.items.map((it, i) => cellHtml(g, it, i, cur)).join('');
        } else {
            gridEl.className = 'ph-grid fleet';
            gridEl.style.setProperty('--rows', String(Math.max(1, Math.ceil(g.items.length / 2))));
            gridEl.innerHTML = g.items.map((it, i) => cellHtml(g, it, i, cur)).join('');
        }

        const canShoot = g.items.length > 0 && (cur >= 0 || (tg.kind === 'combined' && part === 'main' && firstPending(groups[1], 0) >= 0));
        shootEl.disabled = busy || !canShoot;
        shootEl.textContent = busy ? t('photo.shooting') : canShoot ? t('photo.shoot') : t('photo.done');
        shootEl.title = shortcut;
        optsSummary.textContent = t('photo.opts');
        saveEl.textContent = t('photo.save');
        copyEl.textContent = t('photo.copy');
        const hasShots = groups.some(x => x.items.some((_, i) => shots.has(`${x.key}:${i}`)));
        saveEl.disabled = copyEl.disabled = !hasShots;
        renderOpts(tg);
    }

    function cellHtml(g: Group, it: Item, i: number, cur: number) {
        const shot = shots.get(`${g.key}:${i}`);
        const stale = !!shot && shot.sig !== it.sig;
        const isNext = i === cur;
        const label = stale ? t('photo.stale') : shot && !isNext ? t('photo.shot') : isNext ? t('photo.next') : t('photo.empty');
        const cls = ['ph-cell', shot ? 'shot' : '', stale ? 'stale' : '', isNext ? 'next' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="${cls}" data-slot="${i}" title="${esc(it.name)}">` +
            `<span class="ph-thumb">${shot ? `<img alt="" src="${shot.dataUrl}">` : ''}</span>` +
            `<span class="ph-meta"><span class="ph-name">${esc(it.name)}</span>` +
            (it.sub ? `<span class="ph-sub">${esc(it.sub)}</span>` : '') +
            `<span class="ph-state">${esc(label)}</span></span></button>`;
    }

    // 設定面板只在對象、語言或來源清單改變時重建，平常保留同一份控制項（含開啟中的下拉選單）。
    function renderOpts(tg: PhotoTarget) {
        const key = `${tg.kind === 'lbas' ? 'lbas' : targetKey()}|${getLang()}|${JSON.stringify(sources)}|${sourceTabId}`;
        if (key === optsKey) return;
        optsKey = key;
        const chk = (k: keyof typeof show, label: string) =>
            `<label><input type="checkbox" data-show="${k}"${show[k] ? ' checked' : ''}>${esc(label)}</label>`;
        const langName = (code: Lang) => LANGS.find(l => l.code === code)?.label ?? code;
        const langSel = `<select data-opt="lang"><option value=""${outLang ? '' : ' selected'}>${esc(t('photo.langFollow', { lang: langName(getLang()) }))}</option>` +
            LANGS.map(l => `<option value="${l.code}"${outLang === l.code ? ' selected' : ''}>${esc(l.label)}</option>`).join('') + '</select>';
        const sizeSel = `<select data-opt="size"><option value="23"${size === '23' ? ' selected' : ''}>${esc(t('photo.size23'))}</option>` +
            `<option value="1"${size === '1' ? ' selected' : ''}>${esc(t('photo.size1'))}</option></select>`;
        const sourceSel = `<label class="row"><span>${esc(t('photo.source'))}</span><select data-opt="source">` +
            `<option value=""${sourceTabId === undefined ? ' selected' : ''}>${esc(t('photo.chooseSource'))}</option>` +
            sources.map(source => `<option value="${source.tabId}"${sourceTabId === source.tabId ? ' selected' : ''}>${esc(`${source.title} (${source.tabId})`)}</option>`).join('') + '</select></label>';
        const tail = sourceSel + `<label class="row"><span>${esc(t('photo.optLang'))}</span>${langSel}</label>` +
            `<label class="row"><span>${esc(t('photo.optSize'))}</span>${sizeSel}</label>`;
        if (tg.kind === 'lbas') {
            optsPanel.innerHTML = `<div class="checks">${chk('header', t('photo.optHeader'))}</div>` +
                `<div class="checks">${chk('action', t('photo.action'))}${chk('radius', t('lbas.radius'))}</div>${tail}`;
            return;
        }
        const type = fleetType();
        optsPanel.innerHTML =
            `<label class="row"><span>${esc(t('photo.optType'))}</span><select data-opt="type">` +
            FLEET_PHOTO_TYPES.map(k => `<option value="${k}"${k === type ? ' selected' : ''}>${esc(t(`photo.type.${k}`))}</option>`).join('') +
            `</select></label><div class="checks">${chk('header', t('photo.optHeader'))}</div>` +
            `<div class="checks">${chk('air', t('fleet.airPower'))}${chk('los', t('fleet.scouting33'))}${chk('speed', t('order.speed'))}${chk('tp', t('fleet.transportTP'))}</div>${tail}`;
    }
    function fleetType(): FleetPhotoType {
        const tk = targetKey();
        const chosen = typeChosen.get(tk);
        if (chosen) return chosen;
        const tg = deps.target();
        if (tg.kind === 'lbas') return 'normal';
        const count = tg.kind === 'fleet' ? (state.fleets()[tg.deck]?.ships.length ?? 0) : 12;
        return defaultFleetPhotoType(tg.kind, count, state.combinedFlag);
    }

    // ── 拍攝 ──────────────────────────────────────
    async function shoot() {
        if (!open || busy) return;
        const tg = deps.target();
        let g = currentGroup();
        let i = cursorOf(g);
        if (i < 0 && tg.kind === 'combined' && part === 'main') {
            part = 'escort';
            g = currentGroup();
            i = cursorOf(g);
        }
        if (i < 0) { refresh(); return; }
        busy = true;
        message = null;
        refresh();
        const version = selectionVersion;
        const request: FleetPhotoCaptureMessage = { type: MSG_FLEET_PHOTO_CAPTURE, region: PHOTO_REGIONS[g.region], tabId: sourceTabId };
        const reply = await browser.runtime.sendMessage(request)
            .catch((e: unknown) => ({ error: 'failed', detail: String((e as { message?: unknown })?.message ?? e) })) as FleetPhotoCaptureReply | undefined;
        busy = false;
        if (!reply || !('dataUrl' in reply)) {
            const code = reply && 'error' in reply ? reply.error : 'failed';
            const detail = reply && 'detail' in reply ? reply.detail ?? '' : '';
            if (code === 'choose-source' || code === 'no-game') await loadSources();
            if (code === 'choose-source') root.querySelector<HTMLDetailsElement>('.ph-opts')!.setAttribute('open', '');
            message = { kind: 'err', text: t(`photo.err.${code}`, { msg: detail || code }) };
            refresh();
            return;
        }
        // 相同格位不代表同一艘船／同一配置；回應抵達時簽章不同就丟棄影像。
        const now = currentGroup();
        const item = now.key === g.key ? now.items[i] : undefined;
        if (version !== selectionVersion || !item || item.sig !== g.items[i].sig) {
            message = { kind: 'err', text: t('photo.err.changed') };
            refresh();
            return;
        }
        shots.set(`${g.key}:${i}`, { dataUrl: reply.dataUrl, sig: item.sig });
        let next = firstPending(now, i + 1);
        cursor.set(g.key, next);
        let nextName = next >= 0 ? now.items[next].name : '';
        if (next < 0 && tg.kind === 'combined' && part === 'main') {
            const escort = fleetGroup(1, '');
            const e = firstPending(escort, 0);
            if (e >= 0) {
                part = 'escort';
                cursor.set(escort.key, e);
                next = e;
                nextName = `${t('photo.escort')} ${escort.items[e].name}`;
            }
        }
        message = {
            kind: 'toast',
            text: nextName ? t('photo.shotToast', { name: item.name, next: nextName }) : t('photo.shotToastDone', { name: item.name }),
        };
        refresh();
        if (currentGroup().key === g.key) {
            const cell = gridEl.querySelector<HTMLElement>(`.ph-cell[data-slot="${i}"]`);
            cell?.classList.add('flash');
            setTimeout(() => cell?.classList.remove('flash'), 260);
        }
    }

    // ── 合成與輸出 ─────────────────────────────────
    async function compose(): Promise<HTMLCanvasElement | null> {
        const tg = deps.target();
        const groups = outputGroups();
        if (!groups.some(g => g.items.length)) return null;
        const kind = tg.kind === 'lbas' ? 'lbas' : tg.kind === 'combined' ? 'combined' : 'fleet';
        const scale = size === '23' ? 2 / 3 : 1;
        const layout = photoLayout({
            kind, counts: groups.map(g => g.items.length), header: show.header,
            lbasSub: show.action || show.radius, scale,
        });
        const canvas = document.createElement('canvas');
        canvas.width = layout.width;
        canvas.height = layout.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, layout.width, layout.height);
        // 格子底色只鋪在各區塊內：未拍的格子仍看得出位置，區塊之間保留深色間距
        ctx.fillStyle = CELL_BG;
        for (const b of layout.blocks) ctx.fillRect(b.x, b.y, b.width, b.height);
        if (layout.headHeight) drawHead(ctx, layout.headHeight, scale);
        if (layout.subHeight) drawLbasSub(ctx, layout.headHeight, layout.subHeight, layout.columnX, scale);
        for (const cell of layout.cells) {
            const shot = shots.get(`${groups[cell.block].key}:${cell.index}`);
            if (!shot) continue;
            const img = new Image();
            img.src = shot.dataUrl;
            await img.decode();
            ctx.drawImage(img, cell.x, cell.y, cell.width, cell.height);
        }
        return canvas;
    }

    const outT = (key: string, vars?: Record<string, string | number>) => tFor(outLang || getLang(), key, vars);
    const font = (px: number, scale: number, weight = '') => `${weight} ${Math.round(px * scale)}px ${FONT}`.trim();
    /** 依序畫「標籤 值」組，回傳下一個 x。 */
    function drawPairs(ctx: CanvasRenderingContext2D, pairs: [string, string][], x: number, mid: number, scale: number, labelPx: number, valuePx: number) {
        for (const [label, value] of pairs) {
            ctx.font = font(labelPx, scale); ctx.fillStyle = '#9aa6ba'; ctx.fillText(label, x, mid);
            x += ctx.measureText(label).width + 7 * scale;
            ctx.font = font(valuePx, scale, '600'); ctx.fillStyle = '#e8ecf3'; ctx.fillText(value, x, mid);
            x += ctx.measureText(value).width + 24 * scale;
        }
        return x;
    }
    function drawHead(ctx: CanvasRenderingContext2D, h: number, scale: number) {
        const tg = deps.target();
        ctx.textBaseline = 'middle';
        const mid = h / 2;
        let x = 18 * scale;
        let title: string;
        if (tg.kind === 'lbas') {
            const area = lbasArea(tg.area);
            title = outT('photo.lbasHead', { area: area === null ? '' : state.mapAreaName(area) });
        } else {
            title = outT(`photo.type.${fleetType()}`);
        }
        ctx.font = font(24, scale, '600'); ctx.fillStyle = '#e6c35c'; ctx.fillText(title, x, mid);
        x += ctx.measureText(title).width + 30 * scale;
        if (tg.kind === 'lbas') return;
        const cn = deps.cn();
        const sum = tg.kind === 'combined' ? state.combinedSummary(cn) : state.fleetSummary(tg.deck, cn);
        if (!sum) return;
        const pairs: [string, string][] = [];
        // 制空的熟練度成分可能過時（airStale）：數字前加 ≈ 表示推算
        if (show.air) {
            const air = sum.air.min === sum.air.max ? `${sum.air.min}` : `${sum.air.min}~${sum.air.max}`;
            pairs.push([outT('fleet.airPower'), `${sum.airStale ? '≈' : ''}${air}`]);
        }
        if (show.los) pairs.push([`${outT('fleet.scouting33')}${cn !== 1 ? ` ×${cn}` : ''}`, sum.f33.toFixed(1)]);
        if (show.speed) pairs.push([outT('order.speed'), outT(`speed.${sum.speedKey}`)]);
        if (show.tp) pairs.push([outT('fleet.transportTP'), String(sum.tp.total)]);
        drawPairs(ctx, pairs, x, mid, scale, 17, 21);
    }
    function drawLbasSub(ctx: CanvasRenderingContext2D, y: number, h: number, columnX: number[], scale: number) {
        const tg = deps.target();
        if (tg.kind !== 'lbas') return;
        ctx.textBaseline = 'middle';
        const mid = y + h / 2 - 4 * scale;
        basesOf(lbasArea(tg.area)).forEach((ab, i) => {
            const pairs: [string, string][] = [];
            if (show.action) {
                const k = ab.actionKind;
                pairs.push([outT('photo.action'), k >= 0 && k <= 4 ? outT(`ab.action.${k}`) : outT('ab.action.unknown', { n: k })]);
            }
            if (show.radius) pairs.push([outT('lbas.radius'), String(ab.distance)]);
            drawPairs(ctx, pairs, (columnX[i] ?? 0) + 14 * scale, mid, scale, 16, 19);
        });
    }
    const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    async function exportImage(mode: 'png' | 'copy') {
        try {
            const canvas = await compose();
            if (!canvas) return;
            const blob = await toBlob(canvas);
            if (mode === 'copy') {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                message = { kind: 'toast', text: t('photo.copied') };
            } else {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `fleet-photo-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                message = { kind: 'toast', text: t('photo.saved') };
            }
        } catch (e) {
            const msg = String((e as { message?: unknown })?.message ?? e);
            message = { kind: 'err', text: mode === 'copy' ? t('photo.copyFailed', { msg }) : t('photo.err.failed', { msg }) };
        }
        refresh();
    }

    // ── 事件 ──────────────────────────────────────
    root.addEventListener('click', e => {
        const el = (e.target as HTMLElement).closest('button');
        if (!el || !root.contains(el)) return;
        if (el === closeEl) { setOpen(false); return; }
        if (el === shootEl) { void shoot(); return; }
        if (el.dataset.part) { selectionVersion++; part = el.dataset.part === 'escort' ? 'escort' : 'main'; message = null; refresh(); return; }
        if (el.dataset.slot !== undefined) { selectionVersion++; cursor.set(currentGroup().key, Number(el.dataset.slot)); message = null; refresh(); return; }
        if (el.dataset.out) void exportImage(el.dataset.out === 'copy' ? 'copy' : 'png');
    });
    // 設定變更只影響輸出圖，不重繪托盤，開啟中的設定面板與下拉選單保持原狀
    root.addEventListener('change', e => {
        const el = e.target as HTMLInputElement | HTMLSelectElement;
        if (el.dataset.opt === 'source') { selectionVersion++; sourceTabId = el.value === '' ? undefined : Number(el.value); }
        else if (el.dataset.opt === 'size') size = el.value === '1' ? '1' : '23';
        else if (el.dataset.opt === 'lang') outLang = (LANGS.some(l => l.code === el.value) ? el.value : '') as Lang | '';
        else if (el.dataset.opt === 'type') typeChosen.set(targetKey(), el.value as FleetPhotoType);
        else if (el instanceof HTMLInputElement && el.dataset.show && el.dataset.show in show) {
            show[el.dataset.show as keyof typeof show] = el.checked;
        }
    });

    async function loadSources() {
        try {
            const available = await browser.runtime.sendMessage({ type: MSG_FLEET_PHOTO_SOURCES }) as FleetPhotoSource[] | undefined;
            if (!Array.isArray(available)) return;
            sources = available;
            if (sourceTabId === undefined && sources.length === 1) sourceTabId = sources[0].tabId;
            refresh();
        } catch { /* 拍攝請求會回報通道錯誤 */ }
    }

    function setOpen(next: boolean) {
        if (open === next) return;
        selectionVersion++;
        open = next;
        root.hidden = !open;
        message = null;
        deps.onOpenChange(open);
        refresh();
        if (open) void loadSources();
    }

    return {
        isOpen: () => open,
        setOpen,
        toggle: () => setOpen(!open),
        refresh,
        shoot: () => void shoot(),
        /** 語言切換：設定面板要以新語言重建。 */
        relabel: () => { optsKey = ''; refresh(); },
    };
}
