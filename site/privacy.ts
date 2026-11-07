// 隱私權政策頁：建置時把 PRIVACY.md 轉成 /privacy/，商店與介紹頁都連到這裡，
// 不依賴任何程式碼託管平台。只支援 PRIVACY.md 用到的 Markdown 子集
// （標題、段落、清單含縮排續行、表格、分隔線、粗體、行內程式碼、連結），
// 遇到不支援的語法時建置失敗，避免政策內容被默默吃掉。
import { readFileSync } from 'node:fs';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const CJK = /[぀-ヿ㐀-鿿豈-﫿＀-￯]/u;

function inline(s: string): string {
    const codes: string[] = [];
    let out = esc(s).replace(/`([^`]+)`/g, (_, code: string) => `\u0000${codes.push(code) - 1}\u0000`);
    out = out
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

// 硬換行的續行合併成一行；中日文之間不補空格。
function joinLines(lines: string[]): string {
    return lines.map(l => l.trim()).reduce((acc, line) =>
        !acc ? line : CJK.test(acc.slice(-1)) && CJK.test(line[0] ?? '') ? acc + line : `${acc} ${line}`, '');
}

export function markdownToHtml(md: string): string {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const html: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
            const level = heading[1].length;
            html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            i++;
        } else if (/^---+\s*$/.test(line)) {
            html.push('<hr>');
            i++;
        } else if (line.startsWith('|')) {
            const rows: string[][] = [];
            for (; i < lines.length && lines[i].startsWith('|'); i++) {
                rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
            }
            if (rows.length < 2 || !rows[1].every(cell => /^:?-+:?$/.test(cell))) throw new Error('PRIVACY.md 表格缺少分隔列');
            const [head, , ...body] = rows;
            html.push('<div class="doc-table"><table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('')
                + '</tr></thead><tbody>' + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
                + '</tbody></table></div>');
        } else if (/^[-*]\s+/.test(line)) {
            const items: string[][] = [];
            for (; i < lines.length; i++) {
                const item = /^[-*]\s+(.*)$/.exec(lines[i]);
                if (item) items.push([item[1]]);
                else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1].push(lines[i]);
                else break;
            }
            html.push('<ul>' + items.map(it => `<li>${inline(joinLines(it))}</li>`).join('') + '</ul>');
        } else if (/^(\d+\.|>|```)/.test(line)) {
            throw new Error(`PRIVACY.md 用了頁面轉換不支援的語法：${line}`);
        } else {
            const para: string[] = [];
            for (; i < lines.length && lines[i].trim() && !/^(#|\||[-*]\s|---)/.test(lines[i]); i++) para.push(lines[i]);
            html.push(`<p>${inline(joinLines(para))}</p>`);
        }
    }
    return html.join('\n');
}

export function renderPrivacyPage(markdownPath: string, origin: string): string {
    const body = markdownToHtml(readFileSync(markdownPath, 'utf8'));
    const title = /^#\s+(.*)$/m.exec(readFileSync(markdownPath, 'utf8'))?.[1] ?? 'Privacy Policy';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="Privacy policy for the Fleet Chronometer browser extension.">
  <link rel="canonical" href="${origin}/privacy/">
  <link rel="icon" href="/icon/32.png" sizes="32x32">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="top">
    <div class="wrap top-row">
      <a class="brand" href="/"><img src="/icon/48.png" alt="" width="28" height="28"><span>Fleet Chronometer</span></a>
    </div>
  </header>
  <main class="doc">
    <article class="wrap doc-body">
${body}
    </article>
  </main>
</body>
</html>
`;
}
