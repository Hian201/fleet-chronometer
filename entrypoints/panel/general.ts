import { esc, idleLabelHtml, matIconHtml, questCategoryMarkHtml } from '@/utils/html-escape';
import { idleMarks } from '@/utils/idle-check';
import { QUEST_CATEGORY_LABEL_KEYS } from '@/utils/quest-category';
import { itemCatalog, itemDetails, itemMatches, uncataloguedUseItem, type CatalogItem, type ItemInventory } from '@/utils/item-catalog';
import { ITEM_PINS_KEY, loadItemPins, saveItemPins, sortPinnedFirst, toggleItemPin } from '@/utils/item-pins';
import { expedDisplayName, getLang, t } from '@/utils/ui-i18n';
import {
    localizedQuestDetail, localizedQuestName, localizedQuestRewardHtml, pendingQuestRewardHtml,
} from '@/utils/quest-catalog-localization';
import { formatQuestTime, type QuestJudgement, type ServerObservation } from '@/utils/quest-tracking';
import { openOverviewAt, type OverviewTabsApi } from '@/utils/open-overview';
import { prepCheckShort, prepCheckText, questConditionShort, questConditionText, questTargetLabel, questTargetShortLabel } from '@/utils/quest-goal-label';
import type { GameState, QuestPrepView, QuestView } from '@/utils/state';
import { questCatalogIdentity } from '@/utils/quest-identity';
import {
    MORALE_INTERVAL_MS, REPAIR_INTERVAL_MS, nextSettlementIn, planAnchorageRepair, planMoraleSupply,
} from '@/utils/repair';

type Page = 'harbor' | 'quests' | 'items';
// anchor＝泊地修理／給糧：只在有艦隊運作時出現（見 render 的 upkeep）。
type Operation = 'exped' | 'dock' | 'build' | 'anchor';
const OPERATIONS = ['exped', 'dock', 'build', 'anchor'] as const;
// 任務展開後的分頁：說明／原文／進度三選一，同時只顯示一個，面板高度不因進度判定而疊加。
type QuestPane = 'detail' | 'original' | 'progress';
// 入渠分組的兩個檢視：每次進入入渠分組都先顯示渠位（見 showDockSlots）。
type DockView = 'slots' | 'damaged';
const copy = {
    'zh-TW': { harbor: '母港', quests: '任務', items: '道具', exped: '遠征', dock: '入渠', build: '建造', anchor: '泊地',
        standard: '道具欄', expansion: '擴張欄', other: '其他', searchOpen: '搜尋道具', searchClose: '關閉搜尋', searchPlaceholder: '名稱', search: '搜尋所有道具欄（繁體中文／日文／英文）',
        pin: '釘選', unpin: '取消釘選', pinned: '已釘選',
        index: '持有量依最近取得的遊戲資料顯示', unavailable: '尚未取得', unknown: '資料尚未取得',
        waiting: '尚未觀測到道具資料', none: '沒有符合的道具', detail: '用途', detailUnknown: '用途說明尚未取得', locked: '未開放',
        docks: '渠位', damaged: '待修', emptyDock: '空渠', noDamaged: '沒有待修的艦', dmgMajor: '大破', dmgMid: '中破', dmgMinor: '小破',
        dockRow: '{stype}・Lv{lv}・耐久 {hp}/{max}・入渠 {time}', onExpedition: '遠征中：回港後才能入渠',
        afterPort: '回港後', afterPortTitle: '出擊中：入渠時間回港後才會更新' },
    ja: { harbor: '母港', quests: '任務', items: 'アイテム', exped: '遠征', dock: '入渠', build: '建造', anchor: '泊地',
        standard: '保有アイテム', expansion: '拡張アイテム', other: 'その他', searchOpen: 'アイテムを検索', searchClose: '検索を閉じる', searchPlaceholder: 'アイテム名', search: 'すべてのアイテム欄を検索（繁体字・日本語・英語）',
        pin: 'ピン留め', unpin: 'ピン留め解除', pinned: 'ピン留め中',
        index: '保有数は最後に取得したゲームデータを表示', unavailable: '未取得', unknown: 'データ未取得',
        waiting: 'アイテムデータを未観測', none: '該当するアイテムなし', detail: '用途', detailUnknown: '日本語の説明は未登録', locked: '未開放',
        docks: 'ドック', damaged: '要修理', emptyDock: '空き', noDamaged: '修理が必要な艦はありません', dmgMajor: '大破', dmgMid: '中破', dmgMinor: '小破',
        dockRow: '{stype}・Lv{lv}・耐久 {hp}/{max}・入渠 {time}', onExpedition: '遠征中：帰投後に入渠できます',
        afterPort: '帰投後', afterPortTitle: '出撃中：入渠時間は帰投後に更新されます' },
    en: { harbor: 'Harbor', quests: 'Quests', items: 'Items', exped: 'Expeditions', dock: 'Repairs', build: 'Construction', anchor: 'Upkeep',
        standard: 'Standard', expansion: 'Expansion', other: 'Other', searchOpen: 'Search items', searchClose: 'Close search', searchPlaceholder: 'Item name', search: 'Search all inventories (Traditional Chinese / Japanese / English)',
        pin: 'Pin', unpin: 'Unpin', pinned: 'Pinned',
        index: 'Counts use the latest observed game response', unavailable: 'Unavailable', unknown: 'Data unavailable',
        waiting: 'Item data has not been observed', none: 'No matching items', detail: 'Use', detailUnknown: 'Description unavailable', locked: 'Locked',
        docks: 'Docks', damaged: 'Damaged', emptyDock: 'Empty', noDamaged: 'No damaged ships', dmgMajor: 'Taiha', dmgMid: 'Chuuha', dmgMinor: 'Shouha',
        dockRow: '{stype} · Lv{lv} · HP {hp}/{max} · Repair {time}', onExpedition: 'On expedition: dock after it returns',
        afterPort: 'Pending', afterPortTitle: 'On sortie: repair time updates after returning to port' },
} as const;
const byId = (id: string) => document.getElementById(id)!;
const fillText = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
// 入渠所需時間（毫秒）→ h:mm:ss；與倒數同格式，長時間的大型艦會超過 24 小時，不進位成天。
function durationText(ms: number) {
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}
// 損傷分級門檻與編成列相同：≤25% 大破、≤50% 中破、≤75% 小破。
function damageClass(hp: number, max: number): 'major' | 'mid' | 'minor' | '' {
    const r = hp / max;
    return r <= 0.25 ? 'major' : r <= 0.5 ? 'mid' : r <= 0.75 ? 'minor' : '';
}
const detailHtml = (s: string) => esc(s).replace(/&lt;br\s*\/?&gt;/gi, '<br>').replace(/\r?\n/g, '<br>');

function serverLabel(obs: ServerObservation | null): string {
    if (!obs) return t('quest.srv.unknown');
    if (obs.done) return t('quest.srv.done');
    return obs.flag === null ? t('quest.srv.unknown') : t(`quest.srv.${obs.flag}`);
}

function judgementLine(item: QuestJudgement, missionName: (id: number) => string): string {
    const node = item.boss ? t('quest.boss') : item.nodeLetter ?? t('quest.route');
    const result = item.counted ? t('quest.counted')
        : item.candidate ? t('quest.candidate')
            : t('quest.notCounted', { why: t(`quest.reason.${item.reason ?? 'rank'}`) });
    const battle = item.mission !== undefined ? t('quest.goal.mission', { names: missionName(item.mission) })
        : item.practice ? `${t('quest.practice')} ${item.rank || '-'}`
            : item.reach ? `${item.map}-${item.nodeLetter ?? '?'} ${t('quest.goal.reach')}`
                : `${item.map} ${node} ${item.rank || '-'}`;
    return t('quest.lastBattle', { time: formatQuestTime(item.ts), battle, result });
}

/** 任務列右側只放進度；可信度標記放在進度分頁。需重核時不再顯示本機計數，只標「需重核」。 */
function questStateHtml(q: QuestView): string {
    const tracking = q.tracking;
    if (q.done || !tracking) {
        const plain = !q.done && q.progress ? `${q.progress.count}/${q.progress.target}` : q.done ? t('quest.done') : t('quest.inProgress');
        return esc(plain);
    }
    if (tracking.recheck) return `<span class="n weak">${esc(t('quest.recheck'))}</span>`;
    if (tracking.prep?.ready) return `<span class="n ready">${esc(t('quest.prep.ready'))}</span>`;
    if (q.progress) {
        const value = tracking.range
            ? `${tracking.range.lo}–${tracking.range.hi}/${q.progress.target}`
            : `${q.progress.count}/${q.progress.target}`;
        return `<span class="n est">${esc(value)}</span>`;
    }
    if (tracking.tier === 'text' && tracking.candidates > 0) {
        return `<span class="n weak">${esc(t('quest.candidates', { n: tracking.candidates }))}</span>`;
    }
    return `<span class="n weak">${esc(serverLabel(tracking.latestServer))}</span>`;
}

/** 進度分頁：可信度、伺服器對照、編成條件、逐子目標進度、上一次判定、詳細紀錄連結。 */
function questProgressHtml(q: QuestView, missionName: (id: number) => string): string {
    const tracking = q.tracking!;
    const srv = serverLabel(tracking.latestServer);
    const sub = (text: string) => `<div class="sub">${esc(text)}</div>`;
    // 第一行：可信度標記與說明（任務列上不放標記，避免擠壓任務名稱）。
    const lines: string[] = [
        `<div class="ledger-quest-tier"><i class="quest-tier tier-${tracking.tier}">${esc(t(`quest.tier.${tracking.tier}`))}</i><span>${esc(t(`quest.tierTip.${tracking.tier}`))}</span></div>`,
    ];
    if (tracking.recheck && q.progress) {
        lines.push(`<div>${esc(t('quest.srvOver', { local: q.progress.count, target: q.progress.target, srv }))}</div>`, sub(t('quest.srvOverNote')));
    } else if (q.progress) {
        if (tracking.latestServer?.status === 'under') lines.push(`<div>${esc(t('quest.srvUnder', { srv }))}</div>`, sub(t('quest.srvUnderNote')));
        else if (tracking.latestServer) lines.push(`<div>${esc(t('quest.srvConsistent', { srv }))}</div>`);
    } else if (tracking.prep) {
        lines.push(`<div>${esc(t('quest.srvPrep', { srv }))}</div>`);
    } else if (tracking.tier === 'text') {
        lines.push(`<div>${esc(t('quest.textServer', { srv }))}</div>`, sub(t('quest.textHidden')));
    } else {
        lines.push(`<div>${esc(t('quest.srvOnly', { srv }))}</div>`);
    }
    if (tracking.prep) lines.push(prepHtml(tracking.prep));
    if (tracking.fleetCheck.length) {
        // 編成條件：每條一個短標籤，完整條件放在提示；表格版在情報總括「進度紀錄」。
        const tip = t('quest.cond.tip');
        lines.push(`<div class="ledger-quest-cond" title="${esc(tip)}">${tracking.fleetCheck.map(check =>
            `<span class="${check.ok ? 'ok' : 'ng'}" title="${esc(`${questConditionText(check, tracking.conditionNames)}\n${tip}`)}">${esc(questConditionShort(check))} ${check.ok ? '✓' : '✗'}</span>`).join('')}</div>`);
    }
    if (tracking.targets) {
        // 需要次數多的子目標畫方格會太長，改顯示數字。
        lines.push(`<div class="ledger-quest-maps">${tracking.targets.map(target => {
            const meter = target.need <= 4
                ? `<span class="pips" role="img" aria-label="${target.count}/${target.need}">${Array.from({ length: target.need }, (_, index) =>
                    `<i${index < target.count ? ' class="on"' : ''}></i>`).join('')}</span>`
                : `<span class="count">${target.count}/${target.need}</span>`;
            return `<span title="${esc(questTargetLabel(target))}">${esc(questTargetShortLabel(target))} ${meter}</span>`;
        }).join('')}</div>`);
    }
    if (tracking.lastJudgement) lines.push(sub(judgementLine(tracking.lastJudgement, missionName)));
    if (tracking.hasLog) lines.push(`<button type="button" class="ledger-quest-more" data-quest-log="${q.no}">${esc(t('quest.fullLog'))}</button>`);
    return `<div class="ledger-quest-prog">${lines.join('')}</div>`;
}

/** 達成條件：整體狀態一行、各條件一個短標籤（完整說明在提示）；符合 ✓、不符合 ✗、不可考 ?。 */
function prepHtml(prep: QuestPrepView): string {
    const state = prep.ready === true ? 'ready' : prep.ready === null ? 'unknown' : 'missing';
    const scope = prep.anyFleet && prep.fleet ? t('quest.prep.anyFleet', { n: prep.fleet })
        : prep.fleet ? t('quest.prep.fleet', { n: prep.fleet }) : t('quest.prep.tip');
    const note = prep.ready === true ? t('quest.prep.readyNote') : prep.ready === null ? t('quest.prep.unknownNote') : '';
    const mark = (ok: boolean | null) => ok === true ? '✓' : ok === false ? '✗' : '?';
    const chips = prep.checks.map(check => {
        const cls = check.ok === true ? 'ok' : check.ok === false ? 'ng' : 'unk';
        return `<span class="${cls}" title="${esc(`${prepCheckText(check, prep.names)}\n${scope}`)}">${esc(prepCheckShort(check, prep.names))} ${mark(check.ok)}</span>`;
    }).join('');
    return `<div class="ledger-quest-prep ${state}"><b>${esc(t(`quest.prep.${state}`))}</b><span>${esc(scope)}</span></div>`
        + (note ? `<div class="sub">${esc(note)}</div>` : '')
        + `<div class="ledger-quest-cond">${chips}</div>`;
}

const pinMark = (label: string) => `<svg class="pin-mark" viewBox="0 0 10 10" role="img" aria-label="${esc(label)}"><path d="M3 1h4v1L6.2 2.6V5L8 6.4V7H5.5v2.5L5 10l-.5-.5V7H2v-.6L3.8 5V2.6L3 2z"/></svg>`;

export function mountGeneral(state: GameState, countdown: (time: number) => string, repairCountdown: (ms: number) => string) {
    const nav = byId('general-nav');
    const operationNav = byId('operation-nav');
    const inventoryNav = byId('inventory-nav');
    const search = byId('item-search') as HTMLInputElement;
    const searchRow = byId('item-search-row');
    const searchToggle = byId('item-search-toggle') as HTMLButtonElement;
    const results = byId('inventory-results');
    const questsEl = byId('quests');
    let page: Page = 'harbor';
    let operation: Operation = 'exped';
    let dockView: DockView = 'slots';
    let damagedSignature = '';
    let dockHeadingSignature = '';
    let inventory: ItemInventory = 'standard';
    let questSignature = '';
    let itemSignature = '';
    const openQuests = new Set<number>();
    const questPanes = new Map<number, QuestPane>();
    const openItems = new Set<string>();
    let pins = loadItemPins();
    const label = () => copy[getLang()];

    function showPage(next: Page) {
        page = next;
        for (const key of ['harbor', 'quests', 'items'] as const) {
            byId('general-' + key).hidden = key !== page;
            nav.querySelector(`[data-page="${key}"]`)?.setAttribute('aria-selected', String(key === page));
        }
        if (page === 'items') renderItems();
    }
    function showDockView(next: DockView) {
        dockView = next;
        byId('ndocks').hidden = dockView !== 'slots';
        byId('damaged').hidden = dockView !== 'damaged';
        for (const button of byId('heading-dock').querySelectorAll<HTMLButtonElement>('[data-dock-view]'))
            button.setAttribute('aria-pressed', String(button.dataset.dockView === dockView));
    }
    /** 進入入渠分組（點分組、回到母港頁或切回一般分頁）時一律先顯示正在入渠的渠位。 */
    function showDockSlots() {
        showDockView('slots');
    }
    function showOperation(next: Operation) {
        operation = next;
        for (const key of OPERATIONS) {
            byId('operation-' + key).hidden = key !== operation;
            operationNav.querySelector(`[data-operation="${key}"]`)?.setAttribute('aria-selected', String(key === operation));
        }
    }
    function selectInventory(next: ItemInventory) {
        inventory = next;
        renderItems();
    }
    nav.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-page]');
        if (!button) return;
        if (button.dataset.page === 'harbor') showDockSlots();
        showPage(button.dataset.page as Page);
    });
    operationNav.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-operation]');
        if (!button) return;
        if (button.dataset.operation === 'dock') showDockSlots();
        showOperation(button.dataset.operation as Operation);
    });
    byId('heading-dock').addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-dock-view]');
        if (button) showDockView(button.dataset.dockView as DockView);
    });
    inventoryNav.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-inventory]');
        if (button) selectInventory(button.dataset.inventory as ItemInventory);
    });
    inventoryNav.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const tabs = [...inventoryNav.querySelectorAll<HTMLButtonElement>('[data-inventory]')];
        const currentIndex = tabs.findIndex(tab => tab.dataset.inventory === inventory);
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(currentIndex + delta + tabs.length) % tabs.length];
        if (next) selectInventory(next.dataset.inventory as ItemInventory);
        inventoryNav.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    });
    search.addEventListener('input', () => {
        renderItems();
    });
    // 搜尋列平時收起，把高度讓給清單；收起即清空條件，避免看不見的篩選殘留。
    function setSearchOpen(open: boolean) {
        searchRow.hidden = !open;
        if (!open && search.value) search.value = '';
        renderItems();
        (open ? search : searchToggle).focus();
    }
    searchToggle.addEventListener('click', () => setSearchOpen(searchRow.hidden));
    search.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        setSearchOpen(false);
    });
    results.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-pin-key]');
        if (!button) return;
        const key = button.dataset.pinKey!;
        pins = toggleItemPin(pins, key);
        saveItemPins(pins);
        renderItems();
        results.querySelector<HTMLButtonElement>(`[data-pin-key="${CSS.escape(key)}"]`)?.focus();
    });
    // 同 origin 的其他面板或分頁改了釘選時跟著更新。
    window.addEventListener('storage', event => {
        if (event.key !== ITEM_PINS_KEY) return;
        pins = loadItemPins();
        renderItems();
    });
    questsEl.addEventListener('toggle', event => {
        const node = event.target as HTMLDetailsElement;
        if (!node.matches('.ledger-quest')) return;
        const no = Number(node.dataset.no);
        if (node.open) openQuests.add(no); else openQuests.delete(no);
    }, true);
    questsEl.addEventListener('click', event => {
        const target = event.target as HTMLElement;
        const log = target.closest<HTMLButtonElement>('[data-quest-log]');
        if (log) {
            event.preventDefault();
            const no = Number(log.dataset.questLog);
            if (!Number.isSafeInteger(no) || no <= 0) return;
            // 已開著的情報總括分頁直接切到該任務的進度紀錄，不另開新分頁。
            openOverviewAt(browser as unknown as OverviewTabsApi, `/quest-flow?no=${no}&tab=progress`)
                .catch(error => console.error('[panel] 開啟任務進度紀錄失敗', error));
            return;
        }
        const button = target.closest<HTMLButtonElement>('[data-quest-pane]');
        const quest = button?.closest<HTMLElement>('.ledger-quest');
        if (!button || !quest) return;
        event.preventDefault();
        const no = Number(quest.dataset.no);
        const pane = button.dataset.questPane as QuestPane;
        questPanes.set(no, pane);
        // 只切換這一列的分頁，不重繪整份清單，保留其他列的展開與捲動位置。
        quest.querySelectorAll<HTMLButtonElement>('[data-quest-pane]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        quest.querySelectorAll<HTMLElement>('[data-quest-pane-body]').forEach(body => { body.hidden = body.dataset.questPaneBody !== pane; });
    });
    results.addEventListener('toggle', event => {
        const node = event.target as HTMLDetailsElement;
        if (!node.matches('.ledger-item-row')) return;
        const key = node.dataset.itemKey!;
        if (node.open) openItems.add(key); else openItems.delete(key);
    }, true);

    const countOf = (item: CatalogItem): number | null => {
            const source = item.countSource;
            if (source.kind === 'useitem') return state.useItemCount(source.id);
            if (source.kind === 'payitem') return state.payItemCount(source.id);
            if (source.kind === 'material') return state.materialCount(source.apiId);
            return state.slotItemCountByJapaneseName(source.nameJa);
    };
    const inventoryObserved = () => state.useItemCounts !== null || state.payItemCounts !== null
        || state.slotItemInventoryKnown || state.materials.some(value => Number.isFinite(value));
    const itemIdentity = (item: CatalogItem) => {
        const source = item.countSource;
        if (source.kind === 'useitem') return `useitem:${source.id}`;
        if (source.kind === 'payitem') return `payitem:${source.id}`;
        if (source.kind === 'material') return `material:${source.apiId}`;
        return `slotitem:${source.nameJa}`;
    };
    function currentInventoryItems(): (CatalogItem & { count: number | null })[] {
        if (!inventoryObserved()) return [];
        const knownUseItemIds = new Set(itemCatalog.filter(item => item.countSource.kind === 'useitem')
            .map(item => item.countSource.kind === 'useitem' ? item.countSource.id : -1));
        const items = [...itemCatalog];
        for (const observed of state.observedUseItems_() ?? []) {
            if (observed.count <= 0 || knownUseItemIds.has(observed.id)) continue;
            items.push(uncataloguedUseItem(observed.id, state.useItemName(observed.id)));
        }
        return items.map(item => {
            const apiName = item.countSource.kind === 'useitem' ? state.useItemName(item.countSource.id) : undefined;
            const localized = apiName ? { ...item, names: { ...item.names, ja: apiName } } : item;
            return { ...localized, count: countOf(item) };
        }).filter(item => item.count === null
            ? item.countSource.kind !== 'useitem'
            : item.count > 0);
    }
    function renderItems() {
        const l = label();
        search.placeholder = l.searchPlaceholder;
        search.setAttribute('aria-label', l.search);
        const searchLabel = searchRow.hidden ? l.searchOpen : l.searchClose;
        searchToggle.setAttribute('aria-label', searchLabel);
        searchToggle.title = searchLabel;
        searchToggle.setAttribute('aria-expanded', String(!searchRow.hidden));
        const term = search.value;
        const allItems = currentInventoryItems();
        const matches = allItems.filter(item => itemMatches(item, term));
        const inventoryKeys: ItemInventory[] = ['standard', 'expansion'];
        if (allItems.some(item => item.inventory === 'other')) inventoryKeys.push('other');
        if (!inventoryKeys.includes(inventory)) inventory = 'standard';
        if (term && !matches.some(item => item.inventory === inventory)) {
            const firstMatch = inventoryKeys.find(key => matches.some(item => item.inventory === key));
            if (firstMatch) inventory = firstMatch;
        }
        const counts = new Map(inventoryKeys.map(key => [key, matches.filter(item => item.inventory === key).length]));
        inventoryNav.innerHTML = inventoryKeys.map(key =>
            `<button type="button" data-inventory="${key}" role="tab" aria-selected="${key === inventory}" tabindex="${key === inventory ? 0 : -1}"><span>${esc(l[key])}</span><span class="capacity matches">${counts.get(key) ?? 0}</span></button>`).join('');
        const shown = sortPinnedFirst(matches.filter(item => item.inventory === inventory), itemIdentity, pins);
        const signature = JSON.stringify([getLang(), inventory, term,
            shown.map(item => [itemIdentity(item), item.count, item.names[getLang()]]), [...openItems].sort(), pins]);
        if (signature === itemSignature) return;
        const scrollTop = results.querySelector('.ledger-item-grid')?.scrollTop ?? 0;
        // 「持有量依最近取得的遊戲資料」只放在數量提示，不另佔一列說明。
        results.innerHTML = shown.length ? `<div class="ledger-item-grid" role="list">${shown.map(item => {
            const identity = itemIdentity(item);
            const key = item.inventory + ':' + identity;
            const pinned = pins.includes(identity);
            const name = item.names[getLang()];
            const description = itemDetails[item.inventory + ':' + item.id];
            const detail = getLang() === 'en' ? description?.en : getLang() === 'zh-TW' ? description?.zh : undefined;
            const countText = item.count === null ? '—' : item.count.toLocaleString();
            const countLabel = item.count === null ? l.unavailable : item.count.toLocaleString();
            return `<details class="ledger-item-row${pinned ? ' pinned' : ''}" role="listitem" data-item-key="${esc(key)}"${openItems.has(key) ? ' open' : ''}><summary title="${esc(name)}"><span class="name">${pinned ? pinMark(l.pinned) : ''}${esc(name)}</span><span class="count" title="${esc(l.index)}" aria-label="${esc(countLabel)}">${esc(countText)}</span><span class="arrow" aria-hidden="true">›</span></summary><div class="item-detail"><span class="item-detail-label">${esc(l.detail)}</span><span class="item-detail-text">${detail ? esc(detail) : esc(l.detailUnknown)}</span><button type="button" class="item-pin" data-pin-key="${esc(identity)}" aria-pressed="${pinned}">${esc(pinned ? l.unpin : l.pin)}</button></div></details>`;
        }).join('')}</div>` : `<div class="ledger-item-empty">${esc(inventoryObserved() ? l.none : l.waiting)}</div>`;
        const grid = results.querySelector('.ledger-item-grid');
        if (grid) grid.scrollTop = scrollTop;
        itemSignature = signature;
    }

    // 每個在港運作的艦隊一列，修理與給糧各一欄。四隊可同時運作（明石／野埼可重複持有）。
    function upkeepRows() {
        return state.fleets().flatMap((fleet, index) => {
            const rep = planAnchorageRepair(fleet);
            const mor = planMoraleSupply(fleet);
            return rep.active || mor.active ? [{ fleet, no: index + 1, rep, mor }] : [];
        });
    }
    // 倒數一律是推算（遊戲不送這兩個機制的封包）；錨點不可考時明講「不可考」而不是留白，
    // 出擊中（錨點 null）回港前不會結算，不顯示倒數。.rcd 由面板每秒只改文字。
    function upkeepTime(anchor: number | null | undefined, interval: number) {
        if (anchor === undefined) return `<span class="time unknown" title="${esc(t('repair.unknownAnchorTitle'))}">${esc(t('repair.unknownAnchor'))}</span>`;
        const ms = nextSettlementIn(anchor, interval);
        if (ms === undefined) return '<span class="time"></span>';
        return `<span class="time rcd" data-anchor="${anchor}" data-interval="${interval}">${esc(repairCountdown(ms))}</span>`;
    }
    function upkeepHtml(rows: ReturnType<typeof upkeepRows>) {
        const none = '<span class="upkeep-cell none" aria-hidden="true">—</span>';
        // 欄頭右側的「下次」對齊下方倒數：這裡的時間是下次結算的週期倒數，不是士氣到達時刻
        // （那個在編成摘要的「士氣 49 › 54」）。
        const next = `<span class="next">${esc(t('repair.nextLabel'))}</span>`;
        return `<div class="upkeep-row upkeep-head"><span></span><span title="${esc(t('repair.repairTitle'))}"><img class="upkeep-icon" src="/icons/ui/dock.svg" alt="" aria-hidden="true">${esc(t('repair.colRepair'))}${next}</span><span title="${esc(t('repair.moraleTitle'))}"><img class="upkeep-icon" src="/icons/ui/provision.svg" alt="" aria-hidden="true">${esc(t('repair.colMorale'))}${next}</span></div>` +
            rows.map(({ fleet, no, rep, mor }) => {
                const repCell = rep.active
                    ? `<span class="upkeep-cell${rep.accelerated ? ' accel' : ''}"><span class="n">${esc(t('repair.shipCount', { n: rep.coverage }))}</span>${rep.accelerated ? `<em class="mode">${esc(t('repair.accelLabel'))}</em>` : ''}${upkeepTime(fleet.repairAnchor, REPAIR_INTERVAL_MS)}</span>`
                    : none;
                const morCell = mor.active
                    ? `<span class="upkeep-cell"><span class="n">${esc(t('repair.shipCount', { n: mor.slots.filter(slot => slot.willRecover).length }))}</span>${upkeepTime(fleet.moraleAnchor, MORALE_INTERVAL_MS)}</span>`
                    : none;
                return `<div class="upkeep-row"><span class="slot">${no}</span>${repCell}${morCell}</div>`;
            }).join('');
    }

    function render() {
        const l = label();
        nav.setAttribute('aria-label', t('tab.general'));
        const idle = idleMarks(state, Date.now());
        const idleTip = (key: 'exped' | 'dock' | 'quests', n: number) => n > 0 ? t('idle.' + key, { n }) : null;
        nav.innerHTML = (['harbor', 'quests', 'items'] as const).map(key =>
            `<button type="button" data-page="${key}" role="tab" aria-selected="${key === page}">${idleLabelHtml(l[key], key === 'quests' ? idleTip('quests', idle.quests) : null)}${key === 'quests' ? `<span class="count">${state.quests_().length}</span>` : ''}</button>`).join('');
        const materialKeys = ['fuel', 'ammo', 'steel', 'bauxite', 'torch', 'drum', 'devmat', 'screw'] as const;
        byId('resline').innerHTML = materialKeys.map((key, index) => {
            const title = t('mat.' + key + '.full');
            const value = state.materials[index];
            return `<span class="ledger-material${index > 3 ? ' secondary' : ''}" title="${esc(title)}" aria-label="${esc(title)} ${value == null ? l.unavailable : value.toLocaleString()}">${matIconHtml(key, title)}<b class="value">${value == null ? '—' : value.toLocaleString()}</b></span>`;
        }).join('');
        const missions = state.missions();
        const activeDock = state.ndocks();
        const activeBuild = state.kdocks();
        const upkeep = upkeepRows();
        // 「泊地」分組只在有艦隊泊地修理或給糧時出現；運作結束時退回遠征分組。
        if (!upkeep.length && operation === 'anchor') operation = 'exped';
        const shownOps = OPERATIONS.filter(key => key !== 'anchor' || upkeep.length > 0);
        const groupCounts = { exped: missions.length, dock: activeDock.length, build: activeBuild.length, anchor: upkeep.length };
        operationNav.classList.toggle('has-anchor', upkeep.length > 0);
        operationNav.innerHTML = shownOps.map(key =>
            `<button type="button" data-operation="${key}" role="tab" aria-selected="${key === operation}">${idleLabelHtml(l[key], key === 'exped' || key === 'dock' ? idleTip(key, idle[key]) : null)}<span class="count">${groupCounts[key]}</span></button>`).join('');
        const slots = state.ndockSlots();
        const damaged = state.damagedShips();
        for (const key of OPERATIONS) if (key !== 'dock') byId('heading-' + key).innerHTML = `<strong>${esc(l[key])}</strong>`;
        const openSlots = slots.filter(slot => slot.state >= 0).length;
        const pressed = (view: DockView) => String(view === dockView);
        // 標題內容沒變就不重建，鍵盤操作切換鈕時焦點不會被每筆封包的重繪沖掉；按下狀態由 showDockView 更新。
        const dockHeading = `<strong>${esc(l.dock)}</strong><span class="dock-seg" role="group" aria-label="${esc(l.dock)}">`
            + `<button type="button" data-dock-view="slots" aria-pressed="${pressed('slots')}">${esc(l.docks)}<span class="n">${slots.length ? `${activeDock.length}/${openSlots}` : '—'}</span></button>`
            + `<button type="button" data-dock-view="damaged" aria-pressed="${pressed('damaged')}">${esc(l.damaged)}<span class="n">${state.ships.size ? damaged.length : '—'}</span></button></span>`;
        const headingKey = dockHeading.replace(/ aria-pressed="(true|false)"/g, '');
        if (headingKey !== dockHeadingSignature) {
            byId('heading-dock').innerHTML = dockHeading;
            dockHeadingSignature = headingKey;
        }
        byId('anchorage').innerHTML = upkeep.length ? upkeepHtml(upkeep) : '';
        byId('missions').innerHTML = missions.map(mm => {
            const name = expedDisplayName(mm.missionId, mm.name);
            return `<div class="ledger-op"><span class="slot">${esc(mm.fleet)}</span><span class="name" title="${esc(name)}">${esc(name)}</span><span class="time" data-countdown-at="${esc(String(mm.completeAt))}">${countdown(mm.completeAt)}</span></div>`;
        }).join('') || `<div class="g-empty">${esc(t('common.empty'))}</div>`;
        byId('ndocks').innerHTML = slots.length ? slots.map(slot => {
            if (slot.state < 0) return `<div class="ledger-op locked"><span class="slot">${slot.id}</span><span class="name">${esc(l.locked)}</span><span class="time"></span></div>`;
            if (slot.ship === null) return `<div class="ledger-op dock-empty"><span class="slot">${slot.id}</span><span class="name">${esc(l.emptyDock)}</span><span class="time"></span></div>`;
            return `<div class="ledger-op"><span class="slot">${slot.id}</span><span class="name" title="${esc(slot.ship)}">${esc(slot.ship)}</span>`
                + (slot.completeAt === null ? '<span class="time"></span>'
                    : `<span class="time" data-countdown-at="${esc(String(slot.completeAt))}">${countdown(slot.completeAt)}</span>`) + '</div>';
        }).join('') : `<div class="g-empty">${esc(l.unknown)}</div>`;
        // 待修清單內容沒變就不重繪，保留使用者的捲動位置。
        const damagedKey = JSON.stringify([getLang(), state.ships.size > 0, damaged]);
        if (damagedKey !== damagedSignature) {
            const list = byId('damaged');
            const scrollTop = list.scrollTop;
            list.innerHTML = damaged.map(ship => {
                const dmg = damageClass(ship.hp, ship.maxhp);
                const tag = dmg === 'major' ? l.dmgMajor : dmg === 'mid' ? l.dmgMid : dmg === 'minor' ? l.dmgMinor : '';
                const time = ship.ndockTime === null ? l.afterPort : durationText(ship.ndockTime);
                const title = [ship.name,
                    fillText(l.dockRow, { stype: t('stype.' + ship.stypeId), lv: ship.lv, hp: ship.hp, max: ship.maxhp, time }),
                    ...(ship.ndockTime === null ? [l.afterPortTitle] : []),
                    ...(ship.onExpedition ? [l.onExpedition] : [])].join('\n');
                const pct = Math.max(0, Math.min(100, (ship.hp / ship.maxhp) * 100));
                return `<div class="dock-row${dmg ? ' st-' + dmg : ''}${ship.onExpedition ? ' away' : ''}" title="${esc(title)}">`
                    + `<span class="fl">${ship.fleet ?? ''}</span><span class="name">${esc(ship.name)}</span>`
                    + `<span class="hpbar"><i style="width:${pct.toFixed(1)}%"></i></span>`
                    + `<span class="hp">${ship.hp}/${ship.maxhp}</span><span class="tag">${esc(tag)}</span>`
                    + `<span class="time${ship.ndockTime === null ? ' unknown' : ''}">${esc(time)}</span></div>`;
            }).join('') || `<div class="g-empty">${esc(state.ships.size ? l.noDamaged : l.unknown)}</div>`;
            list.scrollTop = scrollTop;
            damagedSignature = damagedKey;
        }
        byId('kdocks').innerHTML = state.kdockData.length ? state.kdockData.map((raw, index) => {
            const id = Number(raw.api_id) || index + 1;
            const view = activeBuild.find(entry => entry.id === id);
            const stateCode = Number(raw.api_state);
            const name = view?.ship ?? (stateCode === -1 ? l.locked : t('common.empty'));
            const time = view ? (view.state === 3 ? t('kdock.complete') : countdown(view.completeAt)) : '';
            return `<div class="ledger-op${stateCode === -1 ? ' locked' : ''}${stateCode === 3 ? ' done' : ''}"><span class="slot">${id}</span><span class="name">${esc(name)}</span><span class="time"${view && view.state !== 3 ? ` data-countdown-at="${esc(String(view.completeAt))}"` : ''}>${esc(time)}</span></div>`;
        }).join('') : `<div class="g-empty">${esc(l.unknown)}</div>`;
        const quests = state.quests_();
        byId('quest-heading').innerHTML = `<strong>${esc(l.quests)}</strong><span>${quests.length}</span>`;
        const questLocale = getLang();
        const signature = JSON.stringify([questLocale, quests.map(q => [q.no, q.name, q.detail, q.done, q.category, q.progress?.count, q.progress?.target, q.tracking])]);
        if (signature !== questSignature) {
            const scrollTop = questsEl.scrollTop;
            questsEl.innerHTML = quests.map(q => {
                // 營運重用編號的新任務（標題與目錄不同）：譯文與獎勵都是舊任務的，改顯示遊戲原文，
                // 獎勵標為尚未收錄；說明已是原文，不再另設原文分頁。
                const reused = questCatalogIdentity(q.no, q.name) === 'mismatch';
                const name = reused ? q.name : localizedQuestName(q.no, questLocale, q.name);
                const detail = reused ? q.detail : localizedQuestDetail(q.no, questLocale, q.detail);
                const rewardHtml = reused ? pendingQuestRewardHtml(questLocale) : localizedQuestRewardHtml(q.no, questLocale);
                const reusedNote = reused ? `<p class="ledger-quest-reused">${esc(t('quest.reusedNote'))}</p>` : '';
                // 日文介面的說明就是原文，不另設原文分頁；只剩一個分頁時不顯示切換鈕。
                const panes: QuestPane[] = [
                    'detail',
                    ...(questLocale !== 'ja' && !reused && (q.name || q.detail) ? ['original' as const] : []),
                    ...(q.tracking && !q.done ? ['progress' as const] : []),
                ];
                const stored = questPanes.get(q.no);
                const active: QuestPane = stored && panes.includes(stored) ? stored : 'detail';
                const bodies: Record<QuestPane, string> = {
                    detail: `${reusedNote}${detail ? detailHtml(detail) : esc(t('quest.noDetail'))}${rewardHtml}`,
                    original: `${q.name ? `<p class="ledger-quest-original-name">${esc(q.name)}</p>` : ''}${q.detail ? `<p class="ledger-quest-original-detail">${detailHtml(q.detail)}</p>` : ''}${localizedQuestRewardHtml(q.no, 'ja')}`,
                    progress: panes.includes('progress')
                        ? questProgressHtml(q, id => expedDisplayName(id, state.masterMissions.get(id)?.name ?? `#${id}`))
                        : '',
                };
                const seg = panes.length > 1
                    ? `<div class="ledger-quest-seg" role="group">${panes.map(pane =>
                        `<button type="button" data-quest-pane="${pane}" aria-pressed="${pane === active}">${esc(t(`quest.pane.${pane}`))}</button>`).join('')}</div>`
                    : '';
                return `<details class="ledger-quest${q.done ? ' done' : ''}" data-no="${q.no}"${openQuests.has(q.no) ? ' open' : ''}>
                    <summary><span class="name">${questCategoryMarkHtml(q.category, t(QUEST_CATEGORY_LABEL_KEYS[q.category]))}${esc(name)}</span><span class="state">${questStateHtml(q)}</span><span class="arrow" aria-hidden="true">›</span></summary>
                    <div class="description">${seg}${panes.map(pane =>
                        `<div class="ledger-quest-pane" data-quest-pane-body="${pane}"${pane === active ? '' : ' hidden'}>${bodies[pane]}</div>`).join('')}</div>
                </details>`;
            }).join('') || `<div class="g-empty">${esc(t('common.empty'))}</div>`;
            questsEl.scrollTop = scrollTop;
            questSignature = signature;
        }
        showPage(page);
        showOperation(operation);
        showDockView(dockView);
        if (page !== 'items') renderItems();
    }
    /** 遊戲進入入渠畫面時：切到母港「入渠」分組並顯示渠位。 */
    function showDock() {
        page = 'harbor';
        operation = 'dock';
        dockView = 'slots';
        render();
    }
    /** 遊戲進入任務畫面時切到「任務」頁；離開任務畫面回到母港時切回「母港」頁。 */
    function showQuestPage(on: boolean) {
        if (on) showPage('quests');
        else {
            showDockSlots();
            showPage('harbor');
        }
    }
    /** 切到母港「泊地」分組；沒有艦隊運作時不動並回傳 false。 */
    function showUpkeep(): boolean {
        if (!upkeepRows().length) return false;
        page = 'harbor';
        operation = 'anchor';
        render();
        return true;
    }
    render();
    return Object.assign(render, { showUpkeep, showDockSlots, showDock, showQuestPage });
}
