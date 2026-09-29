import type { GameState, QuestTrackingDetail, QuestView } from './state';
import {
    KC3_UNLOCKS_RAW, QUEST_CATALOG_RAW, QUEST_CATALOG_TEXT_OVERRIDES,
} from './quest-catalog-data';
import {
    KCWIKI_QUEST_GRAPH_RAW, QUEST_CATALOG_SUPPLEMENT_RAW, QUEST_PLANNER_GRAPH_RAW,
    TSUKINOHASHI_QUEST_GRAPH_RAW, WIKI_QUEST_GRAPH_RAW, ZEKAMASHI_QUEST_GRAPH_RAW,
} from './quest-graph-data';
import { QUEST_REVIEWED_RELATIONS } from './quest-graph-reviewed';

export type QuestCategory =
    | 'composition' | 'sortie' | 'practice' | 'expedition'
    | 'supply-dock' | 'arsenal' | 'modernization' | 'unknown';

export type QuestPeriod =
    | 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'other' | 'unknown';

export type QuestEvidence = 'confirmed' | 'single-source' | 'checking' | 'conflict';
export type QuestRelationOperator = 'none' | 'all' | 'any' | 'same-period' | 'unknown' | 'conflict';
export type QuestSourceId = 'catalog' | 'structured' | 'kcwiki' | 'unlock' | 'zekamashi' | 'tsukinohashi';

export type QuestStatus =
    | 'available'
    | 'in-progress'
    | 'ready-to-claim'
    | 'observed-complete'
    | 'inferred-complete'
    | 'manual-complete'
    | 'locked'
    | 'unknown'
    | 'expired';

export interface QuestDefinition {
    apiNo: number;
    wikiIds: string[];
    name: string;
    detail: string;
    category: QuestCategory;
    period: QuestPeriod;
    limited: boolean;
    limitedState: 'active' | 'unknown';
    apiCategory: number | null;
    apiType: number | null;
    wikiPrerequisites: number[];
    /** wiki 開放条件的組合：子句之間 AND、子句內 OR；沒有 wiki 句型資料時不給。 */
    wikiClauses?: QuestWikiEdge[][];
    /** ぜかまし攻略「前提／後続」列出的前置（視為全部需要）；沒有攻略資料時不給。 */
    zekamashiPrerequisites?: QuestWikiEdge[];
    /** ぜかまし註記「他不明」。 */
    zekamashiConditionUnknown?: boolean;
    /** tsukinohashi 單發任務樹的前置；只在其他來源衝突時參與投票。 */
    tsukinohashiPrerequisites?: number[];
    /** 舰娘百科任務總表的前置（附「待验证」旗標）；與 poi 同源，計票時合為一票。 */
    kcwikiPrerequisites?: QuestWikiEdge[];
    /** 舰娘百科註記「可能还需达成其他条件」等。 */
    kcwikiConditionUnknown?: boolean;
    structuredPrerequisites: number[];
    unresolvedPrerequisites: string[];
    sources: QuestSourceId[];
    wikiPresent: boolean;
    structuredPresent: boolean;
    wikiConditionUnknown: boolean;
    structuredConditionUnknown: boolean;
}

export interface QuestWikiEdge {
    no: number;
    /** 來源對這條前置註記待驗證：wiki 的【検証中】／【要確認】／(反証待ち)／整句問號，ぜかまし的「要確認」「かも」等。 */
    pending: boolean;
}

export interface QuestPrerequisiteEdge {
    no: number;
    sources: QuestSourceId[];
    pending: boolean;
    /** wiki 與ぜかまし彼此一致卻都沒列、只有 KC3／poi 列出的前置；視同待驗證。 */
    disputed: boolean;
    evidence: QuestEvidence;
}

export interface QuestRelation {
    prerequisites: number[];
    /** 逐條前置的來源與驗證狀態；與 prerequisites 同序。 */
    edges: QuestPrerequisiteEdge[];
    /**
     * 來源衝突時只有單一來源提出的前置：不列入 prerequisites，作為「主要前置都完成仍刷不出任務時」
     * 可以再試的備考。
     */
    remarks: QuestPrerequisiteEdge[];
    /** 來源衝突、改以多數共識（至少兩個來源）決定主要前置。 */
    consensus: boolean;
    /** 人工裁決的核對日期（quest-graph-reviewed.ts）；沒有裁決為 null。 */
    reviewed: string | null;
    /** 營運中途更新觸發條件時的各期間前置；current 為目前日期所在的分段。 */
    phases: { from: string; until: string | null; prerequisites: number[]; current: boolean }[] | null;
    /** wiki 句型涵蓋全部前置時的 AND-of-OR 組合，否則為 null。 */
    clauses: number[][] | null;
    unresolvedPrerequisites: string[];
    confidence: QuestEvidence;
    operator: QuestRelationOperator;
    sources: QuestSourceId[];
}

export interface QuestObservedCompletion {
    count: number;
    lastTs: number;
}

export interface QuestAvailableView {
    no: number;
    name: string;
    detail: string;
}

export interface QuestFlowRow {
    definition: QuestDefinition;
    name: string;
    detail: string;
    status: QuestStatus;
    current: QuestView | null;
    available: QuestAvailableView | null;
    observed: QuestObservedCompletion | null;
    observedCurrentPeriod: boolean;
    progress: { count: number; target: number } | null;
    /** 受注中任務的判定紀錄與伺服器對照；其餘為 null。 */
    tracking: QuestTrackingDetail | null;
    relation: QuestRelation;
    prerequisiteNos: number[];
    /** 來源衝突時只有單一來源提出的前置（備考）。 */
    remarkNos: number[];
    /**
     * 主要前置中的定期任務（日／週／月／季／年）且本週期尚未觀測完成。定期前置只證明曾經完成，
     * 刷不出任務時要先在本週期再完成一次。
     */
    periodicBlockerNos: number[];
    postrequisiteNos: number[];
    blockers: number[];
    nearUnlock: boolean;
}

export interface QuestFlowModel {
    rows: QuestFlowRow[];
    byNo: Map<number, QuestFlowRow>;
    currentNos: Set<number>;
    availableNos: Set<number>;
}

type RawCatalogEntry = readonly [
    number,
    readonly string[],
    string,
    string,
    QuestCategory,
    QuestPeriod,
    boolean,
    number | null,
    number | null,
    readonly number[],
    readonly number[],
    readonly string[],
    number,
];

/** 原始開放邊只保留數字關係；方向是「前置 → 被開放任務」。 */
export const KC3_UNLOCKS = new Map<number, number[]>(
    (KC3_UNLOCKS_RAW as readonly (readonly [number, readonly number[]])[])
        .map(([from, targets]) => [from, [...targets]]),
);

type RawWikiGraphEntry = readonly [
    number,
    readonly (readonly (readonly [number, number])[])[],
    number,
    readonly string[],
    string,
];

interface WikiCondition {
    clauses: QuestWikiEdge[][];
    conditionUnknown: boolean;
    unresolved: string[];
    /** wiki 總表依週期分表，任務所在表格的週期；新着／期間限定表為 null。 */
    period: QuestPeriod | null;
}

/** 遊戲 api_type 對應的週期；5（季／年等）無法再細分。 */
const API_TYPE_PERIOD: Partial<Record<number, QuestPeriod>> = { 1: 'daily', 2: 'weekly', 3: 'monthly', 4: 'once' };

/**
 * wikiwiki 任務總表的現行開放条件（tools/quest-graph 產生）。它和目錄的 wiki 欄是同一來源的
 * 新舊版本，所以有現行資料時取代目錄的 wiki 前置，不另算一個來源，避免同一份 wiki 被重複計票。
 */
const WIKI_CONDITIONS = new Map<number, WikiCondition>(
    (WIKI_QUEST_GRAPH_RAW as readonly RawWikiGraphEntry[]).map(([no, clauses, flags, unresolved, period]) => [no, {
        clauses: clauses.map(clause => clause.map(([from, edgeFlags]) => ({
            no: from, pending: (edgeFlags & 1) !== 0,
        }))),
        // 1＝另有未列出的前置。2＝整句帶問號，產生器已把每條邊標成待驗證，逐條處理即可。
        conditionUnknown: (flags & 1) !== 0,
        unresolved: unresolved.map(id => `wiki:${id}`),
        period: (period || null) as QuestPeriod | null,
    }]),
);

interface ZekamashiCondition {
    edges: QuestWikiEdge[];
    conditionUnknown: boolean;
    unresolved: string[];
}

/** ぜかまし各任務攻略的前提與後續（tools/quest-graph 產生），和 wiki 分開計為獨立來源。 */
const ZEKAMASHI_CONDITIONS = new Map<number, ZekamashiCondition>(
    (ZEKAMASHI_QUEST_GRAPH_RAW as readonly (readonly [
        number, readonly (readonly [number, number])[], number, readonly string[],
    ])[]).map(([no, edges, flags, unresolved]) => [no, {
        edges: edges.map(([from, edgeFlags]) => ({ no: from, pending: (edgeFlags & 1) !== 0 })),
        conditionUnknown: (flags & 1) !== 0,
        unresolved: unresolved.map(name => `zekamashi:${name}`),
    }]),
);

/**
 * poi-plugin-quest-planner 整理的 kcQuests 新版前置（tools/quest-graph 產生）。它和目錄的 poi 前置
 * 是同一條資料線的新舊版本，有資料時取代目錄的 poi 前置，不另算一個來源。
 */
const QUEST_PLANNER = new Map<number, { prerequisites: number[]; unresolved: string[] }>(
    (QUEST_PLANNER_GRAPH_RAW as readonly (readonly [number, readonly number[], readonly string[]])[])
        .map(([no, prerequisites, unresolved]) => [no, {
            prerequisites: [...prerequisites],
            unresolved: unresolved.map(code => `poi:${code}`),
        }]),
);

const TSUKINOHASHI = new Map<number, number[]>(
    (TSUKINOHASHI_QUEST_GRAPH_RAW as readonly (readonly [number, readonly number[]])[])
        .map(([no, prerequisites]) => [no, [...prerequisites]]),
);

const KCWIKI = new Map<number, ZekamashiCondition>(
    (KCWIKI_QUEST_GRAPH_RAW as readonly (readonly [
        number, readonly (readonly [number, number])[], number, readonly string[],
    ])[]).map(([no, edges, flags, unresolved]) => [no, {
        edges: edges.map(([from, edgeFlags]) => ({ no: from, pending: (edgeFlags & 1) !== 0 })),
        conditionUnknown: (flags & 1) !== 0,
        unresolved: unresolved.map(code => `kcwiki:${code}`),
    }]),
);

/** 目錄缺 wiki 代號／名稱的任務，由 KC3 日文任務表補上（例：1020＝2409B1）。 */
const CATALOG_SUPPLEMENT = new Map<number, { code: string; name: string }>(
    (QUEST_CATALOG_SUPPLEMENT_RAW as readonly (readonly [number, string, string])[])
        .map(([no, code, name]) => [no, { code, name }]),
);

/** wiki 代號 → api_no（只收唯一對應）；解析目錄舊資料裡「wiki:2603D1」「poi:2409B1」這類未對應字串。 */
const CODE_TO_NO = (() => {
    const hits = new Map<string, Set<number>>();
    const add = (code: string, no: number) => {
        if (!code) return;
        const set = hits.get(code) ?? new Set<number>();
        set.add(no);
        hits.set(code, set);
    };
    for (const entry of QUEST_CATALOG_RAW as readonly RawCatalogEntry[]) {
        for (const code of entry[1]) add(code, entry[0]);
        add(CATALOG_SUPPLEMENT.get(entry[0])?.code ?? '', entry[0]);
    }
    return new Map([...hits].filter(([, set]) => set.size === 1).map(([code, set]) => [code, [...set][0]]));
})();

/** 「wiki:Gd1（日常改修）」→ Gd1 的 api_no；對不上就回傳 null 並保留原字串。 */
const unresolvedCodeNo = (value: string): number | null => {
    const code = value.slice(value.indexOf(':') + 1).match(/^[0-9A-Za-z]*[A-Za-z][0-9A-Za-z]*\d/)?.[0];
    return code ? CODE_TO_NO.get(code) ?? null : null;
};

const unionNumbers = (...lists: readonly (readonly number[])[]): number[] =>
    [...new Set(lists.flat())].sort((a, b) => a - b);

const KC3_GRAPH_NOS = new Set<number>([
    ...KC3_UNLOCKS_RAW.flatMap(([from, targets]) => [from, ...targets]),
]);

const rawEntry = (value: RawCatalogEntry): QuestDefinition => {
    const [
        apiNo, wikiIds, name, detail, category, period, limited,
        apiCategory, apiType, wikiPrerequisites, structuredPrerequisites,
        unresolvedPrerequisites, flags,
    ] = value as RawCatalogEntry;
    const wiki = WIKI_CONDITIONS.get(apiNo);
    const zekamashi = ZEKAMASHI_CONDITIONS.get(apiNo);
    const planner = QUEST_PLANNER.get(apiNo);
    const kcwiki = KCWIKI.get(apiNo);
    const supplement = CATALOG_SUPPLEMENT.get(apiNo);
    const wikiPresent = wiki !== undefined || (flags & 1) !== 0;
    const structuredPresent = planner !== undefined || (flags & 2) !== 0;
    const textOverride = QUEST_CATALOG_TEXT_OVERRIDES[apiNo as keyof typeof QUEST_CATALOG_TEXT_OVERRIDES];
    const pending = [
        ...unresolvedPrerequisites.filter(value =>
            !(wiki && value.startsWith('wiki:')) && !(planner && value.startsWith('poi:'))),
        ...(wiki?.unresolved ?? []), ...(planner?.unresolved ?? []),
        ...(zekamashi?.unresolved ?? []), ...(kcwiki?.unresolved ?? []),
    ];
    // 補齊代號後能對上的未對應字串轉成該來源的前置，其餘保留為未解析
    const recovered = { wiki: [] as number[], poi: [] as number[] };
    const unresolved: string[] = [];
    for (const value of pending) {
        const no = unresolvedCodeNo(value);
        if (no !== null && value.startsWith('wiki:')) recovered.wiki.push(no);
        else if (no !== null && value.startsWith('poi:')) recovered.poi.push(no);
        else if (value !== 'wiki:unverified-condition' || !wiki) unresolved.push(value);
    }
    return {
        apiNo,
        wikiIds: wikiIds.length ? [...wikiIds] : supplement?.code ? [supplement.code] : [],
        name: textOverride?.name ?? (name || supplement?.name || ''),
        detail: textOverride?.detail ?? detail,
        category,
        // 目錄的週期有誤植（例：D27 記成 daily，但 api_type 為 4＝單發）。wiki 所在表格的週期只在
        // 目錄不明、或與 api_type 一致時採用；與 api_type 矛盾時（B135 等）保留目錄值。
        period: wiki?.period && wiki.period !== period
            && (period === 'unknown' || apiType === null || API_TYPE_PERIOD[apiType] === wiki.period)
            ? wiki.period : period,
        limited,
        limitedState: limited ? 'unknown' : (name || supplement?.name) ? 'active' : 'unknown',
        apiCategory,
        apiType,
        wikiPrerequisites: wiki
            ? unionNumbers(wiki.clauses.flat().map(edge => edge.no), recovered.wiki)
            : unionNumbers(wikiPrerequisites, recovered.wiki),
        ...(wiki ? { wikiClauses: wiki.clauses.map(clause => clause.map(edge => ({ ...edge }))) } : {}),
        ...(zekamashi ? {
            zekamashiPrerequisites: zekamashi.edges.map(edge => ({ ...edge })),
            zekamashiConditionUnknown: zekamashi.conditionUnknown,
        } : {}),
        ...(TSUKINOHASHI.has(apiNo) ? { tsukinohashiPrerequisites: [...TSUKINOHASHI.get(apiNo)!] } : {}),
        ...(kcwiki ? {
            kcwikiPrerequisites: kcwiki.edges.map(edge => ({ ...edge })),
            kcwikiConditionUnknown: kcwiki.conditionUnknown,
        } : {}),
        structuredPrerequisites: unionNumbers(planner ? planner.prerequisites : structuredPrerequisites, recovered.poi),
        unresolvedPrerequisites: unresolved,
        sources: [
            ...(wikiPresent ? ['catalog' as const] : []),
            ...(structuredPresent ? ['structured' as const] : []),
            ...(KC3_GRAPH_NOS.has(apiNo) ? ['unlock' as const] : []),
            ...(zekamashi ? ['zekamashi' as const] : []),
            ...(kcwiki ? ['kcwiki' as const] : []),
        ],
        wikiPresent,
        structuredPresent,
        wikiConditionUnknown: wiki ? wiki.conditionUnknown : (flags & 4) !== 0,
        structuredConditionUnknown: planner ? false : (flags & 8) !== 0,
    };
};

export const QUEST_CATALOG: QuestDefinition[] =
    (QUEST_CATALOG_RAW as readonly RawCatalogEntry[]).map(rawEntry);

export const QUEST_CATALOG_BY_NO = new Map<number, QuestDefinition>(
    QUEST_CATALOG.map(definition => [definition.apiNo, definition]),
);

const KC3_INCOMING = (() => {
    const incoming = new Map<number, number[]>();
    for (const [from, targets] of KC3_UNLOCKS) {
        for (const target of targets) {
            const list = incoming.get(target) ?? [];
            list.push(from);
            incoming.set(target, list);
        }
    }
    for (const [target, list] of incoming) {
        incoming.set(target, [...new Set(list)].sort((a, b) => a - b));
    }
    return incoming;
})();

const relationSources = (definition: QuestDefinition): {
    source: QuestSourceId;
    values: number[];
}[] => {
    const sources: { source: QuestSourceId; values: number[] }[] = [];
    if (definition.wikiPresent) {
        sources.push({ source: 'catalog', values: definition.wikiPrerequisites });
    }
    if (definition.structuredPresent) {
        sources.push({ source: 'structured', values: definition.structuredPrerequisites });
    }
    const unlockValues = KC3_INCOMING.get(definition.apiNo);
    // 沒有 unlock 邊不代表「沒有前置」；只有實際有反向邊時才列入比較。
    if (unlockValues?.length) sources.push({ source: 'unlock', values: unlockValues });
    if (definition.zekamashiPrerequisites) {
        sources.push({ source: 'zekamashi', values: definition.zekamashiPrerequisites.map(edge => edge.no) });
    }
    if (definition.kcwikiPrerequisites) {
        sources.push({ source: 'kcwiki', values: definition.kcwikiPrerequisites.map(edge => edge.no) });
    }
    return sources;
};

/**
 * 計票用：poi（kcQuests／quest-planner）的前置由舰娘百科抽出，兩者同源，合為一票（取聯集），
 * 避免同一份資料的兩個副本湊成「兩個來源同意」。
 */
const voteGroups = (sources: readonly { source: QuestSourceId; values: number[] }[]) => {
    const lineage = sources.filter(source => source.source === 'structured' || source.source === 'kcwiki');
    const others = sources.filter(source => source.source !== 'structured' && source.source !== 'kcwiki');
    return lineage.length
        ? [...others, { source: 'structured' as QuestSourceId, values: unionNumbers(...lineage.map(source => source.values)) }]
        : others;
};

/**
 * 真正的矛盾才算衝突：沒有任何一個來源列出全部來源前置的聯集。
 * 某來源少列或沒列只代表它沒提到，不代表它否認（KC3 的開放邊常只記其中一個觸發任務，
 * ぜかまし也可能只從後續方向提到其中一條）；只要有一個來源的說法涵蓋其他來源，就不算衝突。
 */
const sourcesContradict = (values: readonly number[][]): boolean => {
    const listed = values.filter(value => value.length > 0);
    const union = new Set(listed.flat());
    return listed.length >= 2 && !listed.some(value => new Set(value).size === union.size);
};

/** 日本時間日期（YYYY-MM-DD）當天 00:00 的時間戳。 */
const jstDayStart = (date: string): number => Date.parse(`${date}T00:00:00+09:00`);

export function questRelation(definitionOrNo: QuestDefinition | number, nowTs = Date.now()): QuestRelation {
    const definition = typeof definitionOrNo === 'number'
        ? QUEST_CATALOG_BY_NO.get(definitionOrNo)
        : definitionOrNo;
    if (!definition) {
        return {
            prerequisites: [], edges: [], remarks: [], consensus: false, reviewed: null, phases: null,
            clauses: null, unresolvedPrerequisites: [],
            confidence: 'checking', operator: 'unknown', sources: [],
        };
    }

    const sources = relationSources(definition);
    const groups = voteGroups(sources);
    const values = groups.map(source => unionNumbers(source.values));
    // wiki、ぜかまし、舰娘百科會逐條註記是否待驗證（KC3／poi 沒有這種資訊）。只要其中一方明確列出，
    // 另一方的待驗證就算已被實戰或另一來源確認；各方都只給待驗證時才維持待驗證。
    const annotated = [
        ...(definition.wikiClauses ?? []).flat(),
        ...(definition.zekamashiPrerequisites ?? []),
        ...(definition.kcwikiPrerequisites ?? []),
    ];
    const certainNos = new Set(annotated.filter(edge => !edge.pending).map(edge => edge.no));
    const pendingNos = new Set(annotated.filter(edge => edge.pending && !certainNos.has(edge.no)).map(edge => edge.no));
    // wiki 與ぜかまし都有列前置且彼此一致（一方涵蓋另一方）時，兩個逐條驗證的來源足以裁決：
    // 只有 KC3／poi 多列的前置改為「有爭議」，不再讓整體成為 conflict。
    const wikiList = sources.find(source => source.source === 'catalog' && definition.wikiClauses)?.values ?? [];
    const zekamashiList = sources.find(source => source.source === 'zekamashi')?.values ?? [];
    const verifiedUnion = new Set([...wikiList, ...zekamashiList]);
    const verifiedAgree = wikiList.length > 0 && zekamashiList.length > 0
        && (wikiList.length === verifiedUnion.size || zekamashiList.length === verifiedUnion.size);

    // 真正衝突時改用多數共識：至少兩個來源（此時 tsukinohashi 也加入投票）列出的前置為主要前置，
    // 只有單一來源提出的列為備考。沒有任何前置達到兩個來源時維持 conflict。
    // tsukinohashi 只在這裡參與，不改變原本沒有衝突的任務。
    const sourceConflict = !verifiedAgree && sourcesContradict(values);
    let voting = groups;
    let prerequisites = unionNumbers(...values);
    let remarkNos: number[] = [];
    let consensus = false;
    if (sourceConflict) {
        if (definition.tsukinohashiPrerequisites?.length) {
            voting = [...groups, { source: 'tsukinohashi', values: definition.tsukinohashiPrerequisites }];
        }
        const support = new Map<number, number>();
        for (const source of voting) {
            for (const no of new Set(source.values)) support.set(no, (support.get(no) ?? 0) + 1);
        }
        const agreed = [...support].filter(([, count]) => count >= 2).map(([no]) => no);
        if (agreed.length) {
            consensus = true;
            prerequisites = unionNumbers(agreed);
            remarkNos = unionNumbers([...support.keys()].filter(no => !agreed.includes(no)));
        }
    }
    // 人工裁決優先：來源各說各話時，由逐項核對後的結論決定主要前置與備考（依據見 quest-graph-reviewed.ts）
    const reviewed = QUEST_REVIEWED_RELATIONS[definition.apiNo] ?? null;
    // 營運中途更新觸發條件：依目前日期取對應分段；早於第一段時用第一段
    const phases = reviewed?.phases?.map(phase => ({ ...phase, prerequisites: [...phase.prerequisites], current: false })) ?? null;
    if (phases?.length) {
        const index = phases.findIndex(phase => nowTs >= jstDayStart(phase.from)
            && (phase.until === null || nowTs < jstDayStart(phase.until)));
        phases[index >= 0 ? index : nowTs < jstDayStart(phases[0].from) ? 0 : phases.length - 1].current = true;
    }
    if (reviewed) {
        prerequisites = unionNumbers(phases?.find(phase => phase.current)?.prerequisites ?? reviewed.prerequisites);
        remarkNos = unionNumbers(reviewed.remarks);
        consensus = false;
    }
    const citing = voting === groups ? sources : [...sources, ...voting.filter(source => source.source === 'tsukinohashi')];
    const toEdge = (no: number): QuestPrerequisiteEdge => {
        // 顯示時列出每個引用來源（含舰娘百科與 poi 各自），計數時同源只算一票
        const edgeSources = citing.filter(source => source.values.includes(no)).map(source => source.source);
        const votes = voting.filter(source => source.values.includes(no)).length;
        const disputed = verifiedAgree && !verifiedUnion.has(no);
        const pending = pendingNos.has(no) || disputed;
        return {
            no,
            sources: edgeSources,
            pending,
            disputed,
            evidence: pending ? 'checking' : votes >= 2 ? 'confirmed' : 'single-source',
        };
    };
    const edges = prerequisites.map(toEdge);
    const remarks = remarkNos.map(toEdge);
    // 組合以 wiki 句型為骨架（有「または」）；ぜかまし多列的前置視為另外的 AND 子句。
    // 只有這兩者涵蓋所有來源列出的前置時才能決定組合；KC3／poi 多列的前置不知道是 AND 還是 OR。
    const wikiClauses = definition.wikiClauses?.map(clause => unionNumbers(clause.map(edge => edge.no))) ?? [];
    const wikiNos = new Set(wikiClauses.flat());
    const zekamashiExtra = unionNumbers((definition.zekamashiPrerequisites ?? [])
        .map(edge => edge.no).filter(no => !wikiNos.has(no)));
    const prerequisiteSet = new Set(prerequisites);
    const structured = [...wikiClauses, ...zekamashiExtra.map(no => [no])]
        .map(clause => clause.filter(no => prerequisiteSet.has(no)))
        .filter(clause => clause.length > 0);
    const structuredNos = new Set(structured.flat());
    const clauses = reviewed
        ? prerequisites.map(no => [no])
        : (definition.wikiClauses || definition.zekamashiPrerequisites)
            && prerequisites.every(no => structuredNos.has(no))
            ? structured
            : null;

    const conflict = sourceConflict && !consensus && !reviewed;
    // 「另有未列出的前置」：另一個沒有這種註記的來源若補上了這一方沒列的前置，就視為缺口已補。
    const wikiGapFilled = definition.wikiConditionUnknown && !definition.zekamashiConditionUnknown
        && zekamashiExtra.length > 0;
    const zekamashiGapFilled = definition.zekamashiConditionUnknown && !definition.wikiConditionUnknown
        && [...wikiNos].some(no => !(definition.zekamashiPrerequisites ?? []).some(edge => edge.no === no));
    // 舰娘百科註記「可能还需达成其他条件」：其他來源列了它沒列的前置才算已補
    const kcwikiNos = new Set((definition.kcwikiPrerequisites ?? []).map(edge => edge.no));
    const kcwikiGapFilled = !!definition.kcwikiConditionUnknown
        && prerequisites.some(no => !kcwikiNos.has(no));
    // 人工裁決已逐項核對，各來源「另有未列出的前置」註記視為已處理
    // 人工裁決已逐項核對；「前置未定」「可能還有未確認條件」的裁決仍維持條件不可考
    const conditionUnknown = reviewed ? !!(reviewed.undetermined || reviewed.incomplete) : (
        (definition.wikiConditionUnknown && !wikiGapFilled)
        || (!!definition.zekamashiConditionUnknown && !zekamashiGapFilled)
        || (!!definition.kcwikiConditionUnknown && !kcwikiGapFilled)
        || definition.structuredConditionUnknown
        || definition.unresolvedPrerequisites.length > 0);
    const confidence: QuestEvidence = conflict
        ? 'conflict'
        : conditionUnknown || edges.some(edge => edge.pending) || sources.length === 0
            || reviewed?.undetermined
            ? 'checking'
            : prerequisites.length === 0
                ? sources.length >= 2 ? 'confirmed' : 'single-source'
                : edges.every(edge => edge.evidence === 'confirmed') ? 'confirmed' : 'single-source';
    const operator: QuestRelationOperator = conflict
        ? 'conflict'
        : conditionUnknown
            ? 'unknown'
            : prerequisites.length === 0
                ? sources.length ? 'none' : 'unknown'
                : clauses
                    ? clauses.every(clause => clause.length === 1)
                        ? 'all'
                        : clauses.length === 1 ? 'any' : 'unknown'
                    : prerequisites.length === 1 ? 'all' : 'unknown';
    return {
        prerequisites,
        edges,
        remarks,
        consensus,
        reviewed: reviewed?.reviewed ?? null,
        phases,
        clauses,
        unresolvedPrerequisites: [...definition.unresolvedPrerequisites],
        confidence,
        operator,
        sources: [...new Set(citing.map(source => source.source))],
    };
}

export function questPostrequisites(no: number): number[] {
    const result = new Set<number>();
    for (const definition of QUEST_CATALOG) {
        if (questRelation(definition).prerequisites.includes(no)) result.add(definition.apiNo);
    }
    return [...result].sort((a, b) => a - b);
}

function dynamicDefinition(no: number): QuestDefinition {
    return {
        apiNo: no, wikiIds: [], name: '', detail: '', category: 'unknown', period: 'unknown',
        limited: false, limitedState: 'unknown', apiCategory: null, apiType: null,
        wikiPrerequisites: [], structuredPrerequisites: [], unresolvedPrerequisites: [], sources: [],
        wikiPresent: false, structuredPresent: false,
        wikiConditionUnknown: false, structuredConditionUnknown: false,
    };
}

function completionStatus(status: QuestStatus): boolean {
    return status === 'observed-complete'
        || status === 'inferred-complete'
        || status === 'manual-complete';
}

/**
 * 玩家看得到某任務時，它的單發前置必定已完成（否則任務不會出現）。能據以推論的只限確實是前置的邊：
 * 不在「任一即可」子句裡、不是待驗證或有爭議、且不是只有 KC3／poi 單一來源的說法。
 * 備考不在 edges 裡，不參與推論。
 */
function inferablePrerequisites(relation: QuestRelation): number[] {
    if (relation.operator === 'conflict' || relation.operator === 'any' || relation.operator === 'none') return [];
    const alternatives = new Set((relation.clauses ?? []).filter(clause => clause.length > 1).flat());
    return relation.edges
        .filter(edge => !edge.pending && !alternatives.has(edge.no))
        .filter(edge => edge.sources.length >= 2
            || edge.sources.includes('catalog') || edge.sources.includes('zekamashi')
            || edge.sources.includes('kcwiki'))
        .map(edge => edge.no);
}

function onceQuestWouldAppearIfIncomplete(
    definition: QuestDefinition,
    relation: QuestRelation,
    completed: ReadonlySet<number>,
): boolean {
    if (definition.period !== 'once' || definition.limited) return false;
    if (definition.wikiConditionUnknown || definition.structuredConditionUnknown) return false;
    if (definition.unresolvedPrerequisites.length > 0) return false;
    // 待驗證的前置可能不是真正的前置，真正的條件就可能沒列出來，缺席不足以推論完成。
    if (relation.edges.some(edge => edge.pending)) return false;
    // 備考可能才是真正的前置，主要前置都完成也不能斷定任務會出現。
    if (relation.remarks.length > 0) return false;
    if (relation.operator === 'same-period' || relation.operator === 'none') {
        return relation.operator === 'none';
    }
    if (relation.prerequisites.length === 0) return false;
    if (relation.clauses && relation.operator !== 'conflict') {
        return relation.clauses.every(clause => clause.some(no => completed.has(no)));
    }
    // 組合不明／conflict：只有列出的前置全部完成時，不論 AND／OR 都會開這項任務。
    return relation.prerequisites.every(no => completed.has(no));
}

function inferPrerequisiteChain(
    startNos: Iterable<number>,
    definitions: ReadonlyMap<number, QuestDefinition>,
    relationByNo: ReadonlyMap<number, QuestRelation>,
    inferred: Set<number>,
): void {
    const stack = [...startNos];
    const seen = new Set<number>();
    while (stack.length) {
        const no = stack.pop();
        if (no == null || seen.has(no)) continue;
        seen.add(no);
        const relation = relationByNo.get(no);
        if (!relation) continue;
        for (const prerequisite of inferablePrerequisites(relation)) {
            // 定期任務只證明「曾經完成」，不代表目前週期已完成（維持未完成、持續觀測）；
            // 仍沿它往上找單發前置。
            if (definitions.get(prerequisite)?.period === 'once') inferred.add(prerequisite);
            stack.push(prerequisite);
        }
    }
}

function inferAbsentOnceQuests(
    definitions: ReadonlyMap<number, QuestDefinition>,
    relationByNo: ReadonlyMap<number, QuestRelation>,
    listed: ReadonlySet<number>,
    completed: Set<number>,
    inferred: Set<number>,
): void {
    let changed = true;
    while (changed) {
        changed = false;
        for (const definition of definitions.values()) {
            if (listed.has(definition.apiNo) || completed.has(definition.apiNo)) continue;
            const relation = relationByNo.get(definition.apiNo);
            if (!relation) continue;
            if (!onceQuestWouldAppearIfIncomplete(definition, relation, completed)) continue;
            inferred.add(definition.apiNo);
            completed.add(definition.apiNo);
            changed = true;
        }
    }
}

// 日／週／月以日本時間 05:00 為日界：UTC+9 再扣 5 小時，等於時間戳加 4 小時後取 UTC 日曆。
// 季任不是西曆季，重置日是 3／6／9／12 月 1 日 05:00（12–2 月、3–5 月、6–8 月、9–11 月）。
// 年任開始月尚未進目錄，不在這裡對齊。
function currentCycleKey(period: QuestPeriod, ts: number): string | null {
    if (!Number.isFinite(ts) || !['daily', 'weekly', 'monthly', 'quarterly'].includes(period)) return null;
    const resetDate = new Date(ts + (4 * 60 * 60 * 1000));
    const year = resetDate.getUTCFullYear();
    const month = resetDate.getUTCMonth();
    const day = resetDate.getUTCDate();
    const pad = (value: number) => String(value).padStart(2, '0');
    if (period === 'daily') return `D:${year}-${pad(month + 1)}-${pad(day)}`;
    if (period === 'monthly') return `M:${year}-${pad(month + 1)}`;
    if (period === 'quarterly') {
        if (month < 2) return `Q:${year - 1}-12`;
        const startMonth = month < 5 ? 3 : month < 8 ? 6 : month < 11 ? 9 : 12;
        return `Q:${year}-${pad(startMonth)}`;
    }
    const mondayOffset = (resetDate.getUTCDay() + 6) % 7;
    resetDate.setUTCDate(day - mondayOffset);
    return `W:${resetDate.getUTCFullYear()}-${pad(resetDate.getUTCMonth() + 1)}-${pad(resetDate.getUTCDate())}`;
}

function observedIsCurrentPeriod(definition: QuestDefinition, observed: QuestObservedCompletion, nowTs: number): boolean {
    if (definition.period === 'once') return true;
    const observedCycle = currentCycleKey(definition.period, observed.lastTs);
    const currentCycle = currentCycleKey(definition.period, nowTs);
    return observedCycle !== null && observedCycle === currentCycle;
}

export function buildQuestFlow(
    state: GameState,
    manualComplete: ReadonlySet<number> = new Set(),
    nowTs = Date.now(),
): QuestFlowModel {
    const current = new Map(state.quests_().map(quest => [quest.no, quest]));
    const available = new Map(state.availableQuests_().map(quest => [quest.no, quest]));
    const observed = state.questObservedCompletions_();
    const definitions = new Map(QUEST_CATALOG.map(definition => [definition.apiNo, definition]));
    for (const quest of [...current.values(), ...available.values()]) {
        if (!definitions.has(quest.no)) definitions.set(quest.no, dynamicDefinition(quest.no));
    }
    for (const no of observed.keys()) {
        if (!definitions.has(no)) definitions.set(no, dynamicDefinition(no));
    }
    for (const no of manualComplete) {
        if (!definitions.has(no)) definitions.set(no, dynamicDefinition(no));
    }

    const relationByNo = new Map<number, QuestRelation>();
    const postByNo = new Map<number, Set<number>>();
    for (const definition of [...definitions.values()]) {
        const relation = questRelation(definition, nowTs);
        relationByNo.set(definition.apiNo, relation);
        for (const prerequisite of relation.prerequisites) {
            if (!definitions.has(prerequisite)) definitions.set(prerequisite, dynamicDefinition(prerequisite));
            const posts = postByNo.get(prerequisite) ?? new Set<number>();
            posts.add(definition.apiNo);
            postByNo.set(prerequisite, posts);
        }
    }
    for (const definition of definitions.values()) {
        if (!relationByNo.has(definition.apiNo)) relationByNo.set(definition.apiNo, questRelation(definition, nowTs));
    }

    // 關聯推論完成只來自任務關係，不取代領獎／本機觀測標示。
    // 1. 目前清單、完整「全部／單發」tab，或曾在清單出現過的常設任務，沿前置鏈往回標。
    // 2. 有完整單發清單時，缺席且「若未完成就應出現」的單發任務再做固定點繼流。
    // 期間限定、未解析條件、以及 all/any 無法判定且前置未全部完成的任務維持不可考。
    const listedNos = new Set<number>([
        ...current.keys(),
        ...available.keys(),
        ...(state.questOnceCatalogNos_() ?? []),
    ]);
    // 曾出現在清單的任務（db.questSeen）同樣證明單發前置已完成，重裝還原後不必重開清單。
    // 期間限定任務可能沿用 api_no 換成不同前置（例：年末任務），舊觀測不當推論起點。
    const seenSeeds = [...state.questSeenNos_()].filter(no => {
        const definition = definitions.get(no);
        return definition !== undefined && !definition.limited;
    });
    const inferred = new Set<number>();
    inferPrerequisiteChain([...listedNos, ...seenSeeds], definitions, relationByNo, inferred);

    const observedCurrent = new Set<number>();
    for (const [no, observedCompletion] of observed) {
        const definition = definitions.get(no);
        if (definition && observedIsCurrentPeriod(definition, observedCompletion, nowTs)) {
            observedCurrent.add(no);
        }
    }

    const completed = new Set<number>();
    for (const no of inferred) {
        if (!listedNos.has(no)) completed.add(no);
    }
    for (const no of manualComplete) completed.add(no);
    for (const no of observedCurrent) completed.add(no);
    if (state.questOnceCatalogNos_() !== null) {
        inferAbsentOnceQuests(definitions, relationByNo, listedNos, completed, inferred);
    }

    const rows: QuestFlowRow[] = [];
    for (const definition of [...definitions.values()].sort((a, b) => a.apiNo - b.apiNo)) {
        const quest = current.get(definition.apiNo) ?? null;
        const availableQuest = available.get(definition.apiNo) ?? null;
        const observedQuest = observed.get(definition.apiNo) ?? null;
        const observedCurrentPeriod = observedQuest
            ? observedCurrent.has(definition.apiNo) : false;
        const relation = relationByNo.get(definition.apiNo) ?? questRelation(definition, nowTs);
        const blockers = relation.prerequisites.filter(no => !completed.has(no));
        const knownAll = relation.operator === 'all'
            && relation.confidence !== 'checking' && relation.confidence !== 'conflict';

        let status: QuestStatus;
        if (quest?.done) status = 'ready-to-claim';
        else if (quest) status = 'in-progress';
        else if (availableQuest) status = 'available';
        else if (observedQuest) status = 'observed-complete';
        else if (manualComplete.has(definition.apiNo)) status = 'manual-complete';
        else if (inferred.has(definition.apiNo) && !listedNos.has(definition.apiNo)) status = 'inferred-complete';
        else if (knownAll && blockers.length > 0) status = 'locked';
        else status = 'unknown';

        rows.push({
            definition,
            name: quest?.name || availableQuest?.name || definition.name,
            detail: quest?.detail || availableQuest?.detail || definition.detail,
            status,
            current: quest,
            available: availableQuest,
            observed: observedQuest,
            observedCurrentPeriod,
            progress: quest?.progress ?? null,
            tracking: quest ? state.questTrackingDetail(definition.apiNo) : null,
            relation,
            prerequisiteNos: [...relation.prerequisites],
            remarkNos: relation.remarks.map(edge => edge.no),
            periodicBlockerNos: blockers.filter(no => {
                const period = definitions.get(no)?.period;
                return period !== undefined && period !== 'once' && period !== 'unknown';
            }),
            postrequisiteNos: [...(postByNo.get(definition.apiNo) ?? [])].sort((a, b) => a - b),
            blockers,
            nearUnlock: knownAll && blockers.length > 0 && blockers.length <= 2,
        });
    }

    const byNo = new Map(rows.map(row => [row.definition.apiNo, row]));
    return {
        rows,
        byNo,
        currentNos: new Set(current.keys()),
        availableNos: new Set(available.keys()),
    };
}

export function isCompletedQuestRow(row: QuestFlowRow): boolean {
    if (row.status === 'observed-complete') return row.observedCurrentPeriod;
    return completionStatus(row.status);
}

/**
 * 任務的前置條件，拆成 AND-of-OR 群組：群組之間全部需要，群組內任一完成即可。
 * wiki 句型的子句恰好涵蓋全部主要前置時才沿用；operator=any 為單一群組；其餘每條前置各自一組。
 */
export function questRequirementGroups(row: QuestFlowRow): number[][] {
    const prerequisites = row.prerequisiteNos;
    if (!prerequisites.length) return [];
    if (row.relation.operator === 'any') return [[...prerequisites]];
    const clauses = row.relation.clauses;
    if (clauses?.length) {
        const members = clauses.flat();
        const listed = new Set(prerequisites);
        if (members.every(no => listed.has(no)) && new Set(members).size === listed.size) {
            return clauses.map(clause => [...clause]);
        }
    }
    return prerequisites.map(no => [no]);
}

export interface QuestUnlockPlan {
    target: number;
    /** 目標的全部上游（不重複、不含目標），依拓撲序排列，根在前。 */
    ancestors: number[];
    /** 上游中已完成的任務（isCompletedQuestRow）。 */
    done: Set<number>;
    /**
     * 解鎖目標仍需完成的上游，依拓撲序。已被同群組其他選項滿足的替代前置、以及已開放任務
     * 的前置都不列入。
     */
    needed: number[];
    /**
     * 目前出現在任務清單（可接受／進行中／達成待領取）的目標與上游。任務看得到＝它的前置此刻
     * 已滿足，所以不再展開它的前置；定期前置本週期沒有完成紀錄也不必為它重做。
     */
    unlocked: Set<number>;
    /** 上游中既未完成、也不再需要的任務（被已開放的後續或同群組的其他選項涵蓋）。 */
    covered: Set<number>;
    /**
     * needed 與目標所在的步數：1＝前置都已完成、現在就能做；其餘為「上一步完成後才開放」的最短步數。
     * 任一群組取最短的選項。
     */
    step: Map<number, number>;
    /** 目標與上游中前置組合不可考、有衝突或有未解析條件的任務。 */
    incomplete: Set<number>;
}

/** 目標任務的解鎖路線：攤平整個上游 DAG，標出已完成、仍需完成與各自的步數。 */
export function questUnlockPlan(model: QuestFlowModel, target: number): QuestUnlockPlan | null {
    if (!model.byNo.has(target)) return null;
    const order: number[] = [];
    const visited = new Set<number>();
    const visiting = new Set<number>();
    const visit = (no: number) => {
        if (visited.has(no) || visiting.has(no)) return;
        visiting.add(no);
        for (const prerequisite of model.byNo.get(no)?.prerequisiteNos ?? []) visit(prerequisite);
        visiting.delete(no);
        visited.add(no);
        order.push(no);
    };
    visit(target);
    const ancestors = order.filter(no => no !== target);

    const done = new Set<number>();
    for (const no of ancestors) {
        const row = model.byNo.get(no);
        if (row && isCompletedQuestRow(row)) done.add(no);
    }
    const groups = (no: number): number[][] => {
        const row = model.byNo.get(no);
        return row ? questRequirementGroups(row) : [];
    };
    const unlocked = new Set([...ancestors, target].filter(no => {
        const status = model.byNo.get(no)?.status;
        return status === 'available' || status === 'in-progress' || status === 'ready-to-claim';
    }));
    const unmet = (no: number) => unlocked.has(no)
        ? []
        : groups(no).filter(group => !group.some(member => done.has(member)));

    const neededSet = new Set<number>();
    const stack = [target];
    while (stack.length) {
        const no = stack.pop()!;
        for (const group of unmet(no)) {
            for (const member of group) {
                if (neededSet.has(member) || member === target) continue;
                neededSet.add(member);
                stack.push(member);
            }
        }
    }
    const needed = ancestors.filter(no => neededSet.has(no));

    // 拓撲序保證前置先算；循環中尚未算到的前置以 0 計，不會無限遞迴。
    const step = new Map<number, number>();
    for (const no of [...needed, target]) {
        let value = 1;
        for (const group of unmet(no)) {
            value = Math.max(value, Math.min(...group.map(member => (step.get(member) ?? 0) + 1)));
        }
        step.set(no, value);
    }

    const incomplete = new Set<number>();
    for (const no of [...ancestors, target]) {
        const relation = model.byNo.get(no)?.relation;
        if (relation && (relation.operator === 'unknown' || relation.operator === 'conflict'
            || relation.unresolvedPrerequisites.length > 0)) incomplete.add(no);
    }
    const covered = new Set(ancestors.filter(no => !done.has(no) && !neededSet.has(no)));
    for (const no of unlocked) if (no !== target && !neededSet.has(no)) unlocked.delete(no);
    return { target, ancestors, done, needed, unlocked, covered, step, incomplete };
}

/** 完成某任務後依序開放的全部下游，依距離分層（第 0 層＝直接開放）；不重複列出同一任務。 */
export function questDownstreamLayers(model: QuestFlowModel, no: number): number[][] {
    const layers: number[][] = [];
    const seen = new Set<number>([no]);
    let frontier = [no];
    while (frontier.length) {
        const next: number[] = [];
        for (const from of frontier) {
            for (const post of model.byNo.get(from)?.postrequisiteNos ?? []) {
                if (seen.has(post)) continue;
                seen.add(post);
                next.push(post);
            }
        }
        if (next.length) layers.push(next.sort((a, b) => a - b));
        frontier = next;
    }
    return layers;
}

/** 搜尋用：全形標點與空白不應擋住任務名稱對得上。 */
export function normalizeQuestSearch(value: string): string {
    return value.normalize('NFKC').replace(/[、，]/g, ',').replace(/\s+/g, '').toLocaleLowerCase();
}

export function questSearchHaystack(row: {
    name: string;
    detail: string;
    definition: Pick<QuestDefinition, 'apiNo' | 'wikiIds'>;
}): string {
    return normalizeQuestSearch(
        `${row.name} ${row.detail} ${row.definition.apiNo} ${row.definition.wikiIds.join(' ')}`,
    );
}
