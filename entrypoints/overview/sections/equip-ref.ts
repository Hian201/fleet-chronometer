// 配裝參考：從在案艦指定一艘，列出她裝得上、且有藍字或主砲適性的全圖鑑裝備。
// 庫存沒有的加「庫存無」。加成／適性皆社群資料，非正式封包驗證。
//
// 重繪邊界（design-guidelines §4.2）：左側有搜尋框，殼只建一次；之後只重繪艦清單與
// 右側裝備區，以免輸入焦點被吃掉。
import type { OverviewSection } from './types';
import { t } from '../../../utils/ui-i18n';
import { localizeEquipmentType } from '../../../utils/gamedata-i18n';
import { nationOf } from '../../../utils/ship-nationality';
import { buildStypeLabels, stypeDisplayLabel } from '../../../utils/stype-label';
import {
    BONUS_STAT_KEYS,     EQUIP_BONUS_TABLE, bbGroupOf, buildFitRules, collectEquipRef,
    isMainGunCat, markEquipRefShips, nationToBonusCountry,
    type BonusLine, type BonusStatKey, type EquipRefGear, type EquipRefRow, type EquipRefShip,
    type FitRule,
} from '../../../utils/equip-ref';
import { esc, gearIconHtml, loadJsonPrefs, saveJsonPrefs } from '../lib';

const PREFS_KEY = 'kc-equip-ref';
const LENG_KEYS = ['', 'ov.rsLengShort', 'ov.rsLengMedium', 'ov.rsLengLong', 'ov.rsLengVeryLong'];
const STAT_LABEL: Record<BonusStatKey, string> = {
    houg: 'ov.rsColFire', raig: 'ov.rsColTorp', tyku: 'ov.rsColAa', tais: 'ov.rsColAsw',
    saku: 'ov.rsColLos', houm: 'ov.eqColHoum', kaih: 'ov.rsColEvasion', souk: 'ov.rsColArmor',
    baku: 'ov.eqColBaku', leng: 'ov.rsLeng',
};

interface Prefs { onlyKnown: boolean; onlyOwned: boolean; kind: 'all' | 'bonus' | 'fit' }
const defaultPrefs = (): Prefs => ({ onlyKnown: false, onlyOwned: false, kind: 'all' });
const loadPrefs = () => loadJsonPrefs<Prefs>(PREFS_KEY, defaultPrefs(), raw => {
    if (!raw || typeof raw !== 'object') return defaultPrefs();
    const o = raw as Record<string, unknown>;
    const kind = o.kind === 'bonus' || o.kind === 'fit' ? o.kind : 'all';
    return { onlyKnown: o.onlyKnown === true, onlyOwned: o.onlyOwned === true, kind };
});

interface ShipRow extends EquipRefShip {
    instId: number;
    name: string;
    nameJa: string;
    stypeName: string;
    soku: number;
    lv: number;
    hasBonus: boolean;
    hasFit: boolean;
    hasOver: boolean;
    n: number;
}

const asStypeShip = (s: ShipRow) => ({ stypeId: s.stype, stype: s.stypeName, soku: s.soku });
const shipStypeLabel = (s: ShipRow) => stypeDisplayLabel(asStypeShip(s));

function fmtStats(bonus: BonusLine['bonus']): string {
    return BONUS_STAT_KEYS.filter(k => bonus[k]).map(k => {
        const n = bonus[k]!;
        const sign = n > 0 ? `+${n}` : String(n);
        return `<span class="er-stat">${esc(t(STAT_LABEL[k]))}${sign}</span>`;
    }).join('');
}

function metaBits(line: BonusLine): string[] {
    const bits: string[] = [];
    if (line.level) bits.push(t('ov.erStarFrom', { n: line.level }));
    bits.push(line.num === 1 ? t('ov.erNoStack') : t('ov.erStack'));
    if (line.requiresAR) bits.push(t('ov.erNeedAirRadar'));
    if (line.requiresSR) bits.push(t('ov.erNeedSurfaceRadar'));
    if (line.requiresAccR) bits.push(t('ov.erNeedAccRadar'));
    return bits;
}

function pairGears(line: BonusLine, nameOf: (id: number) => string): string[] {
    return (line.requiresId ?? []).map(id => nameOf(id) || `#${id}`);
}

function pairNotes(line: BonusLine): string[] {
    const bits: string[] = [];
    if (line.requiresIdNum && line.requiresIdNum > 1) bits.push(t('ov.erPairNum', { n: line.requiresIdNum }));
    if (line.requiresIdLevel) bits.push(t('ov.erPairStar', { n: line.requiresIdLevel }));
    if (line.requiresType?.length) bits.push(t('ov.erNeedType'));
    if (line.requiresEquipList) bits.push(t('ov.erMutual'));
    return bits;
}

export const equipRefSection: OverviewSection = {
    id: 'equip-ref',
    titleKey: 'ov.equipRef',
    render(el, ctx) {
        const owned = ctx.state.ownedShips();
        if (!owned.length) {
            el.innerHTML = `<div class="ov-empty">${esc(t('ov.erNone'))}</div>`;
            return;
        }

        const prefs = loadPrefs();
        const catalog = [...ctx.state.master.entries()]
            .filter(([, m]) => (m.sortno ?? 0) > 0)
            .map(([id, m]) => ({ id, nameJa: m.name, ctype: m.ctype }));
        const gears: EquipRefGear[] = [...ctx.state.masterGears.entries()]
            .filter(([, g]) => (g.sortNo ?? 0) > 0)
            .map(([id, g]) => ({
                id, cat: g.cat, sortNo: g.sortNo ?? id, leng: g.stats.leng ?? 0, icon: g.icon,
            }))
            .sort((a, b) => a.cat - b.cat || a.sortNo - b.sortNo);
        const gearName = (id: number) => ctx.state.gearName(id);
        const gearById = new Map(gears.map(g => [g.id, g]));
        const catName = (cat: number) =>
            localizeEquipmentType(cat, ctx.state.masterEquipTypes.get(cat) ?? '') || `#${cat}`;
        const fitRules: FitRule[] = buildFitRules(
            [...ctx.state.masterGears.entries()].map(([id, g]) => ({ id, nameJa: g.name })),
            catalog,
        );
        const ownedMst = new Set(ctx.state.ownedGears().map(g => g.mst));

        const refs: EquipRefShip[] = owned.map(s => ({
            masterId: s.masterId,
            baseId: s.baseMst ?? s.masterId,
            stype: s.stypeId,
            ctype: s.ctype,
            country: nationToBonusCountry(nationOf(s.ctype)),
            equipCats: s.equipTypes,
            bbGroup: bbGroupOf({
                masterId: s.masterId,
                stype: s.stypeId,
                taik0: ctx.state.master.get(s.masterId)?.taik0 ?? 0,
            }),
        }));
        const allMarks = markEquipRefShips(refs, gears, EQUIP_BONUS_TABLE, fitRules);
        const ships: ShipRow[] = owned
            .map((s, i) => ({
                ...refs[i],
                instId: s.id,
                name: s.name,
                nameJa: ctx.state.shipNameJa(s.masterId),
                stypeName: s.stype,
                soku: s.soku,
                lv: s.lv,
                ...allMarks[i],
            }))
            .sort((a, b) => b.lv - a.lv || a.name.localeCompare(b.name, 'zh-Hant'));

        // 篩選晶片與列上標籤走艦娘全覽同一套消歧：stype 8／9 都叫「戰艦」時，
        // 多數高速的那群才加「高速」，低速側維持原樣。鍵仍是 stype id。
        const stypeLabel = new Map<number, string>();
        buildStypeLabels(ships.map(asStypeShip), stypeLabel);
        const stypes = [...stypeLabel.entries()].sort((a, b) => a[0] - b[0]);
        const flagship = ctx.state.fleets()[0]?.ships[0]?.id;
        let selected = ships.find(s => s.instId === flagship)?.instId ?? ships[0].instId;
        let q = '';
        let stype = 0;
        let onlyKnown = prefs.onlyKnown;
        let onlyOwned = prefs.onlyOwned;
        let kind = prefs.kind;
        const save = () => saveJsonPrefs(PREFS_KEY, { onlyKnown, onlyOwned, kind });

        el.innerHTML = `
        <div class="er">
            <div class="er-layout">
                <aside class="er-ships">
                    <div class="er-ships-head">
                        <h2>${esc(t('ov.erShips'))}</h2>
                        <input class="er-search" id="er-search" type="search" placeholder="${esc(t('ov.erSearch'))}" autocomplete="off">
                        <div class="er-stypes" id="er-stypes">
                            <button type="button" class="er-chip on" data-stype="0">${esc(t('ov.erKindAll'))}</button>
                            ${stypes.map(([id, name]) =>
            `<button type="button" class="er-chip" data-stype="${id}">${esc(name)}</button>`).join('')}
                        </div>
                        <div class="er-filters" id="er-known">
                            <button type="button" class="er-chip${onlyKnown ? '' : ' on'}" data-known="0">${esc(t('ov.erAllShips'))}</button>
                            <button type="button" class="er-chip${onlyKnown ? ' on' : ''}" data-known="1">${esc(t('ov.erKnownOnly'))}</button>
                        </div>
                        <div class="er-count" id="er-count"></div>
                    </div>
                    <div class="er-list" id="er-list" role="listbox" aria-label="${esc(t('ov.erShips'))}"></div>
                </aside>
                <section class="er-pane">
                    <div class="er-pane-head">
                        <div id="er-ident"></div>
                        <div class="er-sibs" id="er-sibs"></div>
                        <div class="er-filters" id="er-kind">
                            <button type="button" class="er-chip${kind === 'all' ? ' on' : ''}" data-kind="all">${esc(t('ov.erKindAll'))}</button>
                            <button type="button" class="er-chip${kind === 'bonus' ? ' on' : ''}" data-kind="bonus">${esc(t('ov.erKindBonus'))}</button>
                            <button type="button" class="er-chip${kind === 'fit' ? ' on' : ''}" data-kind="fit">${esc(t('ov.erKindFit'))}</button>
                        </div>
                        <div class="er-filters" id="er-stock">
                            <button type="button" class="er-chip${onlyOwned ? '' : ' on'}" data-stock="0">${esc(t('ov.erStockAll'))}</button>
                            <button type="button" class="er-chip${onlyOwned ? ' on' : ''}" data-stock="1">${esc(t('ov.erStockOwned'))}</button>
                        </div>
                        <div class="er-sum" id="er-sum" aria-live="polite"></div>
                    </div>
                    <div class="er-body" id="er-body"></div>
                </section>
            </div>
            <p class="ov-note dim">${esc(t('ov.erNote'))}</p>
        </div>`;

        const listEl = el.querySelector<HTMLElement>('#er-list')!;
        const bodyEl = el.querySelector<HTMLElement>('#er-body')!;
        const countEl = el.querySelector<HTMLElement>('#er-count')!;
        const identEl = el.querySelector<HTMLElement>('#er-ident')!;
        const sibEl = el.querySelector<HTMLElement>('#er-sibs')!;
        const sumEl = el.querySelector<HTMLElement>('#er-sum')!;
        const byBase = new Map<number, number[]>();
        for (const s of ships) {
            const list = byBase.get(s.baseId);
            if (list) list.push(s.instId); else byBase.set(s.baseId, [s.instId]);
        }

        const visibleShips = () => {
            const needle = q.trim().toLowerCase();
            return ships.filter(s => {
                if (stype && s.stype !== stype) return false;
                if (needle && !s.name.toLowerCase().includes(needle) && !s.nameJa.toLowerCase().includes(needle)) return false;
                if (onlyKnown && s.n === 0) return false;
                return true;
            });
        };

        const renderList = () => {
            const rows = visibleShips();
            countEl.textContent = t('ov.erCount', { shown: rows.length, total: ships.length });
            listEl.innerHTML = rows.map(s => {
                const dots = (s.hasBonus ? `<i class="er-dot bonus" title="${esc(t('ov.erKindBonus'))}"></i>` : '')
                    + (s.hasFit ? `<i class="er-dot fit" title="${esc(t('ov.erFit'))}"></i>` : '')
                    + (s.hasOver ? `<i class="er-dot over" title="${esc(t('ov.erOver'))}"></i>` : '');
                const on = s.instId === selected;
                return `<button type="button" class="er-ship${on ? ' on' : ''}" data-id="${s.instId}" aria-pressed="${on}">`
                    + `<span class="er-stype">${esc(shipStypeLabel(s))}</span>`
                    + `<span>${esc(s.name)}</span>`
                    + `<span class="er-lv">Lv.${s.lv}</span>`
                    + `<span class="er-marks">${dots}</span></button>`;
            }).join('') || `<p class="er-empty">${esc(t('ov.erNoShips'))}</p>`;
        };

        const bonusLineHtml = (line: BonusLine) => {
            const gearsNeeded = pairGears(line, gearName);
            const notes = pairNotes(line);
            const main = `<div class="er-line-main"><span class="er-k">${esc(t('ov.erBonus'))}</span>${fmtStats(line.bonus)}`
                + metaBits(line).map(c => `<span class="er-meta">${esc(c)}</span>`).join('')
                + '</div>';
            let pair = '';
            if (gearsNeeded.length || notes.length) {
                const chips = gearsNeeded.map(name => `<span class="er-pair-item">${esc(name)}</span>`)
                    .join(`<span class="er-pair-or">${esc(t('ov.erOr'))}</span>`);
                pair = `<div class="er-pair"><span class="er-pair-k">${esc(t('ov.erPair'))}</span>${chips}`
                    + notes.map(n => `<span class="er-pair-note">${esc(n)}</span>`).join('')
                    + '</div>';
            }
            return `<div class="er-line${pair ? ' er-line-pair' : ''}">${main}${pair}</div>`;
        };

        const rowHtml = (r: EquipRefRow) => {
            const g = gearById.get(r.id);
            if (!g) return '';
            const ownedGear = ownedMst.has(g.id);
            const leng = isMainGunCat(g.cat) && g.leng
                ? `<span class="er-leng">${esc(LENG_KEYS[g.leng] ? t(LENG_KEYS[g.leng]) : '')}</span>` : '';
            const lack = ownedGear ? '' : `<span class="er-lack">${esc(t('ov.erLack'))}</span>`;
            let fit = '';
            if (r.fit) {
                const over = r.fit.day < 0;
                const sign = r.fit.day > 0 ? `+${r.fit.day}` : String(r.fit.day);
                fit = `<div class="er-line"><div class="er-line-main"><span class="er-k">${esc(t(over ? 'ov.erOver' : 'ov.erFit'))}</span>`
                    + `<span class="${over ? 'er-overv' : 'er-fitv'}">${esc(t('ov.erFitDay', { n: sign }))}</span>`
                    + (r.fit.unverified ? `<span class="er-meta">${esc(t('ov.erUnverified'))}</span>` : '')
                    + '</div></div>';
            }
            return `<article class="er-row${ownedGear ? '' : ' lack'}">${gearIconHtml(g.icon, gearName(g.id))}`
                + `<div><div class="er-name">${esc(gearName(g.id))}${leng}${lack}</div>`
                + `<div class="er-lines">${r.lines.map(bonusLineHtml).join('')}${fit}</div></div></article>`;
        };

        const renderPane = () => {
            const ship = ships.find(s => s.instId === selected) ?? ships[0];
            if (!ship) return;
            selected = ship.instId;
            identEl.innerHTML = `<div class="er-identity"><strong>${esc(ship.name)}</strong>`
                + `<span class="er-lv">Lv.${ship.lv}</span>`
                + `<span class="er-ja" title="${esc(t('ov.erNameJa'))}">${esc(ship.nameJa)}</span>`
                + `<span class="er-stype">${esc(shipStypeLabel(ship))}</span></div>`;
            const sibs = byBase.get(ship.baseId) ?? [];
            sibEl.hidden = sibs.length < 2;
            sibEl.innerHTML = sibs.length < 2 ? '' : sibs.map(instId => {
                const s = ships.find(x => x.instId === instId)!;
                return `<button type="button" class="er-sib${instId === ship.instId ? ' on' : ''}" data-id="${instId}">`
                    + `${esc(s.name)}${s.lv ? ` Lv.${s.lv}` : ''}</button>`;
            }).join('');
            const collected = collectEquipRef(ship, gears, EQUIP_BONUS_TABLE, fitRules);
            const rows = collected.filter(r => {
                if (kind === 'bonus' && !r.lines.length) return false;
                if (kind === 'fit' && !r.fit) return false;
                if (onlyOwned && !ownedMst.has(r.id)) return false;
                return true;
            });
            const nBonus = rows.filter(r => r.lines.length).length;
            const nFit = rows.filter(r => r.fit && r.fit.day > 0).length;
            const nOver = rows.filter(r => r.fit && r.fit.day < 0).length;
            const nLack = rows.filter(r => !ownedMst.has(r.id)).length;
            sumEl.innerHTML = rows.length
                ? `<span class="bonus">${esc(t('ov.erBonus'))} ${nBonus}</span>`
                    + `<span class="fit">${esc(t('ov.erFitPos'))} ${nFit}</span>`
                    + `<span class="over">${esc(t('ov.erOver'))} ${nOver}</span>`
                    + (onlyOwned ? '' : `<span>${esc(t('ov.erLack'))} ${nLack}</span>`)
                : esc(t('ov.erNoGears'));
            if (!rows.length) {
                bodyEl.innerHTML = `<p class="er-empty">${esc(collected.length ? t('ov.erNoGears') : t('ov.erNoData'))}</p>`;
                return;
            }
            const guns = rows.filter(r => isMainGunCat(gearById.get(r.id)?.cat ?? 0)).sort((a, b) => {
                const ga = gearById.get(a.id)!, gb = gearById.get(b.id)!;
                const fa = a.fit ? a.fit.day : -999, fb = b.fit ? b.fit.day : -999;
                return (fb - fa) || (gb.leng - ga.leng) || (ga.sortNo - gb.sortNo) || (a.id - b.id);
            });
            const rest = rows.filter(r => !isMainGunCat(gearById.get(r.id)?.cat ?? 0)).sort((a, b) => {
                const ga = gearById.get(a.id)!, gb = gearById.get(b.id)!;
                return (ga.cat - gb.cat) || (ga.sortNo - gb.sortNo) || (a.id - b.id);
            });
            const groups: { cat: number; name: string; icon: number; rows: EquipRefRow[] }[] = [];
            if (guns.length) groups.push({ cat: 0, name: t('ov.erMainGun'), icon: gearById.get(guns[0].id)?.icon ?? 0, rows: guns });
            let last: (typeof groups)[number] | null = null;
            for (const r of rest) {
                const g = gearById.get(r.id)!;
                if (!last || last.cat !== g.cat) {
                    last = { cat: g.cat, name: catName(g.cat), icon: g.icon, rows: [] };
                    groups.push(last);
                }
                last.rows.push(r);
            }
            bodyEl.innerHTML = groups.map(group =>
                `<section class="er-group"><h3>${gearIconHtml(group.icon, group.name)}${esc(group.name)}</h3>`
                + group.rows.map(rowHtml).join('') + '</section>').join('');
        };

        const selectShip = (id: number) => {
            selected = id;
            renderList();
            renderPane();
            el.querySelector('.er-ship.on')?.scrollIntoView({ block: 'nearest' });
        };

        el.querySelector('#er-search')!.addEventListener('input', ev => {
            q = (ev.target as HTMLInputElement).value;
            renderList();
        });
        el.querySelector('#er-stypes')!.addEventListener('click', ev => {
            const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-stype]');
            if (!btn) return;
            stype = Number(btn.getAttribute('data-stype'));
            el.querySelectorAll('#er-stypes .er-chip').forEach(chip => {
                chip.classList.toggle('on', Number(chip.getAttribute('data-stype')) === stype);
            });
            renderList();
        });
        el.querySelector('#er-known')!.addEventListener('click', ev => {
            const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-known]');
            if (!btn) return;
            onlyKnown = btn.getAttribute('data-known') === '1';
            save();
            el.querySelectorAll('#er-known .er-chip').forEach(chip => {
                chip.classList.toggle('on', (chip.getAttribute('data-known') === '1') === onlyKnown);
            });
            renderList();
        });
        el.querySelector('#er-kind')!.addEventListener('click', ev => {
            const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-kind]');
            if (!btn) return;
            const next = btn.getAttribute('data-kind');
            kind = next === 'bonus' || next === 'fit' ? next : 'all';
            save();
            el.querySelectorAll('#er-kind .er-chip').forEach(chip => {
                chip.classList.toggle('on', chip.getAttribute('data-kind') === kind);
            });
            renderPane();
        });
        el.querySelector('#er-stock')!.addEventListener('click', ev => {
            const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-stock]');
            if (!btn) return;
            onlyOwned = btn.getAttribute('data-stock') === '1';
            save();
            el.querySelectorAll('#er-stock .er-chip').forEach(chip => {
                chip.classList.toggle('on', (chip.getAttribute('data-stock') === '1') === onlyOwned);
            });
            renderPane();
        });
        listEl.addEventListener('click', ev => {
            const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-id]');
            if (btn) selectShip(Number(btn.getAttribute('data-id')));
        });
        sibEl.addEventListener('click', ev => {
            const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-id]');
            if (btn) selectShip(Number(btn.getAttribute('data-id')));
        });
        renderList();
        renderPane();
    },
};
