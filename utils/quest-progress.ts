// 任務「本機進度追蹤」（純函式，無 chrome.*，node 可測）。
//
// 遊戲的 questlist 封包只給 api_state（受注中/達成）與 api_progress_flag（0/50%/80%
// 的粗略量表），**完全不給精確的「已完成幾次」數字**——這與燃彈、資源餘額同樣是
// 「伺服器不送這個欄位」的處境。故本檔做的是「從任務標題/內文描述反推目標次數與
// 動作種類，再由本機觀測到的封包動作累加計數」，答案永遠是「自本次面板看到這個任務
// 以來，我方觀測到幾次」——若任務接受前就已有進度，這個數字會低於遊戲內實際值
// （同 ship-debut-data.ts 的「date2 打撈上任日」baseline 誠實原則，不假裝知道看不到的部分）。
//
// 只認得出目標次數的任務才給進度（例：「遠征」を10回成功させよう／近代化改修を
// 2回以上成功させよ／入渠系任務的「N隻...ドック入り」，見下方白名單）；沒有「N回」
// 字樣、也不符合入渠白名單的任務（單次型、或以「隻」為單位的擊沈/擊破數任務）一律
// 回傳 null，UI 應回退顯示預設的「受注中／達成」。寧可少一個進度條，也不要在無法
// 可靠判斷「該數什麼」時瞎猜（同「節點字母」不推算的原則）。

export type QuestActionKind =
    | 'sortie'          // 出撃（api_req_map/start，每次出擊算一次）
    | 'expedition'      // 遠征成功（api_req_mission/result，api_clear_result >= 1）
    | 'build'           // 建造（api_get_member/kdock 偵測到新建造單）
    | 'development'     // 開發（api_req_kousyou/createitem，不論成敗——遊戲本身允許「失敗もOK」）
    | 'supply'          // 補給（api_req_hokyu/charge，每次送出補給算一次）
    | 'dock'            // 入渠（api_req_nyukyo/start，每次送出入渠算一次）
    | 'modernization'    // 近代化改修（api_req_kaisou/powerup，遊戲機制上必定成功）
    | 'remodel'         // 裝備改修（api_req_kousyou/remodel_slot，僅成功才算）
    | 'remodelAttempt'  // 裝備改修「嘗試」次數（同端點，不論成敗都算，見下方 619／QUEST_ID_OVERRIDES）
    | 'practiceAttempt' // 演習挑戰次數（api_req_practice/battle）
    | 'practiceWin'     // 演習勝利次數（演習結果 rank 為勝利，見下方注意事項）
    | 'battleWin'       // 出擊戰鬥勝利（battleresult rank 為 S/A/B），見下方 QUEST_ID_OVERRIDES
    | 'battleEngage'    // 出擊戰鬥「發生」次數（battleresult 觸發即算，不論勝敗），見下方 QUEST_ID_OVERRIDES
    | 'shipScrap'       // 解體艦娘（api_req_kaisou/destroyship，一次可解體多艘，逐艘計數）
    | 'gearScrap';       // 廢棄裝備（api_req_kaisou/destroyitem2，一次可廢棄多個，逐個計數）

export interface QuestGoal {
    kind: QuestActionKind;
    target: number;
    // 以下皆為選填的額外過濾條件，只有 `battleWin`／`battleEngage`／`expedition` 部分任務
    // 會用到；缺席時代表該條件不受限制。見 QUEST_ID_OVERRIDES 226/229/241/242/243/
    // 261/265（海域/boss/rank）與 410/411/424（遠征任務 id）。
    area?: readonly number[];       // 限定海域 mapKey（`mapArea*10+mapNo`，與 CLAUDE.md「海域編號結構」同一套）
    bossOnly?: boolean;             // 是否限定 boss 節點（`color===5`）
    minRank?: 'S' | 'A' | 'B';      // battleWin 的勝利門檻（預設 'B'；battleEngage 不看 rank，忽略此欄位）
    missionIds?: readonly number[]; // 限定的遠征任務 master id（`api_mst_mission.api_id`）清單
}

const RANK_ORDER = ['D', 'C', 'B', 'A', 'S'];

// rank 是否達到門檻（S 最高）。未知/缺席的 rank 一律視為不達標，不猜。
export function meetsRank(rank: string | undefined, min: 'S' | 'A' | 'B'): boolean {
    const r = RANK_ORDER.indexOf(rank ?? '');
    const m = RANK_ORDER.indexOf(min);
    return r >= 0 && r >= m;
}

// 出擊類任務的目標次數幾乎從不在任務文字裡（例：任務 201「敵艦隊を撃破せよ！」內文
// 「艦隊を出撃させ、敵艦隊を捕捉、これを撃滅せよ！」沒有任何數字），工廠/改修類任務也常見
// 同樣情況（例：605「新装備「開発」指令」內文完全沒有數字，目標次數=1 是隱含的）。
// 這些任務多數還帶艦隊組成／海域限制／敵艦種擊沉數等複合條件——這些條件本專案尚無法驗證
// （需要逐艦種/艦名/海域比對，見下方 QUEST_SPECIAL_CONDITIONS 與 CLAUDE.md「出擊任務目前
// 實際涵蓋率很低」段落），勉強套用會誤算，故刻意不做。
//
// 這裡只收錄**完全無條件**的任務（任意海域、任意節點、不要求 boss、不要求特定編成、
// 不要求特定敵艦種）：目標次數與判定條件皆已交叉核對社群工具原始碼與 wiki 彼此一致——
// KC3Kai（quests_meta.json）、KanColle-YPS（devtools.js `$quest_complete_daily`／
// `inc_quest_progress`）、ElectronicObserver（QuestProgressManager.cs `ProgressBattle`／
// `ProgressDevelopment`／`ProgressConstruction`／`ProgressDestruction`／`ProgressDiscard`／
// `ProgressImprovement`）、zh.kcwiki.cn 與 wikiwiki.jp 的「定期任務列表」（2026-07-23 取得）。
// id↔title 對應以本專案自己的真實封包驗證優先（`samples/Quest.json`）；沒有真實封包的項目
// （下方逐條標註）僅能靠上述五方社群來源交叉比對——任務 id 在本遊戲十餘年間從未變更語意，
// 交叉比對一致度視為足夠可信，但仍在此明講「非本專案自行驗證」以符合誠實原則。
export const QUEST_ID_OVERRIDES: Readonly<Record<number, QuestGoal>> = {
    // ── 出擊 ──
    201: { kind: 'battleWin', target: 1 },    // 敵艦隊を撃破せよ！：任意海域戦闘で勝利（S/A/B）1回。id↔title 已用真實封包驗證。
    216: { kind: 'battleEngage', target: 1 }, // 敵艦隊主力を撃滅せよ！：任意海域戦闘1回（勝敗不問）。無真實封包，五方社群來源交叉比對。
    210: { kind: 'battleEngage', target: 10 }, // 敵艦隊を10回邀撃せよ！：任意海域戦闘10回（勝敗不問）。無真實封包，五方社群來源交叉比對。
    // ── 工廠 ──
    605: { kind: 'development', target: 1 }, // 新装備「開発」指令：內文無數字，目標次數為隱含的1次。id↔title 已用真實封包驗證。
    606: { kind: 'build', target: 1 },        // 新造艦「建造」指令：內文無數字，目標次數為隱含的1次。無真實封包，五方社群來源交叉比對。
    608: { kind: 'build', target: 3 },        // 艦娘「建造」艦隊強化！：內文用「3隻」非「3回」。無真實封包，五方社群來源交叉比對。
    609: { kind: 'shipScrap', target: 2 },    // 軍縮条約対応！：內文用「2隻」+「解体」。無真實封包，五方社群來源交叉比對。
    613: { kind: 'gearScrap', target: 24 },   // 資源の再利用：內文完全無數字，24為外部知識（同あ号作戦）。無真實封包，五方社群來源交叉比對。
    619: { kind: 'remodelAttempt', target: 1 }, // 装備の改修強化：內文無數字，「失敗也可達成」故用 remodelAttempt 非 remodel。無真實封包，五方社群來源交叉比對。
    1166: { kind: 'remodel', target: 1 },     // 続：装備の改修強化：內文無數字，此任務要求成功（沿用既有 remodel kind）。無真實封包，五方社群來源交叉比對。
    1167: { kind: 'remodel', target: 3 },     // 装備の改修集中強化：內文用漢字數字「三回」非阿拉伯數字，故文字解析吃不到。無真實封包，五方社群來源交叉比對。

    // ── 出擊：限定海域/boss/rank，不涉及艦隊組成（2026-07-23 第二輪擴充）──
    // area 為 mapKey（mapArea*10+mapNo）清單；bossOnly 皆為 true（這批任務全部要求擊破 boss）；
    // minRank 依各任務內文的勝利門檻。判定條件已交叉核對 KanColle-YPS（`is_current_sortie_map()`
    // 逐圖比對）與 ElectronicObserver（`ProgressBattle` 的 targetArea/isBossOnly/lowestRank
    // 三參數）原始碼皆一致；id↔title 對應無真實封包，五方社群來源交叉比對。
    226: { kind: 'battleWin', target: 5, area: [21, 22, 23, 24, 25], bossOnly: true, minRank: 'B' },  // 南西諸島海域の制海権を握れ！
    229: { kind: 'battleWin', target: 12, area: [41, 42, 43, 44, 45], bossOnly: true, minRank: 'B' }, // 敵東方艦隊を撃滅せよ！
    241: { kind: 'battleWin', target: 5, area: [33, 34, 35], bossOnly: true, minRank: 'B' },          // 敵北方艦隊主力を撃滅せよ！
    242: { kind: 'battleWin', target: 1, area: [44], bossOnly: true, minRank: 'B' },                  // 敵東方中枢艦隊を撃破せよ！
    243: { kind: 'battleWin', target: 2, area: [52], bossOnly: true, minRank: 'S' },                  // 南方海域珊瑚諸島沖の制空権を握れ！
    261: { kind: 'battleWin', target: 3, area: [15], bossOnly: true, minRank: 'A' },                  // 海上輸送路の安全確保に努めよ！
    265: { kind: 'battleWin', target: 10, area: [15], bossOnly: true, minRank: 'A' },                 // 海上護衛強化月間

    // ── 遠征：限定特定遠征任務 master id，非任意遠征（2026-07-23 第二輪擴充）──
    // 「東京急行」＝id 37、「東京急行(弐)」＝id 38、「海上護衛任務」＝id 5：
    // 皆已用本專案自己的真實封包驗證（`samples/start2-master.json` 的 `api_mst_mission`，
    // `api_name` 逐字相符），比其餘出擊類白名單的「五方社群交叉比對」更進一步、屬於真實
    // 封包驗證。id↔title（任務本身）仍為五方社群來源交叉比對。
    410: { kind: 'expedition', target: 1, missionIds: [37, 38] }, // 南方への輸送作戦を成功させよ！
    411: { kind: 'expedition', target: 7, missionIds: [37, 38] }, // 南方への鼠輸送を継続実施せよ!
    424: { kind: 'expedition', target: 4, missionIds: [5] },      // 輸送船団護衛を強化せよ！
};

// 上面白名單收錄不了的出擊/工廠/改裝任務——帶艦隊組成、敵艦種擊沉數，或「一次性資材整備」
// 等本專案尚無法驗證的複合條件，故不接上 bumpQuestProgress；UI 遇到這些 id 時仍回退顯示
// 受注中／達成。來源同上
// （zh.kcwiki.cn／wikiwiki.jp「定期任務列表」2026-07-23 取得，交叉核對 KC3Kai／YPS／EO
// 三個社群工具原始碼）。此處只保留仍需編成／敵艦種等本專案沒有偵測機制的項目。
//
// reason 用固定分類字串：
//   '編成'       ：需要特定艦娘/艦型/艦種數量組成
//   '編成+海域'  ：組成之外還限定特定海域/boss/rank
//   '敵艦種擊沉' ：目標是擊沉特定艦種的敵艦數量（本專案無此偵測機制）
//   '資材整備'   ：一次性「廢棄特定裝備＋準備資源」條件，非可重複的動作計數器
//   '演習+編成'  ：演習任務但限定特定艦隊組成
//   '多階段'     ：單一任務內有多個獨立計數器（如あ号作戦的出撃/S勝/boss到達/boss勝）
//
// 年常任務（55 筆，2026-07-23 已用 zh.kcwiki.cn 全表核對）**全數**屬於編成或編成+海域的
// 複合條件，無一是純「海域」或純「遠征ID」，故第二輪擴充未涵蓋任何一筆年常任務，仍不逐條
// 收錄於此，需要時請查 zh.kcwiki.cn／wikiwiki.jp「定期任務列表」年常任務章節。
export interface QuestSpecialCondition {
    title: string;
    reason: '編成' | '編成+海域' | '海域' | '敵艦種擊沉' | '遠征ID' | '資材整備' | '演習+編成' | '多階段';
}

export const QUEST_SPECIAL_CONDITIONS: Readonly<Record<number, QuestSpecialCondition>> = {
    // ── 日常 ──
    211: { title: '敵空母を3隻撃沈せよ！', reason: '敵艦種擊沉' },
    218: { title: '敵補給艦を3隻撃沈せよ！', reason: '敵艦種擊沉' },
    212: { title: '敵輸送船団を叩け！', reason: '敵艦種擊沉' },
    230: { title: '敵潜水艦を制圧せよ！', reason: '敵艦種擊沉' },
    673: { title: '装備開発力の整備', reason: '資材整備' },
    674: { title: '工廠環境の整備', reason: '資材整備' },
    // ── 週間 ──
    214: { title: 'あ号作戦', reason: '多階段' },
    220: { title: 'い号作戦', reason: '敵艦種擊沉' },
    213: { title: '海上通商破壊作戦', reason: '敵艦種擊沉' },
    221: { title: 'ろ号作戦', reason: '敵艦種擊沉' },
    228: { title: '海上護衛戦', reason: '敵艦種擊沉' },
    638: { title: '対空機銃量産', reason: '資材整備' },
    676: { title: '装備開発力の集中整備', reason: '資材整備' },
    677: { title: '継戦支援能力の整備', reason: '資材整備' },
    // ── 月間 ──
    249: { title: '「第五戦隊」出撃せよ！', reason: '編成+海域' },
    256: { title: '「潜水艦隊」出撃せよ！', reason: '編成+海域' },
    257: { title: '「水雷戦隊」南西へ！', reason: '編成+海域' },
    259: { title: '「水上打撃部隊」南方へ！', reason: '編成+海域' },
    264: { title: '「空母機動部隊」西へ！', reason: '編成+海域' },
    266: { title: '「水上反撃部隊」突入せよ！', reason: '編成+海域' },
    280: { title: '兵站線確保！海上警備を強化実施せよ！', reason: '編成+海域' },
    318: { title: '給糧艦「伊良湖」の支援', reason: '演習+編成' },
    626: { title: '精鋭「艦戦」隊の新編成', reason: '資材整備' },
    628: { title: '機種転換', reason: '資材整備' },
    645: { title: '「洋上補給」物資の調達', reason: '資材整備' },
};

// id 白名單優先於文字解析，文字解析查不到才試——兩者鎖定的任務集合原則上互不重疊，但
// 任務 210「敵艦隊を10回邀撃せよ！」的內文剛好同時含「10回」與「出撃」，文字解析會誤判成
// `{kind:'sortie', target:10}`（把「10次出擊」跟任務實際要求的「10次戰鬥」搞混，兩者不
// 等價：同一次出擊可能打好幾場戰鬥）。已知 id 的人工核對結果理當比通用關鍵字猜測可信，
// 故 id 白名單一律優先，不會被文字解析的誤判蓋過。
export function resolveQuestGoal(no: number, title: string, detail: string): QuestGoal | null {
    return QUEST_ID_OVERRIDES[no] ?? parseQuestGoal(title, detail) ?? null;
}

const FULLWIDTH_DIGITS = '０１２３４５６７８９';

// 任務文字偶爾混用全形／半形數字（同一段甚至半形+全形各一位，見 703 的「１5回」），
// 故先逐字元正規化成半形，\d+ 才能正確吃到完整數字。
function normalizeDigits(text: string): string {
    return text.replace(/[０-９]/g, ch => String(FULLWIDTH_DIGITS.indexOf(ch)));
}

// 依關鍵字判斷「這個任務在數什麼」。**順序刻意講究**：「近代化改修」必須排在「改修」
// 之前，否則裝備改修的關鍵字比對會先命中、把近代化改修任務誤判成裝備改修。
export function parseQuestGoal(title: string, detail: string): QuestGoal | null {
    const text = normalizeDigits(`${title} ${detail}`);

    // 入渠任務的真實遊戲文字用「N隻...ドック入り」而非「N回」（實測：任務「艦隊大整備！」
    // 內文為「各艦隊から整備が必要な艦を5隻以上ドック入りさせ、大規模な整備をしよう！」）。
    // 此為「N隻」批次條件排除規則的**唯一白名單例外**：已用 KC3Kai 原始碼交叉驗證
    // （quests_meta.json 該任務 id=503 tracking=[[0,5]]，且其 api_req_nyukyo/start 封包
    // handler 對此 id 直接呼叫 increment()）——機制上是「每送出一次入渠請求即計數」，
    // 與「N回」語意相同，並非要求同時湊到 N 艘在渠內，故可安全地當 dock kind 累加。
    // 只認這個已驗證的固定搭配（數字緊接「隻」、20字內出現「ドック入り」或「入渠」），
    // 不擴大到其他「N隻」批次條件（例：撃沈/撃破數），那些語意未經驗證仍不猜。
    const dockShipMatch = text.match(/(\d+)\s*隻[^。]{0,20}?(?:ドック入り|入渠)/);
    if (dockShipMatch) {
        const target = Number(dockShipMatch[1]);
        if (target > 0) return { kind: 'dock', target };
    }

    // 只認「N回」——「N隻」（擊沈/擊破數）等批次條件語意不同
    // （批次條件是「同時湊到 N 艘」而非「累計 N 次」），無法可靠地用累加計數表達，故不猜。
    const numMatch = text.match(/(\d+)\s*回/);
    if (!numMatch) return null;
    const target = Number(numMatch[1]);
    if (!(target > 0)) return null;

    if (/近代化改修/.test(text)) return { kind: 'modernization', target };
    if (/遠征/.test(text)) return { kind: 'expedition', target };
    if (/演習/.test(text)) return { kind: /勝利|勝ち/.test(text) ? 'practiceWin' : 'practiceAttempt', target };
    if (/補給/.test(text)) return { kind: 'supply', target };
    if (/入渠/.test(text)) return { kind: 'dock', target };
    if (/開発/.test(text)) return { kind: 'development', target };
    if (/建造/.test(text)) return { kind: 'build', target };
    if (/改修/.test(text)) return { kind: 'remodel', target };
    if (/出撃/.test(text)) return { kind: 'sortie', target };
    return null;
}
