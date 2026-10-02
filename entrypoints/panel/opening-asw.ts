import type { ShipView } from '../../utils/state';
import { openingAswEligible, type OpeningAswContext } from '../../utils/opening-asw';
import { esc } from '../../utils/html-escape';
import { t } from '../../utils/ui-i18n';

export const ASW_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true"><path transform="translate(4 0) scale(.75)" fill="currentColor" d="M16 1 21 9 17.5 7.5V21H25C21.5 17.5 21 13.5 22 10L19 12 24 5 25.5 13 23.5 11.5C23 15.5 25 19 29 22V24H19L18 26H17.5V30.6667H14.5V26H14L13 24H3V22C7 19 9 15.5 8.5 11.5L6.5 13 8 5 13 12 10 10C11 13.5 10.5 17.5 7 21H14.5V7.5L11 9Z"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter" d="M2 23Q5.5 21 9 23T16 23T23 23T30 23M2 27Q5.5 25 9 27T16 27T23 27T30 27"/></svg>`;

export function openingAswBadge(ship: ShipView, context: OpeningAswContext = {}, iconOnly = false): string {
    if (!openingAswEligible({
        masterId: ship.mst, stypeId: ship.stypeId, ctype: ship.ctype,
        nameJa: ship.nameJa, aswEquipmentKnown: ship.aswEquipmentKnown, asw: ship.asw ?? null, gears: ship.gears, exGear: ship.exGear,
    }, { ...context, escaped: ship.escaped })) return '';
    const title = esc(t('fleet.openingAswTitle'));
    return `<span class="ship-asw${iconOnly ? ' ship-asw-icon-only' : ''}" title="${title}" aria-label="${title}">${ASW_ICON}${iconOnly ? '' : '<span>ASW</span>'}</span>`;
}
