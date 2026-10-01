// 任務編號的身分核對（純函式，無 chrome.*）。
//
// 期間限定任務（南瓜、秋刀魚、季節任務……）每年內容不同，但營運會重複使用舊的任務編號。
// 目錄、譯文、獎勵與進度條件表都以編號對應，編號被重用時會把舊任務的資料套到新任務上。
// 因此以遊戲即時送來的任務標題（api_title）和目錄記錄的日文標題核對：不一致就當成新任務，
// 不套用任何以編號對應的舊資料。已結束的任務仍保留在目錄裡，以便辨認營運重用編號。
import { QUEST_CATALOG_RAW, QUEST_CATALOG_TEXT_OVERRIDES } from './quest-catalog-data';
import { QUEST_CATALOG_SUPPLEMENT_RAW } from './quest-graph-data';

/**
 * 比對用的標題鍵：NFKC、去空白，並去掉括號與驚嘆號／問號這類同一任務常見的寫法差異
 * （例：目錄的「【涼波改二】」與遊戲的「「涼波改二」」）。被重用的編號標題整段不同，不受影響。
 */
export function questTitleKey(title: string): string {
    return title.normalize('NFKC').replace(/[\s「」『』【】()（）［］\[\]〈〉《》!！?？]/g, '');
}

const CATALOG_TITLES = new Map<number, string>();
// KC3Kai 固定版本日文表核對的標題；來源目錄的附註、誤字與異體字不可用於身分判定。
const IDENTITY_TITLE_CORRECTIONS: Record<number, string> = {
    245: '式の準備！(最終)',
    246: '二人でする初めての任務！',
    1032: '【初夏限定任務】水上打撃部隊 作戦運用2026',
    1042: '最新鋭改装空母「飛龍改三」、疾風怒涛！',
    1133: '逆探及び改良水上電探の実戦配備',
    1153: '【続：対潜戦力強化】対潜兵装のさらなる拡充',
};
for (const [no, , name] of QUEST_CATALOG_RAW as unknown as readonly (readonly [number, unknown, string])[]) {
    if (name) CATALOG_TITLES.set(no, questTitleKey(name));
}
// 身分核對與目錄顯示共用已校正的日文標題，避免來源字形差異被當成編號重用。
for (const [no, text] of Object.entries(QUEST_CATALOG_TEXT_OVERRIDES)) {
    CATALOG_TITLES.set(Number(no), questTitleKey(text.name));
}
for (const [no, , name] of QUEST_CATALOG_SUPPLEMENT_RAW as readonly (readonly [number, string, string])[]) {
    if (name && !CATALOG_TITLES.has(no)) CATALOG_TITLES.set(no, questTitleKey(name));
}
for (const [no, title] of Object.entries(IDENTITY_TITLE_CORRECTIONS)) {
    CATALOG_TITLES.set(Number(no), questTitleKey(title));
}

/**
 * match：標題與目錄相同；mismatch：同編號但標題不同（營運重用編號的新任務）；
 * unknown：沒有即時標題或目錄沒有這個編號，無從比對。
 */
export type QuestIdentity = 'match' | 'mismatch' | 'unknown';

export function questCatalogIdentity(apiNo: number, liveTitle: string | undefined): QuestIdentity {
    const catalog = CATALOG_TITLES.get(apiNo);
    if (!catalog || !liveTitle) return 'unknown';
    return questTitleKey(liveTitle) === catalog ? 'match' : 'mismatch';
}
