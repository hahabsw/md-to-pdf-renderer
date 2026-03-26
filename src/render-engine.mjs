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

/**
 * @typedef {Object} RenderedFile
 * @property {string} title Human-readable document title used in the manifest.
 * @property {string} fileName Source Markdown file name.
 * @property {string} pdfName Output PDF file name.
 * @property {string} pdfPath Absolute path to the generated PDF file.
 * @property {string | null} htmlPath Absolute path to the generated HTML file when `htmlDir` is enabled.
 * @property {string} sourcePath Absolute path to the source Markdown file.
 */

/**
 * @typedef {Object} RenderDirectoryResult
 * @property {string} inputDir Absolute input directory path.
 * @property {string} outputDir Absolute output directory path.
 * @property {string | null} htmlDir Absolute HTML output directory path when enabled.
 * @property {string} manifestPath Absolute path to the generated output manifest.
 * @property {string | null} renderLogPath Absolute path to the render log when `logFile` is enabled.
 * @property {RenderedFile[]} files Rendered output metadata for each Markdown file.
 */

/**
 * Render every top-level Markdown file in a directory into PDF files.
 *
 * Paths may be absolute or relative to `cwd`. By default the renderer writes
 * PDFs and a manifest into `output`, skips intermediate HTML files, and logs
 * progress through `onProgress` only.
 *
 * @param {Object} [options={}]
 * @param {string} [options.cwd=process.cwd()] Base directory used to resolve relative paths.
 * @param {string} [options.inputDir]
 * @param {string} [options.input] Alias for `inputDir`.
 * @param {string} [options.outputDir]
 * @param {string} [options.output] Alias for `outputDir`.
 * @param {string | null} [options.htmlDir]
 * @param {string | null} [options.html] Alias for `htmlDir`.
 * @param {string} [options.paperSize='A4'] Paper size such as `A4`, `Letter`, or `210mm 297mm`.
 * @param {string} [options.orientation='portrait'] Page orientation, either `portrait` or `landscape`.
 * @param {boolean} [options.logToFile=false]
 * @param {boolean} [options.logFile=false] Alias for `logToFile`.
 * @param {string | null} [options.chromePath=null] Optional Chrome or Chromium executable path.
 * @param {(message: string) => (void | Promise<void>)} [options.onProgress] Callback invoked for each progress message.
 * @returns {Promise<RenderDirectoryResult>}
 */
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

/**
 * Render a single Markdown string into the HTML document used by the PDF pipeline.
 *
 * This function does not write files and does not launch a browser.
 *
 * @param {Object} options
 * @param {string} options.markdown Markdown source to render.
 * @param {string} [options.title] Optional HTML document title. Defaults to the first `# Heading` or `Document`.
 * @param {string} [options.cwd=process.cwd()] Base directory used to resolve relative paths.
 * @param {string} [options.baseDir='.'] Base directory used for relative asset links when `baseHref` is omitted.
 * @param {string} [options.inputDir] Alias for `baseDir`.
 * @param {string} [options.baseHref] Explicit `<base href>` value for generated HTML.
 * @param {string} [options.paperSize='A4'] Paper size such as `A4`, `Letter`, or `210mm 297mm`.
 * @param {string} [options.orientation='portrait'] Page orientation, either `portrait` or `landscape`.
 * @returns {Promise<string>}
 */
export async function renderMarkdownToHtml(options) {
    const renderOptions = resolveDocumentRenderOptions(options);

    return renderMarkdownDocument({
        markdown: renderOptions.markdown,
        title: renderOptions.title,
        baseHref: renderOptions.baseHref,
        paperLayout: renderOptions.paperLayout,
    });
}

/**
 * Convert unknown thrown values into a printable error string.
 *
 * @param {unknown} error
 * @returns {string}
 */
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
