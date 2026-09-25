/** Chooses the expedition shown for a fleet without carrying another fleet's selection across. */
export function expeditionSelectionForDeck(
    deckIndex: number,
    lastMissionId: number | null,
    selectedByDeck: ReadonlyMap<number, number>,
    availableMissionIds: ReadonlySet<number>,
    fallbackId: number | null,
): number | null {
    if (lastMissionId !== null && availableMissionIds.has(lastMissionId)) return lastMissionId;

    const selected = selectedByDeck.get(deckIndex);
    if (selected !== undefined && availableMissionIds.has(selected)) return selected;

    if (fallbackId !== null && availableMissionIds.has(fallbackId)) return fallbackId;
    return null;
}
