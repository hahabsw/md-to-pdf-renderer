import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import {
    extractTitle,
    renderMarkdownDocument,
} from './markdown-document.mjs';
import { renderPdf, resolveBrowserLaunchOptions } from './browser-renderer.mjs';
import { buildManifestMarkdown } from './manifest.mjs';
import {
    resolveDocumentRenderOptions,
    resolveRenderOptions,
    toDirectoryHref,
} from './render-options.mjs';

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

function createLogger({ logToFile, renderLogPath, onProgress }) {
    return async (message) => {
        const line = `[${new Date().toISOString()}] ${message}\n`;

        if (logToFile) {
            await fs.appendFile(renderLogPath, line, 'utf8');
        }

        await onProgress(message);
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

function toTitle(fileName) {
    return fileName
        .replace(/\.md$/i, '')
        .replace(/^\d+-/, '')
        .split('-')
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
}
