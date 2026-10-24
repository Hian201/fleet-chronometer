// 常規導航規則資料（彙整）—— 逐張圖由 wikiwiki.jp/kancolle 各海域頁「ルート分岐法則」表人工轉寫。
// 規則本體分在 route-rules-eo.ts（Extra Operation）與 route-rules-w1～w7.ts（各大區）。
//
// 轉寫約定：
//   · 每個分岐點的規則順序與 wiki 表完全相同（由上而下、第一條成立者決定）；「それ以外」＝不寫 if。
//   · wiki 標「?」的門檻或規則標 tentative；「〜寄り(N%)」寫成 bias；只寫「〜寄り」沒給比例者比例為 null；
//     範圍表記（90～95％）取下限並標推定。
//   · 「ランダム」沒寫去向時，去向是該分岐點的全部出口。
//   · 索敵門檻的分岐點係數（cn）取自 wikiwiki「ルート分岐」頁「分岐点係数と閾値」表；表中標「?」的
//     係數照用並標 tentative。下限值或係數不明的區間寫成 unknown，不推算。
//   · wiki 沒有給條件的規則（只寫「索敵」「不明」等）寫成 unknown；表裡沒有列的節點不寫：
//     出口只有一條時判定器視為固定。
//   · 出擊點只有一個的海域，出擊規則以出擊點名稱（'1'）為鍵；有多個出擊點的海域用 ''。
//   · 海域有量表階段或機關（5-6、7-2、7-3、7-5）時，以 stages 定義目標點與旗標，規則裡用 { phase } 判斷。
//   · 艦種群組定義見 route-predict.ts 的 SHIP_GROUPS（對應 wiki「注意すべき艦種表記一覧」）；
//     指定艦的 master id 見 SHIP_SETS。
//
// 更新：wiki 頁面的「ルート分岐法則更新日」變動時，逐條重新核對該圖，並更新 updated／checked。
import { EO_RULES } from './route-rules-eo';
import { W1_RULES } from './route-rules-w1';
import { W2_RULES } from './route-rules-w2';
import { W3_RULES } from './route-rules-w3';
import { W4_RULES } from './route-rules-w4';
import { W5_RULES } from './route-rules-w5';
import { W6_RULES } from './route-rules-w6';
import { W7_RULES } from './route-rules-w7';
import type { MapRules } from './route-predict';

export const ROUTE_RULES: Record<string, MapRules> = {
    ...W1_RULES, ...W2_RULES, ...W3_RULES, ...W4_RULES, ...W5_RULES, ...W6_RULES, ...W7_RULES,
    ...EO_RULES,
};
