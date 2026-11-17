// 把真正的本地化實作註冊進 state-format（為什麼要分這一層：見 utils/state-format.ts 檔頭）。
//
// 匯入本檔＝「這一端會顯示艦名、裝備名與介面文案」。生產的擴充頁面經 ui-prefs.ts 匯入到本檔；
// 離線預覽腳本與斷言顯示名稱的測試各自匯入。
//
// **註冊刻意不放在 ui-i18n.ts**：模組載入的副作用會讓打包器無法再剪掉該模組，於是
// background、bridge、interceptor 這些只是間接碰到 ui-i18n 的入口會各自帶上整份字串表與
// 譯名表（實測各多約 500 kB）。放在這個沒人誤匯入的小檔，剪裁才留得住。
import { localizeEquipmentType, localizeGear, localizeShip } from './gamedata-i18n';
import { expedItemDisplayName, expedItemFullName, getLang, t } from './ui-i18n';
import { setStateFormatters } from './state-format';

setStateFormatters({
    t, localizeShip, localizeGear, localizeEquipmentType, expedItemDisplayName, expedItemFullName, getLang,
});
