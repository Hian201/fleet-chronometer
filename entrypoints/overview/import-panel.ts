// 出擊／打撈／建造分區共用的「匯入」面板：toggle＋file＋textarea＋go＋status。
// 解析／去重／落地仍留在 utils/*-import.ts；本模組只做 UI wiring 與 markup。
import { esc } from './lib';

export type ImportStatusKind = 'ok' | 'dup' | 'bad' | '';

export interface ImportPanelCopy {
    hint: string;
    go: string;
    paste: string;
    note: string;
}

/** 工具列上的「匯入」切換鈕（class 前綴維持各分區既有 CSS 選擇器）。 */
export function importToggleHtml(prefix: string, label: string): string {
    return `<button type="button" class="ov-btn ${prefix}-import-toggle" aria-expanded="false">${esc(label)}</button>`;
}

/**
 * 匯入面板本體（預設 hidden）。
 * `dimClass` 省略時用 `${prefix}-dim`（sortie／drop／build 皆然）。
 */
export function importPanelHtml(
    prefix: string,
    accept: string,
    copy: ImportPanelCopy,
    dimClass = `${prefix}-dim`,
): string {
    return `<div class="${prefix}-import" hidden>
                <p class="${dimClass}">${esc(copy.hint)}</p>
                <div class="${prefix}-import-row">
                    <input type="file" class="${prefix}-import-file" accept="${esc(accept)}">
                    <button type="button" class="ov-btn ${prefix}-import-go">${esc(copy.go)}</button>
                    <span class="${prefix}-import-status" role="status"></span>
                </div>
                <textarea class="ov-textarea small ${prefix}-import-text" placeholder="${esc(copy.paste)}"></textarea>
                <p class="${dimClass}">${esc(copy.note)}</p>
            </div>`;
}

export interface BoundImportPanel {
    setStatus(kind: ImportStatusKind, message: string): void;
    clearInputs(): void;
}

/**
 * 綁定已畫進 DOM 的匯入面板。連續選檔以 generation 計數防舊結果覆寫；
 * `onImport` 收到的是 trim 後文字（空字串可能），狀態顯示由呼叫端決定。
 */
export function bindImportPanel(
    root: ParentNode,
    prefix: string,
    options: {
        onFileLoaded?: (fileName: string, setStatus: BoundImportPanel['setStatus']) => void;
        onImport: (text: string, setStatus: BoundImportPanel['setStatus']) => void | Promise<void>;
    },
): BoundImportPanel {
    const importToggle = root.querySelector<HTMLButtonElement>(`.${prefix}-import-toggle`)!;
    const importPanel = root.querySelector<HTMLDivElement>(`.${prefix}-import`)!;
    const importFile = root.querySelector<HTMLInputElement>(`.${prefix}-import-file`)!;
    const importText = root.querySelector<HTMLTextAreaElement>(`.${prefix}-import-text`)!;
    const importGo = root.querySelector<HTMLButtonElement>(`.${prefix}-import-go`)!;
    const importStatus = root.querySelector<HTMLSpanElement>(`.${prefix}-import-status`)!;

    const setStatus = (kind: ImportStatusKind, message: string) => {
        importStatus.className = `${prefix}-import-status${kind ? ' ' + kind : ''}`;
        importStatus.textContent = message;
    };

    importToggle.addEventListener('click', () => {
        const show = importPanel.hidden;
        importPanel.hidden = !show;
        importToggle.setAttribute('aria-expanded', String(show));
    });

    // 連續選 A→B 時，較慢的 file.text() 不得覆寫較新選擇的內容。
    let importFileGen = 0;
    importFile.addEventListener('change', async () => {
        const gen = ++importFileGen;
        const file = importFile.files?.[0];
        if (!file) return;
        const text = await file.text();
        if (gen !== importFileGen) return;
        importText.value = text;
        options.onFileLoaded?.(file.name, setStatus);
    });

    importGo.addEventListener('click', () => {
        void options.onImport(importText.value.trim(), setStatus);
    });

    return {
        setStatus,
        clearInputs() {
            importText.value = '';
            importFile.value = '';
        },
    };
}
