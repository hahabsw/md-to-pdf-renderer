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
    resolveFileRenderOptions,
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
 * @typedef {Object} RenderFileResult
 * @property {string} inputFile Absolute input file path.
 * @property {string} outputDir Absolute output directory path.
 * @property {string | null} htmlDir Absolute HTML output directory path when enabled.
 * @property {string} manifestPath Absolute path to the generated output manifest.
 * @property {string | null} renderLogPath Absolute path to the render log when `logFile` is enabled.
 * @property {RenderedFile} file Rendered output metadata for the Markdown file.
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
    const files = await getMarkdownFiles(renderOptions.inputDir);

    return renderMarkdownSources({
        renderOptions,
        inputLabel: renderOptions.inputDir,
        sourceFiles: files.map((fileName) => path.join(renderOptions.inputDir, fileName)),
        baseHref: toDirectoryHref(renderOptions.inputDir),
        discoveredMessage: `Discovered ${files.length} markdown file(s).`,
        buildResult: ({ manifestPath, files: renderedFiles }) => ({
            inputDir: renderOptions.inputDir,
            outputDir: renderOptions.outputDir,
            htmlDir: renderOptions.htmlDir,
            manifestPath,
            renderLogPath: renderOptions.logToFile ? renderOptions.renderLogPath : null,
            files: renderedFiles,
        }),
    });
}

/**
 * Render a single Markdown file into PDF output.
 *
 * Paths may be absolute or relative to `cwd`. The PDF file is written into
 * `outputDir` using the Markdown file name, and a one-item manifest is still
 * generated for consistency with directory renders.
 *
 * @param {Object} [options={}]
 * @param {string} [options.cwd=process.cwd()] Base directory used to resolve relative paths.
 * @param {string} [options.inputFile]
 * @param {string} [options.input] Alias for `inputFile`.
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
 * @returns {Promise<RenderFileResult>}
 */
export async function renderMarkdownFile(options = {}) {
    const renderOptions = resolveFileRenderOptions(options);
    const sourceFile = await getMarkdownFile(renderOptions.inputFile);

    return renderMarkdownSources({
        renderOptions,
        inputLabel: renderOptions.inputFile,
        sourceFiles: [sourceFile],
        baseHref: toDirectoryHref(path.dirname(sourceFile)),
        discoveredMessage: `Discovered 1 markdown file(s).`,
        buildResult: ({ manifestPath, files: renderedFiles }) => ({
            inputFile: renderOptions.inputFile,
            outputDir: renderOptions.outputDir,
            htmlDir: renderOptions.htmlDir,
            manifestPath,
            renderLogPath: renderOptions.logToFile ? renderOptions.renderLogPath : null,
            file: renderedFiles[0],
        }),
    });
}

/**
 * Render either a top-level Markdown directory or a single Markdown file.
 *
 * `input` may point to either a directory or a `.md` file. The return shape
 * depends on the detected input type.
 *
 * @param {Object} [options={}]
 * @param {string} [options.cwd=process.cwd()] Base directory used to resolve relative paths.
 * @param {string} [options.input='.'] Directory or Markdown file path.
 * @returns {Promise<RenderDirectoryResult | RenderFileResult>}
 */
export async function renderMarkdownPath(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const inputPath = path.resolve(cwd, options.input ?? options.inputDir ?? options.inputFile ?? '.');
    const stats = await statInputPath(inputPath);

    if (stats.isDirectory()) {
        return renderMarkdownDirectory({
            ...options,
            cwd,
            inputDir: inputPath,
        });
    }

    return renderMarkdownFile({
        ...options,
        cwd,
        inputFile: inputPath,
    });
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

async function renderMarkdownSources({
    renderOptions,
    inputLabel,
    sourceFiles,
    baseHref,
    discoveredMessage,
    buildResult,
}) {
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
    input=${inputLabel}
    output=${renderOptions.outputDir}
    html=${renderOptions.htmlDir ?? 'disabled'}
    paperSize=${renderOptions.paperLayout.sizeDisplayValue}
    orientation=${renderOptions.paperOrientation.displayValue}
    logFile=${renderOptions.logToFile ? renderOptions.renderLogPath : 'disabled'}`,
    );

    let browser;

    try {
        const launchOptions = await resolveBrowserLaunchOptions(renderOptions.chromePath);

        browser = await puppeteer.launch({
            ...launchOptions,
            headless: true,
        });

        await logProgress(discoveredMessage);

        const renderedFiles = [];

        for (const [index, sourcePath] of sourceFiles.entries()) {
            const fileName = path.basename(sourcePath);
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

            await logProgress(`[${index + 1}/${sourceFiles.length}] Rendering ${fileName}`);
            if (htmlPath) {
                await fs.writeFile(htmlPath, html, 'utf8');
            }
            await renderPdf(browser, {
                html,
                pdfPath,
                documentLabel: htmlPath ? path.basename(htmlPath) : fileName,
            });
            await logProgress(`[${index + 1}/${sourceFiles.length}] Completed ${fileName} -> ${baseName}.pdf`);

            renderedFiles.push({
                title,
                fileName,
                pdfName: `${baseName}.pdf`,
                pdfPath,
                htmlPath,
                sourcePath,
            });
        }

        await logProgress(`Rendered ${renderedFiles.length} PDF file(s).`);

        const manifestPath = path.join(renderOptions.outputDir, 'README.md');
        await fs.writeFile(manifestPath, buildManifestMarkdown(renderedFiles), 'utf8');
        await logProgress(`Wrote manifest: ${manifestPath}`);
        await logProgress('Render finished successfully.');

        return buildResult({
            manifestPath,
            files: renderedFiles,
        });
    } catch (error) {
        await logProgress(`Render failed: ${formatError(error)}`);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function statInputPath(inputPath) {
    try {
        return await fs.stat(inputPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(`Input path does not exist: ${inputPath}`);
        }

        throw error;
    }
}

async function getMarkdownFiles(directoryPath) {
    const stats = await statInputPath(directoryPath);

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

async function getMarkdownFile(filePath) {
    const stats = await statInputPath(filePath);

    if (!stats.isFile()) {
        throw new Error(`Input path is not a file: ${filePath}`);
    }

    if (!filePath.endsWith('.md')) {
        throw new Error(`Input file is not a Markdown file: ${filePath}`);
    }

    return filePath;
}

function toTitle(fileName) {
    return fileName
        .replace(/\.md$/i, '')
        .replace(/^\d+-/, '')
        .split('-')
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
}
