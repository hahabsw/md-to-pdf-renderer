import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';
import {
    extractTitle,
    renderMarkdownDocument,
    resolvePaperLayout,
    resolvePaperOrientation,
} from './markdown-document.mjs';

export async function renderMarkdownDirectory(options = {}) {
    const renderOptions = resolveRenderOptions(options);
    const logProgress = createLogger(renderOptions);

    await fs.mkdir(renderOptions.outputDir, { recursive: true });

    if (renderOptions.htmlDir) {
        await fs.mkdir(renderOptions.htmlDir, { recursive: true });
    }

    if (renderOptions.logToFile) {
        await fs.writeFile(renderOptions.renderLogPath, '', 'utf8');
    }

    await logProgress(
        `Render started.
    input=${renderOptions.inputDir}
    output=${renderOptions.outputDir}
    html=${renderOptions.htmlDir ?? 'disabled'}
    paperSize=${renderOptions.paperLayout.sizeDisplayValue}
    orientation=${renderOptions.paperOrientation.displayValue}
    logFile=${renderOptions.logToFile ? renderOptions.renderLogPath : 'disabled'}`,
    );

    const manifest = [];
    let browser;

    try {
        const launchOptions = await resolveBrowserLaunchOptions(renderOptions.chromePath);

        browser = await puppeteer.launch({
            ...launchOptions,
            headless: true,
        });

        const files = await getMarkdownFiles(renderOptions.inputDir);
        const baseHref = toDirectoryHref(renderOptions.inputDir);

        await logProgress(`Discovered ${files.length} markdown file(s).`);

        for (const [index, fileName] of files.entries()) {
            const sourcePath = path.join(renderOptions.inputDir, fileName);
            const markdown = await fs.readFile(sourcePath, 'utf8');
            const title = extractTitle(markdown) ?? toTitle(fileName);
            const html = await renderMarkdownDocument({
                markdown,
                title,
                baseHref,
                paperLayout: renderOptions.paperLayout,
            });
            const baseName = fileName.replace(/\.md$/i, '');
            const pdfPath = path.join(renderOptions.outputDir, `${baseName}.pdf`);
            const htmlPath = renderOptions.htmlDir ? path.join(renderOptions.htmlDir, `${baseName}.html`) : null;

            await logProgress(`[${index + 1}/${files.length}] Rendering ${fileName}`);
            if (htmlPath) {
                await fs.writeFile(htmlPath, html, 'utf8');
            }
            await renderPdf(browser, {
                html,
                pdfPath,
                documentLabel: htmlPath ? path.basename(htmlPath) : fileName,
            });
            await logProgress(`[${index + 1}/${files.length}] Completed ${fileName} -> ${baseName}.pdf`);

            manifest.push({
                title,
                fileName,
                pdfName: `${baseName}.pdf`,
                pdfPath,
                htmlPath,
                sourcePath,
            });
        }
        await logProgress(`Rendered ${manifest.length} PDF file(s).`);

        const manifestPath = path.join(renderOptions.outputDir, 'README.md');
        const manifestMarkdown = buildManifestMarkdown(manifest);

        await fs.writeFile(manifestPath, manifestMarkdown, 'utf8');
        await logProgress(`Wrote manifest: ${manifestPath}`);
        await logProgress('Render finished successfully.');

        return {
            inputDir: renderOptions.inputDir,
            outputDir: renderOptions.outputDir,
            htmlDir: renderOptions.htmlDir,
            manifestPath,
            renderLogPath: renderOptions.logToFile ? renderOptions.renderLogPath : null,
            files: manifest,
        };
    } catch (error) {
        await logProgress(`Render failed: ${formatError(error)}`);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

export async function renderMarkdownToHtml(options) {
    const renderOptions = resolveDocumentRenderOptions(options);

    return renderMarkdownDocument({
        markdown: renderOptions.markdown,
        title: renderOptions.title,
        baseHref: renderOptions.baseHref,
        paperLayout: renderOptions.paperLayout,
    });
}

export function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

async function renderPdf(browser, { html, pdfPath, documentLabel }) {
    const page = await browser.newPage();

    try {
        await page.setContent(html, {
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
            throw new Error(`Mermaid render failed for ${documentLabel}: ${mermaidError}`);
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

function createLogger({ logToFile, renderLogPath, onProgress }) {
    return async (message) => {
        const line = `[${new Date().toISOString()}] ${message}\n`;

        if (logToFile) {
            await fs.appendFile(renderLogPath, line, 'utf8');
        }

        await onProgress(message);
    };
}

function buildManifestMarkdown(manifest) {
    return [
        '# PDF 산출물 목록',
        '',
        `생성일: ${formatDate(new Date())}`,
        '',
        ...manifest.map((item) => `- ${item.title}: \`${item.pdfName}\` (원본: \`${item.fileName}\`)`),
        '',
    ].join('\n');
}

function resolveRenderOptions(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const inputDir = path.resolve(cwd, options.inputDir ?? options.input ?? '.');
    const outputDir = path.resolve(cwd, options.outputDir ?? options.output ?? 'output');
    const htmlTarget = options.htmlDir ?? options.html ?? null;
    const htmlDir = htmlTarget ? path.resolve(cwd, htmlTarget) : null;
    const logToFile = Boolean(options.logToFile ?? options.logFile);
    const paperOrientation = resolvePaperOrientation(options.orientation);
    const paperLayout = resolvePaperLayout(options.paperSize, paperOrientation);

    return {
        inputDir,
        outputDir,
        htmlDir,
        chromePath: options.chromePath ?? null,
        logToFile,
        renderLogPath: path.join(outputDir, 'render.log'),
        onProgress: typeof options.onProgress === 'function' ? options.onProgress : async () => {},
        paperOrientation,
        paperLayout,
    };
}

function resolveDocumentRenderOptions(options = {}) {
    if (typeof options.markdown !== 'string') {
        throw new Error('renderMarkdownToHtml requires a markdown string.');
    }

    const cwd = path.resolve(options.cwd ?? process.cwd());
    const baseDir = path.resolve(cwd, options.baseDir ?? options.inputDir ?? '.');
    const title = options.title?.trim() || extractTitle(options.markdown) || 'Document';
    const paperOrientation = resolvePaperOrientation(options.orientation);
    const paperLayout = resolvePaperLayout(options.paperSize, paperOrientation);

    return {
        markdown: options.markdown,
        title,
        baseHref: options.baseHref ?? toDirectoryHref(baseDir),
        paperLayout,
    };
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

function toTitle(fileName) {
    return fileName
        .replace(/\.md$/i, '')
        .replace(/^\d+-/, '')
        .split('-')
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
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
