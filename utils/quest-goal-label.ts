// 條件表子目標的顯示標籤（依目前語言）。panel 與情報總括共用，不使用來源資料的說明文字。
import { eventMinRank, isBossEvent, isPracticeEvent, mapListLabel } from './quest-goals';
import type { QuestConditionCheck, QuestTargetView } from './state';
import { expedDisplayName, getLang, t } from './ui-i18n';

export function stypeLabel(id: number): string {
    const key = `stype.${id}`;
    const value = t(key);
    return value === key ? String(id) : value;
}

/** 例：「5-6-Z 王點 S」「1-6-N 抵達」「擊沉 空母」「2-1〜2-5 王點 B」。 */
export function questTargetLabel(target: QuestTargetView): string {
    const joiner = getLang() === 'en' ? ', ' : '、';
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
