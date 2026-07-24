// 建造／開發／改修三分區共用的資材列與名稱工具（皆讀 db.factory，差在 kind 篩選）。
import type { GameState } from '@/utils/state';
import { t } from '@/utils/ui-i18n';
import { esc, gearIconHtml, matIconHtml, fmtShortTs } from '../lib';

// 8 項資材檔名（燃彈鋼鋁→消耗材），index 對齊 FactoryLogRow.used
const MAT_FILES = ['fuel', 'ammo', 'steel', 'bauxite', 'torch', 'drum', 'devmat', 'screw'];
const MAT_LABELS = ['mat.fuel', 'mat.ammo', 'mat.steel', 'mat.bauxite', 'mat.torch', 'mat.drum', 'mat.devmat', 'mat.screw'];

export const usedHtml = (used: number[] | undefined) =>
    (used ?? []).map((v, i) => v > 0 && MAT_FILES[i]
        ? `<span class="f-res" title="${esc(t(MAT_LABELS[i]))}">${matIconHtml(MAT_FILES[i], t(MAT_LABELS[i]))}<b>${v}</b></span>` : '')
        .join('');

export const gearChip = (mst: number | undefined, state: GameState) => {
    if (!mst || mst <= 0) return `<span class="f-fail">${esc(t('factory.devFail'))}</span>`;
    const name = state.gearName(mst);
    return `${gearIconHtml(state.gearIconId(mst), '')}<span title="${esc(name)}">${esc(name)}</span>`;
};

export { esc, fmtShortTs };
