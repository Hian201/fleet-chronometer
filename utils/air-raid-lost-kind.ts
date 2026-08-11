// 基地空襲 `api_lost_kind` → 遊戲畫面文案（純函式）。
//
// inspired by KC3Kai `Meta.airraiddamage`／遊戲本體 AirRaidModel（文案與 1–4 對照）。
// 超出 1–4 的值不猜，回 null，由 UI 顯示原始數字。

import { t } from './ui-i18n';

/** 已知值 1–4 的語意鍵；未知回 null。 */
export function airRaidLostKindKey(kind: number): 'resources' | 'both' | 'ground' | 'none' | null {
    switch (kind) {
        case 1: return 'resources';
        case 2: return 'both';
        case 3: return 'ground';
        case 4: return 'none';
        default: return null;
    }
}

/** UI 用標籤：已知值走對照文案，未知／缺席回「損失種別 {v}」。 */
export function airRaidLostKindLabel(kind: number | null | undefined): string {
    if (kind == null || !Number.isFinite(kind)) return t('history.lossKind', { v: '?' });
    const key = airRaidLostKindKey(kind);
    return key ? t(`history.lossKind.${key}`) : t('history.lossKind', { v: kind });
}
