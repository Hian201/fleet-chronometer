# Changelog

Changes for each Chrome Web Store release. While a version is in store review, its changes collect under **Unreleased** and each update is published as a pre-release tag (`v<version>-rc.N`). When the store approves it, the section is renamed to the version and the final tag `v<version>` is created on the approved commit.

## [Unreleased] — 1.1.1.2

### Highlights

**Anchorage repair timer**
- The anchorage repair timer is now one timer for the whole account, as in the game. Changing a fleet whose flagship is a repair ship, or sending a fleet with a repair ship on an expedition, restarts it; sorties do not. When HP turns out to have been repaired at port, the timer is corrected to that moment.
- After 20 minutes the repair keeps going until the ships are full. Each fleet in the anchorage group shows the HP you get by returning to port now and the time until every ship in range is fully repaired; the countdown sits once in the column header.
- Repaired HP is counted in whole minutes, as in the game.

**Expedition planning in phases**
- The expedition planner can now suggest rotating two or three sets of expeditions instead of one fixed set, when that fills every chosen resource noticeably sooner (or leaves more by the stockpile deadline). With daily spending across four or five resources, this often saves weeks, or makes a goal reachable that a single set never reaches. When the gain is small, it keeps suggesting one set so you don't swap fleets for little.
- The plan page now starts with **Send these now**: the expeditions for your 2nd–4th fleets, the current phase, and the condition for moving to the next one (for example, when steel reaches 166K). Below it, **Overall plan** lists every phase by fleet, with changes from the previous phase in bold.
- The plan remembers its route: after you reach a phase's target, reopening the page continues with the next phase. It only reroutes when a new route is clearly better, or when you change the settings. It also prefers to keep the expeditions your fleets are already running.

## [1.1.1.1] - 2026-11-20

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

**Panel**
- Opening the in-game quest screen now switches the panel to the Quests page. Returning to port from the quest screen switches it back to the Harbor page.
- When you are not on a sortie, the Sortie tab now shows this round's practice opponents: which group they were drawn from, how many battles are left, when the list resets, and the result against each opponent. Opening Practice in game switches the panel to it. The map gauge list that used to appear there is gone; gauges still show in the header during a sortie.
- During a practice battle the header shows the opponent and this round's results. After the day battle, the bottom-right box shows what the next rank and S still need in the night battle, assuming your fleet takes no more damage.
- A small brass dot on a tab marks unused capacity before you log off: idle fleets on Expeditions, empty docks with ships waiting on Repairs, completed but unclaimed quests that the 05:00 reset will clear on Quests, and practice battles left this round on Sortie. Hover over the dot for the count.

**Wording**
- Explanations, tooltips and import errors now refer to what the extension reads as "game data" or "responses".

**Item drops and the Saury Festival**
- Sortie results now record dropped items. The panel's drop box lists them with your current count, next to any dropped ship, and the Sortie Log shows them per node, per sortie and in the battle log. Sorties recorded before this version have no item data.
- The Drop Log has new **Ship Drops** and **Item Drops** sub-tabs. Item Drops counts catches by area, map and node during each Saury Festival season, keeping battles with unknown results apart, and shows recent counts and the streak since the last catch.
- Maps set not to be recorded can still count towards item statistics with the new **Still count item drops** option. Those battles feed only Item Drops; they get no replay, sortie log entry or sortie cost.
- You can set your own reminder: when one area yields N items within the last X hours, the panel sends one notification. There are no default thresholds.
- During the Saury Festival, the fleet summary reminds you when a fleet carries depth charges. Click the reminder to turn it off for the season.

**Factory and improvements**
- The panel's Factory tab has a new **Today** improvement page: what you can improve today and which ship to use as the second ship. The list changes at 00:00 Japan time.
- In HQ Overview, Construction, Development and Improvement are merged into one **Factory** section with three sub-tabs. Old bookmarks still open the right page.
- Equipment search matches Traditional Chinese, Japanese and English names.

**Goals and stockpile**
- Remodel goals now estimate when each missing material will be ready, from the last four weeks of income, as a range between the slowest and fastest week.
- New **Stockpile** goal: every resource to its cap, with an optional deadline. It shows how many days each resource needs to reach the cap and what you will have by the deadline, and marks resources that will cap early.
- The Ship roster has a goal column that links to Goals for that ship.

**Expeditions**
- The Expeditions section is split into Log, Plan and Unlocks sub-tabs.
- Plan suggests three expeditions to run together so that the scarcest of the resources you select is as high as possible by your deadline, or so that everything fills fastest if there is no deadline. You can say how long you will be away, and only expeditions currently available to you are suggested.
- Monthly expeditions are listed separately with this cycle's deadline and whether you have completed them this cycle. Unlocks shows the monthly unlock path and which regular expeditions are open.
- Records of monthly and combat expeditions keep each ship's equipment. Expeditions are shown by their in-game number, and reward items use icons with counts.

**Resource log**
- Fuel, ammo, steel and bauxite get the same kind of ledger as the discrete materials: opening + natural regeneration + income + en-route change − spending + unattributed = closing. Natural regeneration and sortie spending are estimates.
- Warnings appear when a resource is above the natural regeneration cap or at the stockpile cap.

**Other**
- The Ship roster can show how much modernization each stat has left, and has a night battle power column.
- Quest Navigator can filter quests by release year and sort them from oldest to newest, and tells you which page of the in-game quest list to look at.
- The Nozaki ration timer is now one timer for the whole account, as in the game, and the anchorage group shows how many rations have built up.
- The theater mode toolbar follows language changes without reloading the game.
- Practice night battles now update HP in the panel.
- Fixes from a full code review covering data integrity, battle display and UI.

### Data compatibility

- IndexedDB schema goes from v15 to v17: one new table for docking and remodel material use, one for sortie costs. Existing data is untouched and nothing is backfilled.
- The backup format goes from v9 to v12 to carry both tables, item drops and the stockpile goal. Backups made by earlier versions still import. A v12 backup cannot be imported by an earlier version of the extension.
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
- Store builds no longer leave debug variables in the game page or print captured responses to its console.
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
