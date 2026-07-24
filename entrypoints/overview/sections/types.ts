// 鎮守府情報總括的「分區（section）」共通介面。
//
// 架構約定：每個分區一個模組（本目錄下一檔一區），實作本介面並在 sections/index.ts
// 登錄；main.ts 只負責側欄導覽、hash 路由與語言/主題套用，對各分區內容一無所知。
// 之後逐項實作細節時，只動自己的分區檔案＋（如需索引）utils/db.ts，互不干擾。
import type { GameState } from '@/utils/state';

export interface SectionContext {
    /** 重新渲染目前分區（分區內部資料變更後可呼叫，例如備份還原完成） */
    rerender(): void;
    /**
     * 重播 db.events 重建的當前狀態（母港/艦隊/裝備/母港快照…）。
     * 由 main.ts 於載入時建立一次、所有分區共用；名稱解析（shipName/gearName）會依
     * 目前語言即時回傳。需要「現在的鎮守府狀態」的分區（如艦隊全覽）直接讀它。
     */
    state: GameState;
    /**
     * 重新載入 state（重播 db.snapshot＋db.events，見 lib.ts loadGameState）並取代
     * 上面的 `state`。只有「資料備份與還原」匯入後需要呼叫——匯入直接寫入 IndexedDB，
     * 既有的 GameState 實例不會自動感知，必須整個重建才能反映匯入的資料。
     * 呼叫後仍要接著呼叫 rerender() 才會重繪畫面。
     */
    reloadState(): Promise<void>;
}

export interface OverviewSection {
    /** hash 路由 key（#/<id>）兼側欄識別，英文 kebab-case */
    id: string;
    /** 側欄顯示名的 i18n key（utils/ui-i18n.ts 的 ov.* 字串） */
    titleKey: string;
    /**
     * 把分區內容渲染進 container（每次進入或語言/主題切換時整個重畫，
     * container 已清空）。資料自行從 utils/db.ts 讀取。
     */
    render(container: HTMLElement, ctx: SectionContext): void | Promise<void>;
}
