// 任務關係圖的分層排版（純函式）：前置在上、被開放的任務在下。
// 層＝節點集合內的最長前置路徑；層內順序以前後層的重心上下交替排序幾輪，減少連線交叉。

export interface QuestGraphNode {
    no: number;
    layer: number;
    x: number;
    y: number;
}

export interface QuestGraphEdge {
    from: number;
    to: number;
    /** SVG path：從前置底邊中點接到任務頂邊中點的三次曲線。 */
    d: string;
}

export interface QuestGraphLayout {
    width: number;
    height: number;
    nodeWidth: number;
    nodeHeight: number;
    nodes: QuestGraphNode[];
    edges: QuestGraphEdge[];
}

export interface QuestGraphSize {
    nodeWidth: number;
    nodeHeight: number;
    gapX: number;
    gapY: number;
}

const DEFAULT_SIZE: QuestGraphSize = { nodeWidth: 132, nodeHeight: 52, gapX: 12, gapY: 28 };
const SWEEPS = 4;

/**
 * @param nos 要畫的任務，須依拓撲序（前置在前）；序列外的前置不畫。
 * @param prerequisitesOf 每個任務的直接前置。
 */
export function layoutQuestGraph(
    nos: readonly number[],
    prerequisitesOf: (no: number) => readonly number[],
    size: QuestGraphSize = DEFAULT_SIZE,
): QuestGraphLayout {
    const included = new Set(nos);
    const parents = new Map<number, number[]>();
    const children = new Map<number, number[]>();
    for (const no of nos) {
        const list = [...new Set(prerequisitesOf(no))].filter(from => included.has(from) && from !== no);
        parents.set(no, list);
        for (const from of list) children.set(from, [...(children.get(from) ?? []), no]);
    }

    // 拓撲序下，前置的層已先算好；循環裡尚未算到的前置略過。
    const layerOf = new Map<number, number>();
    for (const no of nos) {
        let layer = 0;
        for (const from of parents.get(no)!) {
            const parentLayer = layerOf.get(from);
            if (parentLayer !== undefined) layer = Math.max(layer, parentLayer + 1);
        }
        layerOf.set(no, layer);
    }
    const layers: number[][] = [];
    for (const no of nos) (layers[layerOf.get(no)!] ??= []).push(no);

    const position = new Map<number, number>();
    const renumber = (layer: number[]) => layer.forEach((no, index) => position.set(no, index));
    layers.forEach(renumber);
    const barycenter = (no: number, neighbours: number[]): number => neighbours.length
        ? neighbours.reduce((sum, other) => sum + position.get(other)!, 0) / neighbours.length
        : position.get(no)!;
    const sortBy = (layer: number[], neighboursOf: (no: number) => number[]) => {
        const keys = new Map(layer.map(no => [no, barycenter(no, neighboursOf(no))]));
        layer.sort((a, b) => keys.get(a)! - keys.get(b)! || position.get(a)! - position.get(b)!);
        renumber(layer);
    };
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
        for (let index = 1; index < layers.length; index++) sortBy(layers[index], no => parents.get(no)!);
        for (let index = layers.length - 2; index >= 0; index--) sortBy(layers[index], no => children.get(no) ?? []);
    }

    const { nodeWidth, nodeHeight, gapX, gapY } = size;
    const widest = Math.max(1, ...layers.map(layer => layer.length));
    const width = widest * (nodeWidth + gapX) + gapX;
    const height = layers.length * (nodeHeight + gapY) + gapY;
    const nodes: QuestGraphNode[] = [];
    const at = new Map<number, QuestGraphNode>();
    layers.forEach((layer, layerIndex) => {
        const offset = (width - layer.length * (nodeWidth + gapX) + gapX) / 2;
        layer.forEach((no, index) => {
            const node = {
                no, layer: layerIndex,
                x: Math.round(offset + index * (nodeWidth + gapX)),
                y: gapY / 2 + layerIndex * (nodeHeight + gapY),
            };
            nodes.push(node);
            at.set(no, node);
        });
    });

    const edges: QuestGraphEdge[] = [];
    for (const no of nos) {
        const to = at.get(no)!;
        for (const fromNo of parents.get(no)!) {
            const from = at.get(fromNo)!;
            if (from.layer >= to.layer) continue;
            const ax = from.x + nodeWidth / 2;
            const ay = from.y + nodeHeight;
            const bx = to.x + nodeWidth / 2;
            const by = to.y;
            const bend = gapY * 0.8;
            edges.push({ from: fromNo, to: no, d: `M${ax},${ay} C${ax},${ay + bend} ${bx},${by - bend} ${bx},${by}` });
        }
    }
    return { width, height, nodeWidth, nodeHeight, nodes, edges };
}
