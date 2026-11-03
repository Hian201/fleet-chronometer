// 條件表子目標的顯示標籤（依目前語言）。panel 與情報總括共用，不使用來源資料的說明文字。
import { eventMinRank, isBossEvent, isPracticeEvent, mapListLabel } from './quest-goals';
import type { QuestConditionCheck, QuestPrepView, QuestTargetView } from './state';
import type { PrepCheck, PrepItem } from './quest-prep';
import { itemCatalog } from './item-catalog';
import { expedDisplayName, getLang, t } from './ui-i18n';

export function stypeLabel(id: number): string {
    const key = `stype.${id}`;
    const value = t(key);
    return value === key ? String(id) : value;
}

const FACTORY_LABEL_KEYS: Record<string, string> = {
    supply: 'quest.goal.supply', repair: 'quest.goal.repair', create_item: 'quest.goal.develop',
    create_ship: 'quest.goal.build', destroy_ship: 'quest.goal.scrapShip', remodel_item: 'quest.goal.improve',
};

/** 工廠、補給入渠與近代化改修的子目標；其他事件回傳 null。 */
function factoryTargetLabel(target: QuestTargetView, joiner: string): string | null {
    if (target.event === 'destory_item') {
        const items = target.gearTypes ?? target.gears;
        return items ? t('quest.goal.scrapGear', { items: items.join(joiner) }) : t('quest.goal.scrapTimes');
    }
    if (target.event === 'remodel_ship') {
        return target.material
            ? t('quest.goal.modernizeWith', { types: target.material.types.map(stypeLabel).join(joiner), n: target.material.min })
            : t('quest.goal.modernize');
    }
    const key = FACTORY_LABEL_KEYS[target.event];
    return key ? t(key) : null;
}

/** 例：「5-6-Z 王點 S」「1-6-N 抵達」「擊沉 空母」「2-1〜2-5 王點 B」「廢棄 機銃」。 */
export function questTargetLabel(target: QuestTargetView): string {
    const joiner = getLang() === 'en' ? ', ' : '、';
    const factory = factoryTargetLabel(target, joiner);
    if (factory) return factory;
    if (isPracticeEvent(target.event)) return [t('quest.practice'), eventMinRank(target.event) ?? ''].filter(Boolean).join(' ');
    if (target.event === 'mission_success') {
        return target.missions
            ? t('quest.goal.mission', { names: target.missions.map(item => expedDisplayName(item.id, item.name)).join(joiner) })
            : t('quest.goal.missionAny');
    }
    if (target.event === 'sinking') {
        return t('quest.goal.sink', { types: (target.shipType ?? []).map(stypeLabel).join(joiner) || '—' });
    }
    const maps = target.maparea ? mapListLabel(target.maparea) : '';
    const place = target.nodeLetters.length ? `${maps}-${target.nodeLetters.join('/')}` : maps;
    const rank = eventMinRank(target.event) ?? '';
    const what = target.event === 'reach_mapcell' ? t('quest.goal.reach')
        : target.event === 'sally' ? t('quest.goal.sally')
            : isBossEvent(target.event) ? t('quest.boss')
                : t('quest.goal.battle');
    return [place, what, rank].filter(Boolean).join(' ');
}

/** panel 進度格用的短標籤：只留海域與節點；擊沉與抵達仍需說明事件。 */
export function questTargetShortLabel(target: QuestTargetView): string {
    if (target.event === 'mission_success' && target.missions) return target.missions.map(item => item.dispNo).join('/');
    // 多個廢棄子目標並列時只差在裝備，格子裡只放裝備類別／名稱。
    const items = target.gearTypes ?? target.gears;
    if (target.event === 'destory_item' && items) return items.join('/');
    if (factoryTargetLabel(target, '、')) return questTargetLabel(target);
    if (target.event === 'sinking' || target.event === 'reach_mapcell' || isPracticeEvent(target.event) || target.event === 'mission_success') {
        return questTargetLabel(target);
    }
    const maps = target.maparea ? mapListLabel(target.maparea) : '';
    if (!maps) return questTargetLabel(target);
    return target.nodeLetters.length ? `${maps}-${target.nodeLetters.join('/')}` : maps;
}

export interface QuestConditionNames {
    ships: Record<number, string>;
    classes: Record<number, string>;
}

/** 編成條件的完整說明，例：「僚艦：鳥海、鈴谷… 中 ≥2」。情報總括表格與 panel 標籤的提示共用。 */
export function questConditionText(check: QuestConditionCheck, names: QuestConditionNames): string {
    const joiner = getLang() === 'en' ? ', ' : '、';
    const ships = (ids: readonly number[]) => ids.map(id => names.ships[id] ?? `#${id}`).join(joiner);
    const types = (ids: readonly number[]) => ids.map(stypeLabel).join(joiner);
    const classes = (ids: readonly number[]) => ids.map(id => t('ov.qpClassOf', { name: names.classes[id] ?? `#${id}` })).join(joiner);
    const excl = check.ignoreFlagship ? t('ov.qpExclFlagship') : '';
    const n = check.min ?? 0;
    switch (check.kind) {
        case 'flagshipId': return t('ov.qpFlagship', { ships: ships(check.ids) });
        case 'secondshipId': return t('ov.qpSecond', { ships: ships(check.ids) });
        case 'escortshipId': return t('ov.qpEscortAny', { ships: ships(check.ids), n }) + excl;
        case 'escortshipIdAll': return t('ov.qpEscort', { ships: ships(check.ids), n }) + excl;
        case 'flagshiptype': return t('ov.qpFlagshipType', { types: types(check.ids) });
        case 'escortshiptype': return t('ov.qpTypeCount', { types: types(check.ids), n }) + excl;
        case 'flagshipclass': return t('ov.qpFlagshipClass', { classes: classes(check.ids) });
        case 'secondshipclass': return t('ov.qpSecondClass', { classes: classes(check.ids) });
        case 'escortshipclass': return t('ov.qpClassCount', { classes: classes(check.ids), n }) + excl;
        case 'fleetlimit': return t('ov.qpFleetLimit', { n: check.limit ?? 0 });
        default: return t('ov.qpBanType', { types: types(check.ids) });
    }
}

/** panel 用的短標籤：旗艦／第二艦只標位置；數量條件標「目前／需要」；艦種全部列出，避免兩條相似條件看不出差別。 */
export function questConditionShort(check: QuestConditionCheck): string {
    const count = `${Math.min(check.hits.length, check.min ?? 0)}/${check.min ?? 0}`;
    switch (check.kind) {
        case 'flagshipId': case 'flagshiptype': case 'flagshipclass': return t('quest.cond.flagship');
        case 'secondshipId': case 'secondshipclass': return t('quest.cond.second');
        case 'escortshipId': case 'escortshipIdAll': return `${t('quest.cond.escort')} ${count}`;
        case 'escortshiptype': return `${check.ids.map(stypeLabel).join('/')} ${count}`;
        case 'escortshipclass': return `${t('quest.cond.class')} ${count}`;
        case 'fleetlimit': return t('quest.cond.fleetLimit', { n: check.limit ?? 0 });
        default: return t('quest.cond.banned');
    }
}

// ── 任務達成條件（編成、裝備準備、海域攻略）──────────────────────────

const RESOURCE_KEYS = ['fuel', 'ammo', 'steel', 'bauxite'];

/** 道具名（目前語言）：取自道具目錄；家具幣另有譯名。 */
export function prepItemName(item: PrepItem): string {
    if (item.kind === 'fcoin') return t('quest.prep.fcoin');
    const found = itemCatalog.find(entry => entry.countSource.kind === item.kind
        && (entry.countSource.kind === 'material' ? entry.countSource.apiId : (entry.countSource as { id: number }).id) === item.id);
    return found ? found.names[getLang()] : `#${item.id}`;
}

function lvText(lv: [number, number | null] | undefined): string {
    if (!lv) return '';
    return lv[1] === null ? t('ov.qpLvMin', { lo: lv[0] }) : t('ov.qpLvRange', { lo: lv[0], hi: lv[1] });
}

function gearExtra(check: PrepCheck): string {
    return [
        check.star ? (check.star >= 10 ? t('ov.qpStarMax') : t('ov.qpStarMin', { n: check.star })) : '',
        check.alv ? t('ov.qpAlvMax') : '',
    ].filter(Boolean).join(' ');
}

function sizeRange(check: PrepCheck): string {
    if (check.min && check.max) return check.min === check.max ? String(check.min) : `${check.min}〜${check.max}`;
    return check.max ? `≤${check.max}` : `≥${check.min ?? 1}`;
}

/** 達成條件的完整說明，例：「旗艦：鳳翔」「未裝備的 九六式艦戦 ×3」「鋼材 18,000」。 */
export function prepCheckText(check: PrepCheck, names: QuestPrepView['names']): string {
    const joiner = getLang() === 'en' ? ', ' : '、';
    const ships = (ids: readonly number[]) => ids.map(id => names.ships[id] ?? `#${id}`).join(joiner);
    const types = (ids: readonly number[]) => ids.map(stypeLabel).join(joiner);
    const classes = (ids: readonly number[]) => ids.map(id => t('ov.qpClassOf', { name: names.classes[id] ?? `#${id}` })).join(joiner);
    const gear = (id: number) => names.gears[id] ?? `#${id}`;
    const extra = gearExtra(check);
    switch (check.kind) {
        case 'flag': return (check.ids.length ? t('ov.qpFlagship', { ships: ships(check.ids) }) : t('ov.qpFlagshipAny')) + lvText(check.lv);
        case 'second': return t('ov.qpSecond', { ships: ships(check.ids) }) + lvText(check.lv);
        case 'ships': return check.ids.length === 1 && check.need === 1
            ? t('ov.qpHasShip', { ships: ships(check.ids) })
            : t('ov.qpShipsCount', { ships: ships(check.ids), n: check.need });
        case 'flagType': return t('ov.qpFlagshipType', { types: types(check.ids) });
        case 'types': return t('ov.qpTypeCount', { types: types(check.ids), n: check.need });
        case 'flagClass': return t('ov.qpFlagshipClass', { classes: classes(check.ids) }) + lvText(check.lv);
        case 'classes': return t('ov.qpClassCount', { classes: classes(check.ids), n: check.need }) + lvText(check.lv);
        case 'classesMax': return t('ov.qpClassMax', { classes: classes(check.ids), n: check.need });
        case 'size': return t('ov.qpFleetSize', { range: sizeRange(check) });
        case 'ban': return t('ov.qpBanType', { types: types(check.ids) });
        case 'fast': return t('ov.qpFast');
        case 'slot': return (check.slot ? t('ov.qpSlot', { slot: check.slot, gear: gear(check.ids[0]) }) : t('ov.qpSlotAny', { gear: gear(check.ids[0]) }))
            + (extra ? ` ${extra}` : '') + (check.locked ? t('ov.qpSlotLocked') : '');
        case 'hold': return t('ov.qpHold', { gear: gear(check.ids[0]) + (extra ? ` ${extra}` : ''), n: check.need })
            + (check.locked ? t('ov.qpHoldLocked', { n: check.locked }) : '');
        case 'resource': return t('ov.qpResource', { name: t(`mat.${RESOURCE_KEYS[check.resource ?? 0]}.full`), n: check.need.toLocaleString('en-US') });
        case 'item': return t('ov.qpItem', { name: check.item ? prepItemName(check.item) : '?', n: check.need.toLocaleString('en-US') });
        case 'map': return t('ov.qpMapClear', { map: `${Math.floor(check.ids[0] / 10)}-${check.ids[0] % 10}` });
    }
}

/** 目前狀態的文字：數量類「目前／需要」，其餘符合與否由狀態欄表示；不可考為「—」。 */
export function prepCheckNow(check: PrepCheck): string {
    if (check.have === null) return '—';
    if (check.kind === 'size') return String(check.have);
    if (check.kind === 'fast') return check.have ? t('ov.qpSlowCount', { n: check.have }) : '';
    if (check.kind === 'ban' || check.kind === 'classesMax') return String(check.have);
    if (check.kind === 'hold' && check.locked) return `${check.have}/${check.need} ${t('quest.cond.locked', { n: check.locked })}`;
    if (check.kind === 'slot' && check.locked) return t('quest.cond.lockedSlot');
    if (['ships', 'types', 'classes', 'hold', 'resource', 'item'].includes(check.kind)) {
        return `${check.have.toLocaleString('en-US')}/${check.need.toLocaleString('en-US')}`;
    }
    return '';
}

/** panel 用的短標籤：艦名、艦種或裝備名加上「目前／需要」，完整說明放在提示。 */
export function prepCheckShort(check: PrepCheck, names: QuestPrepView['names']): string {
    const count = check.have === null ? '?' : `${Math.min(check.have, check.need)}/${check.need}`;
    switch (check.kind) {
        case 'flag': case 'flagType': case 'flagClass': return t('quest.cond.flagship');
        case 'second': return t('quest.cond.second');
        case 'ships': return check.ids.length === 1 && check.need === 1 ? names.ships[check.ids[0]] ?? `#${check.ids[0]}` : `${t('quest.cond.escort')} ${count}`;
        case 'types': return `${check.ids.map(stypeLabel).join('/')} ${count}`;
        case 'classes': return `${t('quest.cond.class')} ${count}`;
        case 'classesMax': return `${t('quest.cond.class')} ≤${check.need}`;
        case 'size': return t('quest.cond.fleetSize', { range: sizeRange(check) });
        case 'ban': return t('quest.cond.banned');
        case 'fast': return t('quest.cond.fast');
        case 'slot': return (names.gears[check.ids[0]] ?? `#${check.ids[0]}`) + (check.locked ? ` ${t('quest.cond.lockedSlot')}` : '');
        case 'hold': return `${names.gears[check.ids[0]] ?? `#${check.ids[0]}`} ${count}` + (check.locked ? ` ${t('quest.cond.locked', { n: check.locked })}` : '');
        case 'resource': return `${t(`mat.${RESOURCE_KEYS[check.resource ?? 0]}`)} ${check.have === null ? '?' : check.have.toLocaleString('en-US')}/${check.need.toLocaleString('en-US')}`;
        case 'item': return `${check.item ? prepItemName(check.item) : '?'} ${check.have === null ? '?' : check.have.toLocaleString('en-US')}/${check.need.toLocaleString('en-US')}`;
        case 'map': return `${Math.floor(check.ids[0] / 10)}-${check.ids[0] % 10}`;
    }
}
