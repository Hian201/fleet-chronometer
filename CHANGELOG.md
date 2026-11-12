# Changelog

Changes for each Chrome Web Store release. While a version is in store review, its changes collect under **Unreleased** and each update is published as a pre-release tag (`v<version>-rc.N`). When the store approves it, the section is renamed to the version and the final tag `v<version>` is created on the approved commit.

## [Unreleased] — 1.1.1.1

### Highlights

**Sortie cost estimate**
- Each sortie in the Sortie Log now has a collapsed **Sortie cost estimate** block. Its summary shows the net cost of that run.
- The bill is what the run left to pay: resupply, plane replenishment (5 bauxite per plane) and repairs, taken from the ships' state at sortie start and on returning to port. Supplying or repairing later, or sending other ships out first, does not change it.
- En-route change is how much the stockpile moved during the sortie (resource nodes, land base sorties). Net cost is the bill minus that change. If resources changed before the sortie in ways the extension cannot track (quest rewards, scrapping, docking and so on since the last port visit), the en-route change is shown as unknown and the net cost counts only the bill.
- Support fleets sent to the same area get their own line, calculated from the support expedition consumption rules plus planes shot down. Land base resupply and instant repairs used afterwards are listed separately as well.
- Married ships make the fuel and ammo figures approximate; these are marked as estimates. Repairs healed for free by anchorage repair, or ships scrapped before repair, still count in the bill.
- A new **Cost by map** summary averages the net cost per run, per boss reach and per boss S rank, splits event maps by difficulty, can be limited to the last 7, 30 or 90 days, and shows how many more runs your current stock covers.
- Costs are recorded from this version on; earlier sorties have none.

**Discrete-material ledger**
- The resource log has a collapsible ledger for improvement materials, development materials, instant repairs and instant construction over the selected period: opening + income − spending + unattributed = closing.
- Income comes from quest rewards (fixed rewards only) and expeditions; spending from development, construction, improvement, instant construction, docking and remodels. Differences that match no record stay in "unattributed".
- Instant repairs, instant construction and development materials brought back by expeditions are now recorded. Earlier expedition records cannot be filled in.
- The panel deducts an instant repair as soon as it is used at a dock.

**Quest Navigator**
- A recurring quest last seen completed in an earlier cycle is now labelled "observed last cycle" in a neutral colour instead of "observed complete".

### Data compatibility

- IndexedDB schema goes from v15 to v17: one new table for docking and remodel material use, one for sortie costs. Existing data is untouched and nothing is backfilled.
- The backup format goes from v9 to v11 to carry both tables. Backups made by earlier versions still import. A v11 backup cannot be imported by an earlier version of the extension.
- No permission changes.

## [1.1.1.0] - 2026-11-11

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
- Captured responses are now passed inside the extension through a private message channel instead of being broadcast on the game page.
- **Mute Game** now only mutes the game tab and no longer modifies audio objects inside the game page. What you hear is unchanged.
- The capture script no longer leaves a global variable in the game page.
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

**Seasonal quests**
- The Quest Navigator now shows the Halloween 2026 quests as running from the 10/14 update to the 11/11 maintenance.
- When a time-limited quest that has ended comes back under the same quest number, it is treated as a new quest even if its title is unchanged, so last year's rewards, translations and unlock links are not shown for it.
- Added the 11/11 quests "Akizuki-class Exercise Mission 2026" and "Saury Festival Preparation Exercises!" (both with progress tracking) and "Strengthening Night Assault Equipment [I]", including rewards and translations.
- Line breaks in the game's quest descriptions now display as line breaks in the Quest Navigator instead of a literal "<br>".
- The Quest Navigator keeps showing the game's own title and description for quests you have seen, even after they leave the quest list or after restoring a backup. Backups now carry this text; older backups still restore.

**Layout fixes**
- In English, the combined-fleet button now shows CTF / STF / TCF, with the full name in the tooltip. The full name wrapped to two lines and pushed the seventh ship past the panel's layout target.
- Side-by-side columns are easier to tell apart: the Upkeep columns have a divider, and expedition conditions, the two-column item list (Traditional Chinese) and the resource log tooltip have wider column gaps.

**Equipment reference**
- XF6F-6 improvement bonuses for US carriers (Lexington, Yorktown, Essex, Independence, Casablanca and Ranger classes): ★1 evasion +1, ★2 anti-air +1, ★3 firepower +1, ★4 and above accuracy +1.

**Remodel goals**
- New **Goals** section in the HQ overview. Pick a ship and the form you want it to reach; the section lists the levels and experience still needed and what the remodels consume, next to what you currently hold.
- Stock is handed out in the order you rank your goals, so a later goal only sees what earlier ones leave. Use the arrows to reorder.
- Amounts the game does not provide in its data (development materials, instant construction materials and a few others) are marked as estimates. Check the in-game remodel screen before committing.
- Items the extension has not seen yet show as unknown instead of 0.
- Goals are stored in the database and travel with backups.

**Developer tools**
- Developer builds have a capture latency report in the panel's Activity tab. It is off in store builds, is kept in memory only, and is never written to the database.

### Data compatibility

- IndexedDB schema goes from v14 to v15: one new table for goals. Existing data is untouched.
- The backup format goes from v8 to v9 to carry goals. Backups made by earlier versions still import. A v9 backup cannot be imported by an earlier version of the extension.
- Quest list observations in backups gain optional title and description fields. Older backups still import; earlier versions of the extension ignore the new fields.
- No permission changes.
