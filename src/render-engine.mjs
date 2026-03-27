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
    resolveStringRenderOptions,
    toDirectoryHref,
} from './render-options.mjs';

/**
 * @typedef {Object} RenderedFile
 * @property {string} title Human-readable document title used in the manifest.
 * @property {string} fileName Source Markdown file name.
 * @property {string} pdfName Output PDF file name.
 * @property {string} pdfPath Absolute path to the generated PDF file.
 * @property {string | null} htmlPath Absolute path to the generated HTML file when `htmlDir` is enabled.
 * @property {string | null} sourcePath Absolute path to the source Markdown file, or `null` for in-memory Markdown.
 */

/**
 * @typedef {Object} RenderDirectoryResult
 * @property {string} inputDir Absolute input directory path.
 * @property {string} outputDir Absolute output directory path.
 * @property {string | null} htmlDir Absolute HTML output directory path when enabled.
 * @property {string | null} manifestPath Absolute path to the generated output manifest when enabled.
 * @property {string | null} renderLogPath Absolute path to the render log when `logFile` is enabled.
 * @property {RenderedFile[]} files Rendered output metadata for each Markdown file.
 */

/**
 * @typedef {Object} RenderFileResult
 * @property {string} inputFile Absolute input file path.
 * @property {string} outputDir Absolute output directory path.
 * @property {string | null} htmlDir Absolute HTML output directory path when enabled.
 * @property {string | null} manifestPath Absolute path to the generated output manifest when enabled.
 * @property {string | null} renderLogPath Absolute path to the render log when `logFile` is enabled.
 * @property {RenderedFile} file Rendered output metadata for the Markdown file.
 */

/**
 * @typedef {Object} RenderStringResult
 * @property {string} fileName Virtual source file name used for output naming and manifest entries.
 * @property {string} outputDir Absolute output directory path.
 * @property {string | null} htmlDir Absolute HTML output directory path when enabled.
 * @property {string | null} manifestPath Absolute path to the generated output manifest when enabled.
 * @property {string | null} renderLogPath Absolute path to the render log when `logFile` is enabled.
 * @property {RenderedFile} file Rendered output metadata for the Markdown content.
 */

/**
 * Render every top-level Markdown file in a directory into PDF files.
 *
 * Paths may be absolute or relative to `cwd`. By default the renderer writes
 * PDFs into the current working directory, skips intermediate HTML files and manifests by default, and logs
 * progress through `onProgress` only.
 *
 * @param {Object} [options={}]
 * @param {string} [options.cwd=process.cwd()] Base directory used to resolve relative paths.
 * @param {string} [options.inputDir]
 * @param {string} [options.input] Alias for `inputDir`.
 * @param {string} [options.outputDir] Output directory. Defaults to the current working directory.
 * @param {string} [options.output] Alias for `outputDir`.
 * @param {string | null} [options.htmlDir]
 * @param {string | null} [options.html] Alias for `htmlDir`.
 * @param {boolean} [options.writeManifest=false]
 * @param {boolean} [options.manifest=false] Alias for `writeManifest`.
 * @param {string} [options.paperSize='A4'] Paper size such as `A4`, `Letter`, or `210mm 297mm`.
 * @param {string} [options.orientation='portrait'] Page orientation, either `portrait` or `landscape`.
 * @param {boolean} [options.logToFile=false]
 * @param {boolean} [options.logFile=false] Alias for `logToFile`.
 * @param {string | null} [options.chromePath=null] Optional Chrome or Chromium executable path.
 * @param {(message: string) => (void | Promise<void>)} [options.onProgress] Callback invoked for each progress message.
 * @returns {Promise<RenderDirectoryResult>}
 */
export async function renderMarkdownDirectory(options = {}) {
    assertNoOutputFileName(options, 'renderMarkdownDirectory');
    const renderOptions = resolveRenderOptions(options);
    const files = await getMarkdownFiles(renderOptions.inputDir);

    return renderMarkdownSources({
        renderOptions,
        inputLabel: renderOptions.inputDir,
        sourceEntries: files.map((fileName) => createSourceEntry({
            fileName,
            sourcePath: path.join(renderOptions.inputDir, fileName),
        })),
        baseHref: toDirectoryHref(renderOptions.inputDir),
        buildResult: ({ manifestPath, files: renderedFiles }) => ({
            ...createResultMeta(renderOptions, manifestPath),
            inputDir: renderOptions.inputDir,
            files: renderedFiles,
        }),
    });
}

/**
 * Render a single Markdown file into PDF output.
 *
 * Paths may be absolute or relative to `cwd`. The PDF file is written into
 * `outputDir` using the Markdown file name. Manifest output is optional.
 *
 * @param {Object} [options={}]
 * @param {string} [options.cwd=process.cwd()] Base directory used to resolve relative paths.
 * @param {string} [options.inputFile]
 * @param {string} [options.input] Alias for `inputFile`.
 * @param {string} [options.outputDir] Output directory. Defaults to the current working directory.
 * @param {string} [options.output] Alias for `outputDir`.
 * @param {string} [options.outputFileName] Optional PDF file name for the rendered output.
 * @param {string} [options.outputFile] Alias for `outputFileName`.
 * @param {string | null} [options.htmlDir]
 * @param {string | null} [options.html] Alias for `htmlDir`.
 * @param {boolean} [options.writeManifest=false]
 * @param {boolean} [options.manifest=false] Alias for `writeManifest`.
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
        sourceEntries: [createSourceEntry({
            fileName: path.basename(sourceFile),
            sourcePath: sourceFile,
            outputFileName: renderOptions.outputFileName,
        })],
        baseHref: toDirectoryHref(path.dirname(sourceFile)),
        buildResult: ({ manifestPath, files: renderedFiles }) => ({
            ...createResultMeta(renderOptions, manifestPath),
            inputFile: renderOptions.inputFile,
            file: renderedFiles[0],
        }),
    });
}

/**
 * Render Markdown content supplied as a string into PDF output.
 *
 * This API is useful when Markdown comes from memory rather than from a file.
 * A virtual `fileName` is used to derive output file names and optional manifest entries.
 *
 * @param {Object} options
 * @param {string} options.markdown Markdown source to render.
 * @param {string} [options.title] Optional document title. Defaults to the first `# Heading` or `Document`.
 * @param {string} [options.fileName='document.md'] Virtual Markdown file name used for output naming.
 * @param {string} [options.name] Alias for `fileName`.
 * @param {string} [options.cwd=process.cwd()] Base directory used to resolve relative paths.
 * @param {string} [options.baseDir='.'] Base directory used for relative asset links when `baseHref` is omitted.
 * @param {string} [options.inputDir] Alias for `baseDir`.
 * @param {string} [options.baseHref] Explicit `<base href>` value for generated HTML.
 * @param {string} [options.outputDir] Output directory. Defaults to the current working directory.
 * @param {string} [options.output] Alias for `outputDir`.
 * @param {string} [options.outputFileName] Optional PDF file name for the rendered output.
 * @param {string} [options.outputFile] Alias for `outputFileName`.
 * @param {string | null} [options.htmlDir]
 * @param {string | null} [options.html] Alias for `htmlDir`.
 * @param {boolean} [options.writeManifest=false]
 * @param {boolean} [options.manifest=false] Alias for `writeManifest`.
 * @param {string} [options.paperSize='A4'] Paper size such as `A4`, `Letter`, or `210mm 297mm`.
 * @param {string} [options.orientation='portrait'] Page orientation, either `portrait` or `landscape`.
 * @param {boolean} [options.logToFile=false]
 * @param {boolean} [options.logFile=false] Alias for `logToFile`.
 * @param {string | null} [options.chromePath=null] Optional Chrome or Chromium executable path.
 * @param {(message: string) => (void | Promise<void>)} [options.onProgress] Callback invoked for each progress message.
 * @returns {Promise<RenderStringResult>}
 */
export async function renderMarkdownString(options = {}) {
    const renderOptions = resolveStringRenderOptions(options);

    return renderMarkdownSources({
        renderOptions,
        inputLabel: '[markdown string]',
        sourceEntries: [createSourceEntry({
            fileName: renderOptions.fileName,
            sourcePath: null,
            markdown: renderOptions.markdown,
            title: renderOptions.title,
            outputFileName: renderOptions.outputFileName,
        })],
        baseHref: renderOptions.baseHref,
        buildResult: ({ manifestPath, files: renderedFiles }) => ({
            ...createResultMeta(renderOptions, manifestPath),
            fileName: renderOptions.fileName,
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
 * @param {string} [options.outputFileName] Optional PDF file name when `input` resolves to a single Markdown file.
 * @param {string} [options.outputFile] Alias for `outputFileName`.
 * @param {boolean} [options.writeManifest=false]
 * @param {boolean} [options.manifest=false] Alias for `writeManifest`.
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

function assertNoOutputFileName(options, apiName) {
    if (options.outputFileName != null || options.outputFile != null) {
        throw new Error(`${apiName} does not support outputFileName. Use renderMarkdownFile, renderMarkdownString, or renderMarkdownPath with a single Markdown file.`);
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

async function renderMarkdownSources({
    renderOptions,
    inputLabel,
    sourceEntries,
    baseHref,
    buildResult,
}) {
    const logProgress = createLogger(renderOptions);

    await prepareOutputDirectories(renderOptions);

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

        await logProgress(`Discovered ${sourceEntries.length} markdown file(s).`);

        const renderedFiles = [];

        for (const [index, entry] of sourceEntries.entries()) {
            renderedFiles.push(await renderSourceEntry({
                browser,
                entry,
                baseHref,
                renderOptions,
                logProgress,
                index,
                totalEntries: sourceEntries.length,
            }));
        }

        await logProgress(`Rendered ${renderedFiles.length} PDF file(s).`);

        const manifestPath = renderOptions.writeManifest ? renderOptions.manifestPath : null;

        if (manifestPath) {
            await fs.writeFile(manifestPath, buildManifestMarkdown(renderedFiles), 'utf8');
            await logProgress(`Wrote manifest: ${manifestPath}`);
        }

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

function createSourceEntry({
    fileName,
    sourcePath = null,
    markdown,
    title,
    outputFileName,
}) {
    return {
        fileName,
        sourcePath,
        markdown,
        title,
        outputFileName,
    };
}

function createResultMeta(renderOptions, manifestPath) {
    return {
        outputDir: renderOptions.outputDir,
        htmlDir: renderOptions.htmlDir,
        manifestPath,
        renderLogPath: renderOptions.logToFile ? renderOptions.renderLogPath : null,
    };
}

async function prepareOutputDirectories(renderOptions) {
    await fs.mkdir(renderOptions.outputDir, { recursive: true });

    if (renderOptions.htmlDir) {
        await fs.mkdir(renderOptions.htmlDir, { recursive: true });
    }

    if (renderOptions.logToFile) {
        await fs.writeFile(renderOptions.renderLogPath, '', 'utf8');
    }
}

async function renderSourceEntry({
    browser,
    entry,
    baseHref,
    renderOptions,
    logProgress,
    index,
    totalEntries,
}) {
    const fileName = entry.fileName;
    const sourcePath = entry.sourcePath ?? null;
    const markdown = typeof entry.markdown === 'string'
        ? entry.markdown
        : await fs.readFile(sourcePath, 'utf8');
    const title = entry.title ?? extractTitle(markdown) ?? toTitle(fileName);
    const outputPaths = buildOutputPaths(renderOptions, fileName, entry.outputFileName);
    const html = await renderMarkdownDocument({
        markdown,
        title,
        baseHref,
        paperLayout: renderOptions.paperLayout,
    });

    await logProgress(`[${index + 1}/${totalEntries}] Rendering ${fileName}`);

    if (outputPaths.htmlPath) {
        await fs.writeFile(outputPaths.htmlPath, html, 'utf8');
    }

    await renderPdf(browser, {
        html,
        pdfPath: outputPaths.pdfPath,
        documentLabel: outputPaths.documentLabel,
    });

    await logProgress(`[${index + 1}/${totalEntries}] Completed ${fileName} -> ${outputPaths.pdfName}`);

    return {
        title,
        fileName,
        pdfName: outputPaths.pdfName,
        pdfPath: outputPaths.pdfPath,
        htmlPath: outputPaths.htmlPath,
        sourcePath,
    };
}

function buildOutputPaths(renderOptions, fileName, outputFileName) {
    const defaultBaseName = fileName.replace(/\.md$/i, '');
    const pdfName = outputFileName ?? `${defaultBaseName}.pdf`;
    const htmlName = `${pdfName.replace(/\.pdf$/i, '')}.html`;
    const htmlPath = renderOptions.htmlDir ? path.join(renderOptions.htmlDir, htmlName) : null;

    return {
        pdfName,
        pdfPath: path.join(renderOptions.outputDir, pdfName),
        htmlPath,
        documentLabel: htmlPath ? path.basename(htmlPath) : fileName,
    };
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
