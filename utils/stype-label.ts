// 同名艦種的消歧（遊戲的 api_mst_stype 把 id 8／9 都叫「戰艦」）。
//
// 高速／低速**不是艦種本身**，要靠 api_soku 合判（見 ship-filter.ts 檔頭）——篩選
// （matchSpeed／matchEquip）與量表統計絕不可用 stype id 當航速捷徑。樣本中 stype 8
// 同時有高速與低速艦（Гангут 線），stype 9 也同時有低速與高速艦（深海戰艦棲姫改），
// stype 9 有 75 艘低速但也有 3 艘高速（深海戰艦棲姫改）。**故 id → 航速的硬對映是錯的。**
//
// 但「兩顆長得一模一樣的『戰艦』checkbox」使用者根本分不出哪顆是哪群，比誤差更難用。
// 折衷：**只在名稱真的重複時才加註**，且加註依據是名冊裡該群實際多數的航速，不是 id：
// 多數為高速的那群顯示「高速戰艦」，另一群維持原樣「戰艦」。低速側刻意不加註——使用者
// 要的只是把高速那群認出來，兩邊都改反而多一組要記的詞。
// 精確的航速條件仍在獨立的航速篩選器，這裡只是標籤。
import { SOKU } from './ship-filter';
import { t } from './ui-i18n';

export interface StypeLabelShip {
    stype: string;
    stypeId: number;
    soku: number;
}

const ambiguousStypeIds = new Set<number>();

/**
 * 逐艦的艦種欄。這裡的 api_soku 是**該艘船自己的**封包事實（不是群組多數），故
 * Гангут 這種 stype 8 的低速艦會正確顯示「戰艦」而不是「高速戰艦」。
 * 只有同名艦種才加註；缺值（soku 0）一律回原樣，不把未知誤判成低速。
 */
export function stypeDisplayLabel(ship: StypeLabelShip): string {
    if (!ambiguousStypeIds.has(ship.stypeId)) return ship.stype;
    return ship.soku >= SOKU.fast ? t('ov.rsStypeFast', { stype: ship.stype }) : ship.stype;
}

/**
 * 依名冊算出每個 stype id 的篩選標籤，並更新 `ambiguousStypeIds`。
 * checkbox 是群組層級（一個 id 一顆），無法逐艦判航速，故以群組多數決定加註。
 */
export function buildStypeLabels(roster: StypeLabelShip[], into: Map<number, string>): void {
    const name = new Map<number, string>();
    const fast = new Map<number, number>();
    const total = new Map<number, number>();
    for (const s of roster) {
        if (!name.has(s.stypeId)) name.set(s.stypeId, s.stype);
        total.set(s.stypeId, (total.get(s.stypeId) ?? 0) + 1);
        if (s.soku >= SOKU.fast) fast.set(s.stypeId, (fast.get(s.stypeId) ?? 0) + 1);
    }
    const byName = new Map<string, number[]>();
    for (const [id, n] of name) byName.set(n, [...(byName.get(n) ?? []), id]);

    into.clear();
    ambiguousStypeIds.clear();
    for (const [, ids] of byName) {
        // 名稱沒撞在一起就沒有歧義，一個字都不動。
        if (ids.length < 2) { for (const id of ids) into.set(id, name.get(id)!); continue; }
        for (const id of ids) {
            ambiguousStypeIds.add(id);
            const majorityFast = (fast.get(id) ?? 0) * 2 > (total.get(id) ?? 0);
            into.set(id, majorityFast ? t('ov.rsStypeFast', { stype: name.get(id)! }) : name.get(id)!);
        }
    }
}
