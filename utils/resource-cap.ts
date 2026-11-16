// 資源上限與自然回復的推算（純函式，無 chrome.*／DOM）。
// 規則出處是 wikiwiki「資材」頁（文字規則，不是封包欄位），所以回復量一律是推算：
//   · 基本資源每 3 分鐘自然回復（燃料、彈藥、鋼材 +3，鋁土 +1），玩家不在線上也照回。
//   · 持有量達到「自然回復上限」（司令部等級 × 250 + 750）就停止回復；其他來源的收入可以超過它。
//   · 蓄積上限：基本資源 350,000，高速建造材、高速修復材、開發資材、改修資材 3,000。
//     超過蓄積上限的收入是否一律作廢未經封包驗證，所以只說「可能溢出」；持有量本身可以超過上限
//     （例如轟沈返還資材），不是資料錯誤。
//   · 基地航空隊設為休息時鋁土回復減半；封包沒有逐時的基地狀態，這裡不計。
import type { Sample } from './resource-log';

export const BASIC_HARD_CAP = 350_000;
export const SPECIAL_HARD_CAP = 3_000;
/** api_material 索引 0–3 為基本資源，其餘為離散資材。 */
export const hardCapOf = (mat: number) => (mat < 4 ? BASIC_HARD_CAP : SPECIAL_HARD_CAP);
export const naturalCapOf = (hqLv: number) => hqLv * 250 + 750;

export const REGEN_TICK_MS = 180_000;
const REGEN_PER_TICK = [3, 3, 3, 1] as const;

/**
 * 相鄰兩筆餘額之間的自然回復推算。`span` 是期間內（含兩端）已排序的餘額取樣。
 * 每一段的最大可能量＝整數個 3 分鐘 × 每次回復量；實際量受兩端較低的餘額距上限的空間限制
 * （兩端都在上限以上則停擺）。段內玩家可能先花掉再回復，所以這是推算，不是封包事實。
 * stalled＝兩端都在上限以上的段落「本來可以回復多少」，是自然回復被浪費的上界。
 */
export function estimateRegen(span: readonly Sample[], mat: 0 | 1 | 2 | 3, naturalCap: number): { regen: number; stalled: number } {
    let regen = 0, stalled = 0;
    for (let i = 1; i < span.length; i++) {
        const potential = Math.floor((span[i].ts - span[i - 1].ts) / REGEN_TICK_MS) * REGEN_PER_TICK[mat];
        const low = Math.min(span[i - 1].m[mat] ?? 0, span[i].m[mat] ?? 0);
        if (low >= naturalCap) stalled += potential;
        else regen += Math.min(potential, naturalCap - low);
    }
    return { regen, stalled };
}

/**
 * 落在「已滿」資源上的收入合計：事件前一筆與後一筆餘額都在 cap 以上才算。
 * 兩筆取樣之間可能先花掉再收入，所以是提醒用的推算；事件時刻須落在 span 內（期初之後、期末含）。
 */
export function incomeAtCap(span: readonly Sample[], events: readonly { ts: number; amount: number }[], mat: number, cap: number): number {
    let total = 0;
    for (const event of events) {
        if (event.amount <= 0) continue;
        const next = span.findIndex(sample => sample.ts >= event.ts);
        if (next > 0 && (span[next - 1].m[mat] ?? 0) >= cap && (span[next].m[mat] ?? 0) >= cap) total += event.amount;
    }
    return total;
}
