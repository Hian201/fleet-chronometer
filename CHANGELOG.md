# Changelog

Changes for each Chrome Web Store release. While a version is in store review, its changes collect under **Unreleased** and each update is published as a pre-release tag (`v<version>-rc.N`). When the store approves it, the section is renamed to the version and the final tag `v<version>` is created on the approved commit.

## [Unreleased] — 1.1.1.0

### Highlights

**Faster live panel updates**
- The panel now reflects game actions much sooner. In a typical 10-minute session (port, resupply, refit, factory, quests, docking, expeditions, sorties), the time from the game receiving a response to the panel being ready to draw dropped from a median of 229 ms to 34 ms, and the 95th percentile from 792 ms to 153 ms.
- Capture still only observes responses the game has already received. Nothing is sent to the game server, and the work done in the game page stays under 1 ms per response.
- After a click or key press, capture now waits one frame instead of 750 ms. Responses under 512K characters are handed over on the next task; larger ones, such as the login master data, still wait for idle time.

**Pop-out window**
- New popup menu item **Pop-out Window** moves the game tab into a window that shows only the game. The tab is moved, not reloaded, so the game keeps running.
- ✕ or Esc moves the tab back to its original position. If the original window was closed, the tab opens in a new regular window instead.
- After you resize the pop-out window, it snaps to the game's aspect ratio.
- **Fit to Window** is still available. DevTools can only be docked in a regular window, so use Fit to Window if you need DevTools in the same window.
- Closing the pop-out window directly closes the game tab. A hint is shown when the window opens.
- Fit to Window and the pop-out window no longer cut off part of the game when the original page was scrolled. The page scroll position is restored when you leave.

**Less footprint in the game page**
- Captured responses and the mute state are now passed inside the extension through a private message channel instead of being broadcast on the game page.
- Store builds no longer leave debug variables in the game page or print packets to its console.
- The service worker console no longer prints notification and timer schedules.

**Capture failure notice**
- If the game is communicating but the extension is not capturing any of it (for example after a game update changes how it talks to the server), the panel now shows an error notice instead of silently recording nothing. It suggests reloading the game tab, and the tooltip explains the likely cause.
- Detection only reads request timings the browser has already recorded. It does not wrap or delay any network API, and it does not report anything while the game sits on the title screen.

**Anchorage repair and provisioning for every fleet**
- Repair ships (Akashi / Asahi Kai) and Nozaki can be in any fleet, including several fleets at once. The fleet buttons now mark every fleet where anchorage repair or provisioning is active: an icon when only one is active (crane for repair, a new ice-cream icon for provisioning), stacked "AR / AO" when both are. Hover shows the ship count.
- A new **Upkeep** group appears in the Harbor view, next to Expeditions / Repairs / Construction, only while at least one fleet is repairing or provisioning. Each fleet gets one row with ship counts and estimated countdowns to the next repair and provisioning tick.
- Clicking the button of such a fleet opens the Upkeep group, except during a sortie or while Fleet Photo is open.
- The status line above the ships keeps only the morale countdown and "On Expedition".

**Morale recovery with Nozaki provisioning**
- The morale countdown above the ships now reads like "Morale 49 10:49 › 54 25:49". A small framed 49 or 54 marks the target and the time follows it. The 54 part appears while Nozaki is provisioning and shows when the lowest-morale ship she restores reaches 54, the provisioning cap. Both parts only appear while a ship in the fleet is below 49.
- Upkeep group headers label the countdowns "next", because they count down to the next repair or provisioning tick, not to a morale value.
- A fleet with active provisioning gets one notification when the ships Nozaki restores reach 54, instead of the notification at 49. Notifications err late rather than early, by up to one 15-minute tick.
- Using a fast repair bucket reschedules morale notifications, so a ship that just left the dock is counted as one Nozaki restores and the 54 notification no longer fires before it gets there.

**Damaged ships in Repairs**
- The Repairs group in the Harbor view has a **Docks / Damaged** toggle. Docks lists every dock slot with its countdown, plus empty and locked slots. Damaged lists every ship below full HP that is not already docked, with fleet number, HP bar, HP, damage state and the repair time the game reports.
- The list follows the game's default damage order on the docking screen: lowest HP ratio first, and ships with the same ratio in the game's own list order.
- Ships on expedition are listed but dimmed, as in the game. Ships in an active sortie show the repair time as pending until they return to port, because the game only refreshes it there.
- Entering the docking screen in the game switches the panel to Repairs and shows the dock slots. Opening Repairs in the panel also starts on the dock slots.

**Item counts after using items**
- Item counts now drop as soon as you use an item that costs one per use: marriage papers and ring, reinforcement expansion, dock keys (preset slots, construction and repair docks), emergency repair material, construction corps (base expansion and maintenance level), special aviation rations, pumpkins for luck modernization, and Mamiya / Irako. Before, they stayed at the login value because the game does not resend the item list after these actions.
- Equipment received from item exchanges appears in the equipment list right away instead of after the next login.

**Quarterly and yearly quest cycles**
- The top of the Quest Navigator shows the current quarterly cycle (quarterly quests reset on Mar, Jun, Sep and Dec 1) and the next yearly reset, with how many yearly quests reset then and how many of them you have completed this cycle. Click it to list those quests.
- Each yearly quest resets in its own month. Its header shows its current cycle, for example "Yearly 2026/09/01 – 2027/09/01", with exact times in the tooltip. Catalog rows show the reset month, and **More filters** has a new **Yearly reset** filter.
- Reset months come from the game's quest list when you open it, so new yearly quests and changed months are picked up without an update.
- Yearly quests you completed this cycle now count as done for this cycle, like daily to quarterly quests.

**Layout fixes**
- In English, the combined-fleet button now shows CTF / STF / TCF, with the full name in the tooltip. The full name wrapped to two lines and pushed the seventh ship past the panel's layout target.
- Side-by-side columns are easier to tell apart: the Upkeep columns have a divider, and expedition conditions, the two-column item list (Traditional Chinese) and the resource log tooltip have wider column gaps.

**Equipment reference**
- XF6F-6 improvement bonuses for US carriers (Lexington, Yorktown, Essex, Independence, Casablanca and Ranger classes): ★1 evasion +1, ★2 anti-air +1, ★3 firepower +1, ★4 and above accuracy +1.

**Developer tools**
- Developer builds have a capture latency report in the panel's Activity tab. It is off in store builds, is kept in memory only, and is never written to the database.

### Data compatibility

- No IndexedDB schema change (still v14). The backup format is unchanged.
- No permission changes.
