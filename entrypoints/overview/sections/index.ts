// 分區登錄表：順序即側欄顯示順序。新增分區＝新增一檔＋在此登錄一行。
import type { OverviewSection } from './types';
import { fleetOverviewSection } from './fleet-overview';
import { eventOpsSection } from './event-ops';
import { shipsSection } from './ships';
import { equipmentSection } from './equipment';
import { sortieLogSection } from './sortie-log';
import { dropLogSection } from './drop-log';
import { expedLogSection } from './exped-log';
import { buildLogSection } from './build-log';
import { devLogSection } from './dev-log';
import { resourceLogSection } from './resource-log';
import { llmSection } from './llm';
import { backupSection } from './backup';

export const sections: OverviewSection[] = [
    fleetOverviewSection,   // #4 艦隊四隊＋基地航空隊全覽（＋markdown/PNG 匯出）
    eventOpsSection,        // 活動作戰板（關卡×出撃札的規劃與衝突檢查）
    shipsSection,           // 艦娘全覽（詳細清單：篩選抽屜＋十八個排序欄＋分頁）
    equipmentSection,       // 裝備全覽（圖示篩選架＋圖磚／詳細清單雙模式）
    sortieLogSection,       // #5 出擊紀錄（＋#6 KC3Kai 重播匯出）
    dropLogSection,         // 打撈紀錄（通常／活動篩選＋可選欄位詳細清單）
    expedLogSection,        // #3 遠征紀錄
    buildLogSection,        // #5 建造紀錄
    devLogSection,          // #5 開發紀錄
    resourceLogSection,     // 資源紀錄（趨勢圖＋詳細清單＋活動區段消耗）
    llmSection,             // #7 LLM 接入（預留）
    backupSection,          // 資料備份與還原（＋FSA 資料夾備份、重播層裁剪）
];
