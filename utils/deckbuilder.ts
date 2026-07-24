// 「DeckBuilder」格式輸出——社群通用的艦隊編成 JSON 格式，被多個外部工具採用（見下）。
// 純資料轉換模組（無 chrome.*），只讀 GameState 既有的公開 View API
// （fleets()／airBases_()／ownedShips()），不解析 raw api_ship——同 ownedShips() 本身
// 的「overview 等唯讀介面只能讀此 API」原則。
//
// 為何做這個：使用者想要「艦隊編成卡片圖」與「制空権計算」，但擴充本身絕不碰任何遊戲圖片
// 或美術資產（CLAUDE.md 設計原則、M7 圖示系統的零第三方素材立場）。折衷方案是只輸出
// **純數字**（艦娘/裝備 master id、等級、改修值、熟練度）交給使用者自己選擇的外部工具，
// 由那些工具自己決定要不要用官方美術呈現——本專案的程式碼完全不觸碰、不下載、不合成
// 任何圖片，跟既有「複製完整報告」給 LLM 是同一種「交出資料、外部工具自己處理」模式。
//
// 格式來源已對照兩個實際採用此格式的工具原始碼確認（非猜測，2026-07）：
//   · KanColleImgBuilder（https://github.com/HitomaruKonpaku/KanColleImgBuilder，
//     依 gkcoi 函式庫 https://github.com/Nishisonic/gkcoi 的 DeckBuilder schema）：
//     builder.component.ts 用 `JSON.parse(decodeURI(route.fragment))` 讀網址 hash。
//   · 制空権シミュレータ（noro6/kc-web，https://noro6.github.io/kc-web/）：
//     App.vue 的 created() 讀 `document.location.search` 的 `predeck` 參數，
//     餵進 `Convert.loadDeckBuilder()`；convert.ts 的 DeckBuilderShip interface
//     顯示 fp/tp/aa/ar/asw/ev/los 皆為選填（缺席時該工具會自己用 master+等級回推），
//     故本檔案在附不到精確素質時省略該欄位並非未完成，而是兩個消費端都容許的行為。
// 兩者吃同一種 schema（f1~f4 艦隊、a1~a3 基地航空隊），故只需一份轉換器共用。
import type { GameState } from './state';

// lbas：依基地 rid（1-3）決定去留，見 entrypoints/overview/lib.ts 的 FleetMarkdownScope
// 同一份註解——rid 才是穩定的「第幾個基地」，不能用陣列索引。
export interface DeckBuilderScope { fleets: boolean[]; lbas: boolean[] }

interface DeckBuilderItem { id: number; rf: number; mas: number }
type DeckBuilderItems = Record<string, DeckBuilderItem>;

// 補強增設槽位的 key：kc-web 的 convert.ts 認得 'ix' 這個固定字串（另一種
// `i${槽數+1}` 寫法對可變槽數艦娘不好算，'ix' 兩邊都吃得下，故固定用它）。
const EX_ITEM_KEY = 'ix';

export function buildDeckBuilder(state: GameState, scope: DeckBuilderScope): object {
    // ownedShips() 已含裝備加成的精確素質（見該方法註解），用艦實例 id 反查——
    // fleets() 回傳的 ShipView 本身不帶完整八維素質，兩邊資料源相同、只是取用的
    // View 方法不同，id 是唯一可靠的對應鍵（mst 同型艦會撞號）。
    const statsById = new Map(state.ownedShips().map(s => [s.id, s]));

    const deck: Record<string, unknown> = { hqlv: state.hqLv };

    state.fleets().forEach((f, i) => {
        if (!f.ships.length || scope.fleets[i] === false) return;
        const fleetObj: Record<string, unknown> = {};
        f.ships.slice(0, 7).forEach((s, si) => {
            const items: DeckBuilderItems = {};
            s.gears.forEach((g, gi) => {
                if (g) items[`i${gi + 1}`] = { id: g.mst, rf: g.level, mas: g.alv };
            });
            if (s.exGear) items[EX_ITEM_KEY] = { id: s.exGear.mst, rf: s.exGear.level, mas: s.exGear.alv };
            const owned = statsById.get(s.id);
            const ship: Record<string, unknown> = {
                id: s.mst, lv: s.lv, luck: owned?.stats.luck ?? -1, hp: s.hp, items,
            };
            if (owned) {
                ship.fp = owned.stats.firepower; ship.tp = owned.stats.torpedo; ship.aa = owned.stats.aa;
                ship.ar = owned.stats.armor; ship.asw = owned.stats.asw;
                ship.ev = owned.stats.evasion; ship.los = owned.stats.los;
            }
            fleetObj[`s${si + 1}`] = ship;
        });
        deck[`f${i + 1}`] = fleetObj;
    });

    state.airBases_().forEach(b => {
        if (scope.lbas[b.rid - 1] === false) return;
        const items: DeckBuilderItems = {};
        b.squadrons.forEach((sq, si) => {
            if (sq.state === 1 && sq.mst > 0) items[`i${si + 1}`] = { id: sq.mst, rf: sq.level, mas: sq.alv };
        });
        // a1~a3 的鍵用 rid（第幾個基地）而非陣列索引——airBases_() 先依 areaId 排序，
        // 索引順序不保證等於 rid 順序（rid=2 的基地若指派到較小 areaId 會排在 rid=1 前面）。
        if (Object.keys(items).length) deck[`a${b.rid}`] = { mode: b.actionKind, items };
    });

    return deck;
}

// KanColleImgBuilder：網址 hash 用 encodeURI/decodeURI 這一對（非 encodeURIComponent），
// 見 kancolle-builder.component.ts 的 `JSON.parse(decodeURI(route.fragment))`。
export function imgBuilderUrl(deck: object): string {
    return `https://kancolleimgbuilder.web.app/builder#${encodeURI(JSON.stringify(deck))}`;
}

// 制空権シミュレータ：query string 用 encodeURIComponent/decodeURIComponent 這一對，
// 見 App.vue 的 `getUrlParams()`。
export function airCalcUrl(deck: object): string {
    return `https://noro6.github.io/kc-web/?predeck=${encodeURIComponent(JSON.stringify(deck))}`;
}
