// 出擊結算右下的掉落格：艦娘櫻錨晶片（呼叫端畫好傳入）＋結算掉落的道具。
// 純字串函式，面板與離線預覽（tools/preview/panel-drop-items.ts）共用。
// 船位滿員周回時仍可能掉道具（秋刀魚等），所以「沒有艦娘」不等於 No Drop。
import { esc } from '@/utils/html-escape';
import { t } from '@/utils/ui-i18n';

export interface DropItemView {
    name: string;
    /** 結算後的持有數；庫存未觀測時為 null，不顯示 0。 */
    held: number | null;
}

function dropItemHtml(item: DropItemView): string {
    const held = item.held === null ? '' : t('sortie.itemHeld', { n: item.held });
    const title = `${t('sortie.itemDropTitle')}：${item.name}${held ? `（${held}）` : ''}`;
    return `<div class="s-drop-item" role="group" aria-label="${esc(title)}" title="${esc(title)}">
        <span class="s-drop-item-name">${esc(item.name)}</span>${held ? `<span class="s-drop-item-held">${esc(held)}</span>` : ''}
      </div>`;
}

const NO_DROP = '<span class="s-drop-empty">No Drop</span>';

export function sortieDropSlotHtml(shipChip: string, items: readonly DropItemView[]): string {
    if (!shipChip && !items.length) return `<div class="s-drop-slot empty">${NO_DROP}</div>`;
    return `<div class="s-drop-slot filled${shipChip && items.length ? ' with-item' : ''}">
        ${shipChip}${items.map(dropItemHtml).join('')}
      </div>`;
}
