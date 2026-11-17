// 遞移匯入的靜態追蹤（排除 `import type`），用來斷言某個入口不會把大表帶進去。
// 不依賴 build 產物：`npm test` 不必先 build，也不受 .output 當下狀態影響。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const PROJECT_ROOT = resolve(__dirname, '../..');

// 跨行的 import 一樣要抓到（`import {\n …\n} from \'./x\'`），否則「不得匯入某模組」的斷言會
// 因為漏看而假通過。副作用匯入（`import \'./x\'`）另抓一條規則：併成一條正則時，帶 from 的那
// 半邊會跨行把它吞掉。`import type` 整句跳過；`from` 前不允許分號，避免一次吃掉兩個敘述。
function runtimeImports(file: string): string[] {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const specs: string[] = [];
    for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
    for (const m of src.matchAll(/\b(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
        if (!m[1]) specs.push(m[2]);
    }
    const out: string[] = [];
    for (const spec of specs) {
        const base = spec.startsWith('@/') ? resolve(PROJECT_ROOT, spec.slice(2))
            : spec.startsWith('.') ? resolve(dirname(file), spec) : null;
        if (!base) continue;
        const hit = [`${base}.ts`, resolve(base, 'index.ts'), base].find(p => p.endsWith('.ts') && existsSync(p));
        if (hit) out.push(hit);
    }
    return out;
}

/** entry 及其所有遞移匯入，回傳專案相對路徑。 */
export function importClosure(entry: string): string[] {
    const seen = new Set<string>();
    const todo = [resolve(PROJECT_ROOT, entry)];
    while (todo.length) {
        const f = todo.pop()!;
        if (seen.has(f)) continue;
        seen.add(f);
        todo.push(...runtimeImports(f));
    }
    return [...seen].map(f => f.slice(PROJECT_ROOT.length + 1));
}
