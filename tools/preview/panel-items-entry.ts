// panel-items 預覽的瀏覽器端入口：以正式 mountGeneral 掛上假設持有量，檢查道具頁版面與互動。
import { mountGeneral } from '../../entrypoints/panel/general';
import { itemCatalog } from '../../utils/item-catalog';
import { GameState } from '../../utils/state';
import { setLang } from '../../utils/ui-i18n';

const params = new URLSearchParams(location.search);
const lang = (['zh-TW', 'ja', 'en'].includes(params.get('lang') ?? '') ? params.get('lang') : 'zh-TW') as Parameters<typeof setLang>[0];
setLang(lang);
document.documentElement.lang = lang;
if (params.has('theme')) document.documentElement.dataset.theme = params.get('theme')!;

// 假設情境：數量只供版面預覽，正式畫面採用被動觀測到的資料。
const state = new GameState();
state.materials = [348250, 350000, 324180, 298400, 1420, 2850, 2980, 845];
state.useItemCounts = new Map(itemCatalog.flatMap((item, index) =>
    item.countSource.kind === 'useitem' ? [[item.countSource.id, (index * 37) % 290 + 1] as [number, number]] : []));
state.payItemCounts = new Map(itemCatalog.flatMap((item, index) =>
    item.countSource.kind === 'payitem' ? [[item.countSource.id, index % 4 + 1] as [number, number]] : []));
if (params.has('pins')) localStorage.setItem('kc-item-pins', JSON.stringify(params.get('pins')!.split(',')));
else localStorage.removeItem('kc-item-pins');
mountGeneral(state, () => '0:00:00');
document.querySelector<HTMLButtonElement>('#general-nav [data-page="items"]')?.click();
if (params.get('inventory')) document.querySelector<HTMLButtonElement>(`[data-inventory="${params.get('inventory')}"]`)?.click();
if (params.has('q')) {
    document.getElementById('item-search-toggle')!.click();
    const input = document.getElementById('item-search') as HTMLInputElement;
    input.value = params.get('q')!;
    input.dispatchEvent(new Event('input'));
}
if (params.has('open')) document.querySelector<HTMLDetailsElement>(`.ledger-item-row[data-item-key="${params.get('open')}"]`)?.setAttribute('open', '');
