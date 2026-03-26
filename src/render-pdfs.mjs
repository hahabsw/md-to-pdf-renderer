import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MarkdownIt from 'markdown-it';
import markdownItFootnote from 'markdown-it-footnote';
import markdownItTaskLists from 'markdown-it-task-lists';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let fatalErrorReported = false;

process.on('uncaughtException', handleFatalError);
process.on('unhandledRejection', handleFatalError);

const args = parseArgs(process.argv.slice(2));

if (args.help) {
    printHelp();
    process.exit(0);
}

const inputDir = path.resolve(process.cwd(), args.input ?? '.');
const pdfDir = path.resolve(process.cwd(), args.output ?? 'output');
const htmlDir = path.resolve(process.cwd(), args.html ?? path.join(pdfDir, 'html'));
const renderLogPath = path.join(pdfDir, 'render.log');
const logToFile = Boolean(args.logFile);
const paperOrientation = resolvePaperOrientation(args.orientation);
const paperLayout = resolvePaperLayout(args.paperSize, paperOrientation);
const katexCssPath = require.resolve('katex/dist/katex.min.css');
const katexCss = await loadKatexCss();
const katex = require('katex');
const mermaidVersion = require('mermaid/package.json').version;
const mermaidModuleUrl = `https://cdn.jsdelivr.net/npm/mermaid@${mermaidVersion}/dist/mermaid.esm.min.mjs`;

const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
});

md.use(markdownItFootnote);
md.use(katexPlugin, {
    throwOnError: false,
});
md.use(markdownItTaskLists, {
    enabled: true,
    label: true,
    labelAfter: true,
});
md.use(calloutPlugin);
md.use(tableOfContentsPlugin);

md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const info = (token.info || '').trim();
    const content = token.content.trimEnd();

    if (info === 'mermaid') {
        const caption = detectDiagramCaption(content);
        return `
            <figure class="diagram-card">
                <figcaption>${md.utils.escapeHtml(caption)}</figcaption>
                <div class="mermaid">${md.utils.escapeHtml(content)}</div>
            </figure>
        `;
    }

    if (info === 'text') {
        return `
            <div class="code-card text-card">
                <div class="code-label">TEXT</div>
                <pre><code>${md.utils.escapeHtml(content)}</code></pre>
            </div>
        `;
    }

    const label = info ? info.toUpperCase() : 'CODE';
    return `
        <div class="code-card">
            <div class="code-label">${md.utils.escapeHtml(label)}</div>
            <pre><code>${md.utils.escapeHtml(content)}</code></pre>
        </div>
    `;
};

function buildTemplateCss() {
    return `
    :root {
        --ink: #1f2937;
        --muted: #6b7280;
        --line: #d1d5db;
        --panel: #ffffff;
        --panel-soft: #f8fafc;
        --accent: #334155;
        --accent-soft: #e5e7eb;
        --shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
    }

    * {
        box-sizing: border-box;
    }

    html {
        background: #f3f4f6;
    }

    body {
        margin: 0;
        color: var(--ink);
        background: #f3f4f6;
        font-family: 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    .page-shell {
        width: min(${paperLayout.pageWidth}, 100%);
        margin: 0 auto;
        padding: 10mm 0 12mm;
    }

    .document {
        margin: 0 auto;
        padding: 10mm 14mm 10mm;
        background: var(--panel);
        box-shadow: var(--shadow);
    }

    article {
        padding: 0;
        overflow-wrap: anywhere;
    }

    h1, h2, h3, h4 {
        color: #0f172a;
        page-break-after: avoid;
        break-after: avoid-page;
    }

    h1 {
        margin: 0 0 2.5mm;
        font-size: 22pt;
        line-height: 1.2;
        letter-spacing: -0.03em;
    }

    h2 {
        margin: 11mm 0 4mm;
        padding-bottom: 2.2mm;
        border-bottom: 0.45mm solid #d1d5db;
        font-size: 16pt;
        line-height: 1.32;
    }

    h3 {
        margin: 8mm 0 3mm;
        font-size: 12.5pt;
        line-height: 1.4;
    }

    h4 {
        margin: 6mm 0 2mm;
        font-size: 11pt;
        line-height: 1.45;
    }

    p, li, blockquote {
        font-size: 10.5pt;
        line-height: 1.8;
    }

    p {
        margin: 0 0 4mm;
    }

    ul, ol {
        margin: 0 0 5mm;
        padding-left: 6mm;
    }

    ul.contains-task-list {
        padding-left: 0;
        list-style: none;
    }

    li + li {
        margin-top: 1.2mm;
    }

    .task-list-item {
        display: flex;
        align-items: flex-start;
        gap: 2.4mm;
        list-style: none;
    }

    .task-list-item + .task-list-item {
        margin-top: 2mm;
    }

    .task-list-item-checkbox {
        flex: none;
        width: 4mm;
        height: 4mm;
        margin: 1.3mm 0 0;
        accent-color: #0f766e;
    }

    .task-list-item label {
        flex: 1;
    }

    strong {
        color: #0f172a;
    }

    code {
        padding: 0.4mm 1.4mm;
        border-radius: 1.2mm;
        background: #f3f4f6;
        color: #334155;
        font-family: 'JetBrains Mono', 'D2Coding', 'Consolas', monospace;
        font-size: 0.92em;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    pre code {
        padding: 0;
        background: transparent;
        color: inherit;
    }

    .code-card,
    .diagram-card {
        margin: 5mm 0 7mm;
        overflow: hidden;
        border: 0.35mm solid #d1d5db;
        border-radius: 2.4mm;
        background: #ffffff;
        box-shadow: none;
        break-inside: auto;
        page-break-inside: auto;
    }

    .diagram-section {
        break-inside: avoid;
        page-break-inside: avoid;
    }

    .code-label,
    .diagram-card figcaption {
        padding: 3mm 4mm;
        font-size: 8.5pt;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
        background: #f8fafc;
        border-bottom: 0.35mm solid #d1d5db;
    }

    .code-card pre,
    .diagram-card pre {
        margin: 0;
        padding: 4mm;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
        color: #1f2937;
        background: #fcfcfd;
        font-family: 'JetBrains Mono', 'D2Coding', 'Consolas', monospace;
        font-size: 9.2pt;
        line-height: 1.65;
    }

    .text-card pre {
        overflow-x: auto;
        overflow-y: hidden;
        overflow-wrap: normal;
        word-break: normal;
        white-space: pre;
        font-size: 8.4pt;
        line-height: 1.5;
    }

    .text-card pre code {
        white-space: inherit;
        overflow-wrap: normal;
        word-break: normal;
    }

    .diagram-card .mermaid {
        padding: 2mm;
        background: #ffffff;
        text-align: center;
    }

    .diagram-card svg {
        display: block;
        width: auto;
        height: auto;
        max-width: 100%;
        max-height: 150mm;
        margin: 0 auto;
    }

    .diagram-card svg.diagram-small {
        max-width: 85mm;
    }

    .diagram-card svg.diagram-medium {
        max-width: 120mm;
    }

    .diagram-card svg.diagram-large {
        max-width: 100%;
    }

    table {
        width: 100%;
        margin: 5mm 0 7mm;
        border-collapse: collapse;
        table-layout: fixed;
        overflow: hidden;
        border-radius: 2.4mm;
        border-style: hidden;
        box-shadow: 0 0 0 0.35mm #d1d5db;
        break-inside: avoid;
        page-break-inside: avoid;
    }

    thead tr {
        background: #f3f4f6;
    }

    th, td {
        font-size: 9.2pt;
        line-height: 1.55;
        padding: 3.4mm 3.6mm;
        vertical-align: top;
        text-align: left;
        border: 0.35mm solid #d6dde8;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
    }

    th {
        font-weight: 800;
        color: #111827;
    }

    tbody tr:nth-child(even) {
        background: #fafafa;
    }

    blockquote {
        margin: 5mm 0 6mm;
        padding: 4mm 5mm;
        border-left: 1mm solid #94a3b8;
        border-radius: 0 2mm 2mm 0;
        background: #f8fafc;
        color: #334155;
    }

    .callout {
        margin: 5mm 0 7mm;
        padding: 0;
        overflow: hidden;
        border: 0.35mm solid #cbd5e1;
        border-left-width: 1.4mm;
        border-radius: 2.6mm;
        background: #f8fafc;
        break-inside: avoid;
        page-break-inside: avoid;
    }

    .callout p {
        margin: 0;
        padding: 0 5mm 4mm;
    }

    .callout p + p,
    .callout ul,
    .callout ol {
        margin-top: 0;
    }

    .callout-title {
        padding: 3.2mm 5mm 2.4mm;
        font-size: 8.8pt;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    .callout-note {
        border-color: #93c5fd;
        background: #eff6ff;
    }

    .callout-note .callout-title {
        color: #1d4ed8;
    }

    .callout-tip {
        border-color: #86efac;
        background: #f0fdf4;
    }

    .callout-tip .callout-title {
        color: #15803d;
    }

    .callout-important {
        border-color: #c4b5fd;
        background: #f5f3ff;
    }

    .callout-important .callout-title {
        color: #6d28d9;
    }

    .callout-warning,
    .callout-caution {
        border-color: #fdba74;
        background: #fff7ed;
    }

    .callout-warning .callout-title,
    .callout-caution .callout-title {
        color: #c2410c;
    }

    .toc {
        margin: 5mm 0 7mm;
        padding: 4.5mm 5mm 4mm;
        border: 0.35mm solid #cbd5e1;
        border-radius: 2.6mm;
        background: #f8fafc;
        break-inside: avoid;
        page-break-inside: avoid;
    }

    .toc-title {
        margin: 0 0 2.2mm;
        color: #0f172a;
        font-size: 9pt;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    .toc-list {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .toc-item {
        margin: 0;
        padding: 0;
    }

    .toc-item + .toc-item {
        margin-top: 1.2mm;
    }

    .toc-level-2 {
        padding-left: 0;
    }

    .toc-level-3 {
        padding-left: 4mm;
    }

    .toc-level-4 {
        padding-left: 8mm;
    }

    .toc a {
        color: #1d4ed8;
        text-decoration: none;
    }

    .toc a:hover {
        text-decoration: underline;
    }

    .katex-display {
        margin: 5mm 0 7mm;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 2mm 0;
    }

    .katex {
        font-size: 1.02em;
    }

    .katex,
    .katex *,
    .katex-display,
    .katex-display * {
        box-sizing: content-box;
        word-break: normal;
        overflow-wrap: normal;
        word-wrap: normal;
        letter-spacing: normal;
    }

    .katex .base,
    .katex .strut,
    .katex .vlist,
    .katex .vlist *,
    .katex .mord,
    .katex .mfrac,
    .katex-display > .katex,
    .katex-display > .katex > .katex-html {
        white-space: nowrap;
    }

    img {
        display: block;
        max-width: 100%;
        height: auto;
        margin: 5mm auto 7mm;
        border: 0.35mm solid #d1d5db;
        border-radius: 2.4mm;
        background: #ffffff;
        break-inside: avoid;
        page-break-inside: avoid;
    }

    hr {
        margin: 10mm 0;
        border: 0;
        border-top: 0.5mm solid #d6dde8;
    }

    sup.footnote-ref {
        margin-left: 0.8mm;
        font-size: 0.72em;
        vertical-align: super;
    }

    sup.footnote-ref a,
    .footnote-backref {
        color: #1d4ed8;
        text-decoration: none;
    }

    .footnotes {
        margin-top: 10mm;
        padding-top: 5mm;
        border-top: 0.45mm solid #d1d5db;
    }

    .footnotes ol {
        padding-left: 5.5mm;
    }

    .footnotes li {
        font-size: 9.4pt;
        line-height: 1.65;
    }

    @page {
        size: ${paperLayout.cssValue};
        margin: 12mm;
    }

    @media print {
        html {
            background: #fff;
        }

        body {
            background: #fff;
        }

        .page-shell {
            margin: 0;
            padding: 0;
        }

        .document {
            box-shadow: none;
        }
    }
`;
}

await fs.mkdir(pdfDir, { recursive: true });
await fs.mkdir(htmlDir, { recursive: true });

if (logToFile) {
    await fs.writeFile(renderLogPath, '', 'utf8');
}

await logProgress(
    `Render started.
    input=${inputDir}
    output=${pdfDir}
    html=${htmlDir}
    paperSize=${paperLayout.sizeDisplayValue}
    orientation=${paperOrientation.displayValue}
    logFile=${logToFile ? renderLogPath : 'disabled'}`,
);

const manifest = [];
let browser;

try {
    const launchOptions = await resolveBrowserLaunchOptions(args.chromePath);

    browser = await puppeteer.launch({
        ...launchOptions,
        headless: true,
    });

    const files = await getMarkdownFiles(inputDir);

    await logProgress(`Discovered ${files.length} markdown file(s).`);

    for (const [index, fileName] of files.entries()) {
        const sourcePath = path.join(inputDir, fileName);
        const markdown = await fs.readFile(sourcePath, 'utf8');
        const title = extractTitle(markdown) ?? toTitle(fileName);
        const html = buildHtml({
            markdown,
            title,
            baseHref: toDirectoryHref(inputDir),
        });
        const baseName = fileName.replace(/\.md$/i, '');
        const htmlPath = path.join(htmlDir, `${baseName}.html`);
        const pdfPath = path.join(pdfDir, `${baseName}.pdf`);

        await logProgress(`[${index + 1}/${files.length}] Rendering ${fileName}`);
        await fs.writeFile(htmlPath, html, 'utf8');
        await renderPdf(browser, htmlPath, pdfPath);
        await logProgress(`[${index + 1}/${files.length}] Completed ${fileName} -> ${baseName}.pdf`);

        manifest.push({
            title,
            fileName,
            pdfName: `${baseName}.pdf`,
        });
    }
    await logProgress(`Rendered ${manifest.length} PDF file(s).`);

    const manifestMarkdown = [
        '# PDF 산출물 목록',
        '',
        `생성일: ${formatDate(new Date())}`,
        '',
        ...manifest.map((item) => `- ${item.title}: \`${item.pdfName}\` (원본: \`${item.fileName}\`)`),
        '',
    ].join('\n');

    await fs.writeFile(path.join(pdfDir, 'README.md'), manifestMarkdown, 'utf8');
    await logProgress(`Wrote manifest: ${path.join(pdfDir, 'README.md')}`);
    await logProgress('Render finished successfully.');
} catch (error) {
    await logProgress(`Render failed: ${formatError(error)}`);
    fatalErrorReported = true;
    process.exitCode = 1;
} finally {
    if (browser) {
        await browser.close();
    }
}

function buildHtml({ markdown, title, baseHref }) {
    const rendered = md.render(markdown);

    return `<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <base href="${escapeHtml(baseHref)}" />
    <style>${katexCss}</style>
    <style>${buildTemplateCss()}</style>
    <script type="module">
        import mermaid from '${mermaidModuleUrl}';

        const groupDiagramSections = () => {
            for (const figure of document.querySelectorAll('.diagram-card')) {
                if (figure.parentElement?.classList.contains('diagram-section')) continue;

                const wrapper = document.createElement('section');
                wrapper.className = 'diagram-section';

                const nodes = [figure];
                let cursor = figure.previousElementSibling;

                while (cursor) {
                    const tag = cursor.tagName;

                    if (tag === 'H1' || tag === 'H2') break;

                    if (tag === 'H3' || tag === 'H4') {
                        nodes.unshift(cursor);
                        break;
                    }

                    if (tag === 'P' || tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE') {
                        nodes.unshift(cursor);
                        cursor = cursor.previousElementSibling;
                        continue;
                    }

                    break;
                }

                figure.before(wrapper);
                for (const node of nodes) {
                    wrapper.appendChild(node);
                }
            }
        };

        const renderMermaid = async () => {
            try {
                mermaid.initialize({
                    startOnLoad: false,
                    securityLevel: 'loose',
                    theme: 'base',
                    themeVariables: {
                        primaryColor: '#d9f3ef',
                        primaryTextColor: '#0f172a',
                        primaryBorderColor: '#0f766e',
                        lineColor: '#164e63',
                        secondaryColor: '#eff6ff',
                        tertiaryColor: '#fff7ed',
                        fontFamily: 'Noto Sans KR, Malgun Gothic, Apple SD Gothic Neo, sans-serif',
                        fontSize: '12px',
                    },
                    flowchart: {
                        curve: 'basis',
                        htmlLabels: true,
                    },
                    sequence: {
                        useMaxWidth: true,
                        wrap: true,
                    },
                });

                await mermaid.run({
                    querySelector: '.mermaid',
                });

                for (const svg of document.querySelectorAll('.diagram-card svg')) {
                    const viewBox = (svg.getAttribute('viewBox') || '').split(/\\s+/).map(Number);
                    const vbWidth = Number.isFinite(viewBox[2]) ? viewBox[2] : 0;
                    const vbHeight = Number.isFinite(viewBox[3]) ? viewBox[3] : 0;

                    svg.removeAttribute('width');
                    svg.removeAttribute('height');
                    svg.style.width = 'auto';
                    svg.style.height = 'auto';
                    svg.style.maxHeight = '150mm';

                    if (vbWidth > 0 && vbHeight > 0) {
                        if (vbWidth <= 700 && vbHeight <= 550) {
                            svg.classList.add('diagram-small');
                            svg.style.maxWidth = '85mm';
                        } else if (vbWidth <= 1400 && vbHeight <= 900) {
                            svg.classList.add('diagram-medium');
                            svg.style.maxWidth = '120mm';
                        } else {
                            svg.classList.add('diagram-large');
                            svg.style.maxWidth = '100%';
                        }
                    } else {
                        svg.style.maxWidth = '100%';
                    }
                }

                groupDiagramSections();

                document.body.dataset.mermaidReady = 'true';
            } catch (error) {
                document.body.dataset.mermaidError = error?.message || error?.str || String(error);
                console.error(error);
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', renderMermaid, { once: true });
        } else {
            renderMermaid();
        }
    </script>
</head>
<body>
    <main class="page-shell">
        <section class="document">
            <article>${rendered}</article>
        </section>
    </main>
</body>
</html>`;
}

async function renderPdf(browser, htmlPath, pdfPath) {
    const page = await browser.newPage();

    try {
        await page.goto(pathToFileURL(htmlPath).href, {
            waitUntil: 'networkidle0',
        });
        await page.emulateMediaType('print');
        await page.waitForFunction(
            () => document.body.dataset.mermaidReady === 'true' || Boolean(document.body.dataset.mermaidError),
            {
                timeout: 30_000,
            },
        );
        const mermaidError = await page.evaluate(() => document.body.dataset.mermaidError || null);

        if (mermaidError) {
            throw new Error(`Mermaid render failed for ${path.basename(htmlPath)}: ${mermaidError}`);
        }
        await page.evaluate(async () => {
            if (document.fonts?.ready) {
                await document.fonts.ready;
            }
        });
        await page.pdf({
            path: pdfPath,
            printBackground: true,
            displayHeaderFooter: false,
            preferCSSPageSize: true,
        });
    } finally {
        await page.close();
    }
}

function extractTitle(markdown) {
    const match = markdown.match(/^#\s+(.+)$/m);
    return match?.[1]?.trim();
}

function detectDiagramCaption(content) {
    if (content.includes('sequenceDiagram')) {
        return 'Sequence Diagram';
    }

    if (content.includes('flowchart')) {
        return 'Flow Diagram';
    }

    return 'Diagram Definition';
}

function katexPlugin(markdown, options = {}) {
    markdown.inline.ruler.after('escape', 'math_inline', (state, silent) => {
        if (state.src[state.pos] !== '$') {
            return false;
        }

        const opening = isValidMathDelimiter(state, state.pos);

        if (!opening.canOpen) {
            if (!silent) {
                state.pending += '$';
            }
            state.pos += 1;
            return true;
        }

        const start = state.pos + 1;
        let match = start;

        while ((match = state.src.indexOf('$', match)) !== -1) {
            let pos = match - 1;

            while (state.src[pos] === '\\') {
                pos -= 1;
            }

            if ((match - pos) % 2 === 1) {
                break;
            }

            match += 1;
        }

        if (match === -1) {
            if (!silent) {
                state.pending += '$';
            }
            state.pos = start;
            return true;
        }

        if (match - start === 0) {
            if (!silent) {
                state.pending += '$$';
            }
            state.pos = start + 1;
            return true;
        }

        const closing = isValidMathDelimiter(state, match);

        if (!closing.canClose) {
            if (!silent) {
                state.pending += '$';
            }
            state.pos = start;
            return true;
        }

        if (!silent) {
            const token = state.push('math_inline', 'math', 0);
            token.markup = '$';
            token.content = state.src.slice(start, match);
        }

        state.pos = match + 1;
        return true;
    });

    markdown.block.ruler.after('blockquote', 'math_block', (state, start, end, silent) => {
        let pos = state.bMarks[start] + state.tShift[start];
        const max = state.eMarks[start];

        if (pos + 2 > max || state.src.slice(pos, pos + 2) !== '$$') {
            return false;
        }

        pos += 2;
        let firstLine = state.src.slice(pos, max);

        if (silent) {
            return true;
        }

        let found = false;
        let lastLine = '';
        let next = start;

        if (firstLine.trim().endsWith('$$')) {
            firstLine = firstLine.trim().slice(0, -2);
            found = true;
        }

        while (!found) {
            next += 1;

            if (next >= end) {
                break;
            }

            pos = state.bMarks[next] + state.tShift[next];
            const lineMax = state.eMarks[next];

            if (pos < lineMax && state.tShift[next] < state.blkIndent) {
                break;
            }

            if (state.src.slice(pos, lineMax).trim().endsWith('$$')) {
                const lastPos = state.src.slice(0, lineMax).lastIndexOf('$$');
                lastLine = state.src.slice(pos, lastPos);
                found = true;
            }
        }

        state.line = next + 1;

        const token = state.push('math_block', 'math', 0);
        token.block = true;
        token.content = `${firstLine && firstLine.trim() ? `${firstLine}\n` : ''}${state.getLines(start + 1, next, state.tShift[start], true)}${lastLine && lastLine.trim() ? lastLine : ''}`;
        token.map = [start, state.line];
        token.markup = '$$';
        return true;
    }, {
        alt: ['paragraph', 'reference', 'blockquote', 'list'],
    });

    markdown.renderer.rules.math_inline = (tokens, idx) => renderKatex(tokens[idx].content, false, options);
    markdown.renderer.rules.math_block = (tokens, idx) => `<p>${renderKatex(tokens[idx].content, true, options)}</p>\n`;
}

function renderKatex(latex, displayMode, options) {
    try {
        return katex.renderToString(latex, {
            ...options,
            displayMode,
        });
    } catch (error) {
        if (options.throwOnError) {
            throw error;
        }

        return escapeHtml(latex);
    }
}

function isValidMathDelimiter(state, pos) {
    const prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
    const nextChar = pos + 1 <= state.posMax ? state.src.charCodeAt(pos + 1) : -1;

    let canOpen = true;
    let canClose = true;

    if (prevChar === 0x20 || prevChar === 0x09 || (nextChar >= 0x30 && nextChar <= 0x39)) {
        canClose = false;
    }

    if (nextChar === 0x20 || nextChar === 0x09) {
        canOpen = false;
    }

    return {
        canOpen,
        canClose,
    };
}

function calloutPlugin(markdown) {
    markdown.core.ruler.after('block', 'callout', (state) => {
        for (let i = 0; i < state.tokens.length; i += 1) {
            const openToken = state.tokens[i];

            if (openToken.type !== 'blockquote_open') {
                continue;
            }

            const paragraphOpen = state.tokens[i + 1];
            const inlineToken = state.tokens[i + 2];
            const paragraphClose = state.tokens[i + 3];

            if (
                paragraphOpen?.type !== 'paragraph_open'
                || inlineToken?.type !== 'inline'
                || paragraphClose?.type !== 'paragraph_close'
            ) {
                continue;
            }

            const lines = inlineToken.content.split('\n');
            const markerMatch = lines[0]?.match(/^\[!([A-Z]+)\]\s*(.*)$/);

            if (!markerMatch) {
                continue;
            }

            const callout = resolveCallout(markerMatch[1]);

            if (!callout) {
                continue;
            }

            const closeIndex = findMatchingBlockquoteClose(state.tokens, i);

            if (closeIndex === -1) {
                continue;
            }

            openToken.tag = 'aside';
            openToken.attrJoin('class', `callout callout-${callout.name}`);
            state.tokens[closeIndex].tag = 'aside';

            const titleBlock = new state.Token('html_block', '', 0);
            titleBlock.content = `<p class="callout-title">${escapeHtml(callout.title)}</p>\n`;

            state.tokens.splice(i + 1, 0, titleBlock);

            const bodyLines = [markerMatch[2], ...lines.slice(1)];
            const bodyContent = bodyLines.join('\n').trim();

            if (bodyContent) {
                inlineToken.content = bodyContent;
                inlineToken.children = [];
                i += 1;
                continue;
            }

            state.tokens.splice(i + 2, 3);
            i += 1;
        }
    });
}

function resolveCallout(value) {
    const normalized = value.trim().toLowerCase();
    const callouts = {
        note: { name: 'note', title: 'Note' },
        tip: { name: 'tip', title: 'Tip' },
        important: { name: 'important', title: 'Important' },
        warning: { name: 'warning', title: 'Warning' },
        caution: { name: 'caution', title: 'Caution' },
    };

    return callouts[normalized] ?? null;
}

function findMatchingBlockquoteClose(tokens, startIndex) {
    let depth = 0;

    for (let i = startIndex; i < tokens.length; i += 1) {
        if (tokens[i].type === 'blockquote_open') {
            depth += 1;
        }

        if (tokens[i].type === 'blockquote_close') {
            depth -= 1;

            if (depth === 0) {
                return i;
            }
        }
    }

    return -1;
}

function tableOfContentsPlugin(markdown) {
    markdown.core.ruler.push('table_of_contents', (state) => {
        const headings = collectHeadings(state.tokens);
        const tocItems = selectTocHeadings(headings);
        const tocMarkup = buildTocMarkup(tocItems);

        for (let i = 0; i < state.tokens.length - 2; i += 1) {
            const paragraphOpen = state.tokens[i];
            const inlineToken = state.tokens[i + 1];
            const paragraphClose = state.tokens[i + 2];

            if (
                paragraphOpen.type !== 'paragraph_open'
                || inlineToken.type !== 'inline'
                || paragraphClose.type !== 'paragraph_close'
            ) {
                continue;
            }

            if (inlineToken.content.trim() !== '[[TOC]]') {
                continue;
            }

            const htmlBlock = new state.Token('html_block', '', 0);
            htmlBlock.content = `${tocMarkup}\n`;
            state.tokens.splice(i, 3, htmlBlock);
        }
    });
}

function collectHeadings(tokens) {
    const headings = [];
    const slugCounts = new Map();

    for (let i = 0; i < tokens.length - 1; i += 1) {
        const openToken = tokens[i];
        const inlineToken = tokens[i + 1];

        if (openToken.type !== 'heading_open' || inlineToken.type !== 'inline') {
            continue;
        }

        const level = Number(openToken.tag.slice(1));
        const title = extractInlineText(inlineToken).trim();

        if (!title) {
            continue;
        }

        const slug = uniqueSlug(slugify(title), slugCounts);
        openToken.attrSet('id', slug);
        headings.push({ level, slug, title });
    }

    return headings;
}

function selectTocHeadings(headings) {
    const preferred = headings.filter((heading) => heading.level >= 2 && heading.level <= 4);

    if (preferred.length > 0) {
        return preferred;
    }

    return headings.filter((heading) => heading.level >= 1 && heading.level <= 3);
}

function buildTocMarkup(items) {
    if (items.length === 0) {
        return [
            '<nav class="toc" aria-label="Table of contents">',
            '  <p class="toc-title">Contents</p>',
            '  <p>No headings available.</p>',
            '</nav>',
        ].join('\n');
    }

    const lines = [
        '<nav class="toc" aria-label="Table of contents">',
        '  <p class="toc-title">Contents</p>',
        '  <ol class="toc-list">',
    ];

    for (const item of items) {
        const levelClass = `toc-level-${Math.min(Math.max(item.level, 2), 4)}`;
        lines.push(`    <li class="toc-item ${levelClass}"><a href="#${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a></li>`);
    }

    lines.push('  </ol>');
    lines.push('</nav>');
    return lines.join('\n');
}

function extractInlineText(token) {
    if (!Array.isArray(token.children) || token.children.length === 0) {
        return token.content ?? '';
    }

    return token.children
        .filter((child) => child.type === 'text' || child.type === 'code_inline')
        .map((child) => child.content)
        .join('');
}

function slugify(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[`*_~[\]()!]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        || 'section';
}

function uniqueSlug(baseSlug, slugCounts) {
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);

    if (count === 0) {
        return baseSlug;
    }

    return `${baseSlug}-${count + 1}`;
}

async function loadKatexCss() {
    const css = await fs.readFile(katexCssPath, 'utf8');
    const katexDistDir = path.dirname(katexCssPath);

    return css.replace(/url\((fonts\/[^)]+)\)/g, (_match, relativePath) => {
        const cleanedPath = relativePath.replace(/^['"]|['"]$/g, '');
        const absoluteHref = pathToFileURL(path.join(katexDistDir, cleanedPath)).href;
        return `url("${absoluteHref}")`;
    });
}

function toTitle(fileName) {
    return fileName
        .replace(/\.md$/i, '')
        .replace(/^\d+-/, '')
        .split('-')
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
}

function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function formatDate(date) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}`;
}

function toDirectoryHref(directoryPath) {
    const href = pathToFileURL(directoryPath).href;
    return href.endsWith('/') ? href : `${href}/`;
}

async function logProgress(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;

    if (logToFile) {
        await fs.appendFile(renderLogPath, line, 'utf8');
    }

    console.log(message);
}

function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function handleFatalError(error) {
    if (fatalErrorReported) {
        process.exitCode = 1;
        return;
    }

    fatalErrorReported = true;
    console.error(formatError(error));
    process.exitCode = 1;
}

async function resolveBrowserLaunchOptions(cliChromePath) {
    const executablePath = cliChromePath
        || process.env.PUPPETEER_EXECUTABLE_PATH
        || process.env.CHROME_PATH;

    if (executablePath) {
        return buildBrowserLaunchOptions(executablePath);
    }

    const systemBrowser = await findSystemBrowser();

    if (systemBrowser) {
        return buildBrowserLaunchOptions(systemBrowser);
    }

    if (process.platform === 'linux' && (process.arch === 'arm64' || process.arch === 'arm')) {
        throw new Error(
            'Linux ARM does not reliably support Puppeteer\'s bundled Chrome in this tool. '
            + 'Install Chromium or Chrome on the board and run again with --chrome-path <path> '
            + 'or set PUPPETEER_EXECUTABLE_PATH.',
        );
    }

    return {};
}

function buildBrowserLaunchOptions(executablePath) {
    const browser = detectBrowserType(executablePath);

    if (browser === 'firefox') {
        throw new Error(
            'Firefox is not supported by this renderer. '
            + 'Use a Chrome or Chromium executable with --chrome-path '
            + 'or set PUPPETEER_EXECUTABLE_PATH to a Chrome/Chromium binary.',
        );
    }

    return {
        browser,
        executablePath,
        args: [
            '--no-sandbox',
            '--disable-gpu',
            '--allow-file-access-from-files',
        ],
    };
}

function detectBrowserType(executablePath) {
    const lower = executablePath.toLowerCase();

    if (lower.includes('firefox')) {
        return 'firefox';
    }

    return 'chrome';
}

async function findSystemBrowser() {
    const candidates = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium',
        '/usr/lib/chromium-browser/chromium-browser',
        '/usr/lib/chromium/chromium',
    ];

    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // Keep scanning known browser paths.
        }
    }

    return null;
}

function printHelp() {
    const helpText = `
md-to-pdf-renderer

Convert top-level Markdown files in a directory into styled HTML and PDF files.

Usage:
  md-to-pdf-renderer [options]

Options:
  --input <dir>          Source Markdown directory. Default: current working directory
  --output <dir>         PDF output directory. Default: output
  --html <dir>           Intermediate HTML output directory. Default: <output>/html
  --paper-size <size>    Paper size such as A4, Letter, Legal, A3, or "210mm 297mm". Default: A4
  --orientation <mode>   Page orientation: portrait or landscape. Default: portrait
  --log-file             Write progress logs to <output>/render.log
  --chrome-path <path>   Use a custom Chrome or Chromium executable instead of Puppeteer's bundled browser
  --help, -h             Show this help message

Examples:
  md-to-pdf-renderer --output output
  md-to-pdf-renderer --input docs --output pdf --paper-size Letter --orientation landscape --log-file
  md-to-pdf-renderer --input docs --output pdf --chrome-path /usr/bin/chromium
`;

    process.stdout.write(helpText.trimStart());
}

function resolvePaperOrientation(value = 'portrait') {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'portrait' || normalized === 'landscape') {
        return {
            cssValue: normalized,
            displayValue: normalized,
            isLandscape: normalized === 'landscape',
        };
    }

    throw new Error(`Invalid orientation: ${value}. Use "portrait" or "landscape".`);
}

function resolvePaperLayout(value = 'A4', orientation = resolvePaperOrientation()) {
    const normalized = value.trim().replace(/\s+/g, ' ').toLowerCase();
    const knownSizes = {
        a5: { cssValue: 'A5', width: '148mm', height: '210mm', displayValue: 'A5' },
        a4: { cssValue: 'A4', width: '210mm', height: '297mm', displayValue: 'A4' },
        a3: { cssValue: 'A3', width: '297mm', height: '420mm', displayValue: 'A3' },
        letter: { cssValue: 'Letter', width: '8.5in', height: '11in', displayValue: 'Letter' },
        legal: { cssValue: 'Legal', width: '8.5in', height: '14in', displayValue: 'Legal' },
        tabloid: { cssValue: 'Tabloid', width: '11in', height: '17in', displayValue: 'Tabloid' },
    };

    if (knownSizes[normalized]) {
        const preset = knownSizes[normalized];

        return {
            cssValue: `${preset.cssValue} ${orientation.cssValue}`,
            pageWidth: orientation.isLandscape ? preset.height : preset.width,
            sizeDisplayValue: preset.displayValue,
        };
    }

    const customSizeMatch = normalized.match(/^([0-9.]+(?:mm|cm|in))\s+([0-9.]+(?:mm|cm|in))$/);

    if (customSizeMatch) {
        const width = customSizeMatch[1];
        const height = customSizeMatch[2];
        return {
            cssValue: orientation.isLandscape ? `${height} ${width}` : `${width} ${height}`,
            pageWidth: orientation.isLandscape ? height : width,
            sizeDisplayValue: `${width} ${height}`,
        };
    }

    return {
        cssValue: `${value} ${orientation.cssValue}`,
        pageWidth: orientation.isLandscape ? '297mm' : '210mm',
        sizeDisplayValue: value,
    };
}

async function getMarkdownFiles(directoryPath) {
    let stats;

    try {
        stats = await fs.stat(directoryPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(`Input directory does not exist: ${directoryPath}`);
        }

        throw error;
    }

    if (!stats.isDirectory()) {
        throw new Error(`Input path is not a directory: ${directoryPath}`);
    }

    const entries = await fs.readdir(directoryPath, { withFileTypes: true });

    if (entries.length === 0) {
        throw new Error(`Input directory is empty: ${directoryPath}`);
    }

    const markdownFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, 'ko'));

    if (markdownFiles.length === 0) {
        throw new Error(`Input directory does not contain any top-level .md files: ${directoryPath}`);
    }

    return markdownFiles;
}

function parseArgs(argv) {
    const parsed = {};

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            parsed.help = true;
            continue;
        }

        if (arg === '--input') {
            parsed.input = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--output') {
            parsed.output = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--html') {
            parsed.html = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--chrome-path') {
            parsed.chromePath = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--paper-size') {
            parsed.paperSize = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--orientation') {
            parsed.orientation = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--log-file') {
            parsed.logFile = true;
        }
    }

    return parsed;
}
