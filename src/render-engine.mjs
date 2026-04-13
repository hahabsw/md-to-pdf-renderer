import path from 'node:path';
import {
    extractTitle,
    renderMarkdownDocument,
} from './markdown-document.mjs';
import { renderPdfBuffer, runWithBrowser } from './browser-renderer.mjs';
import {
    resolveDocumentRenderOptions,
    resolveFileRenderOptions,
    resolveStringRenderOptions,
    toDirectoryHref,
} from './render-options.mjs';

/**
 * @typedef {Object} RenderedPdfBuffer
 * @property {string} title Human-readable document title.
 * @property {string} fileName Source or virtual Markdown file name.
 * @property {string} pdfName Output PDF file name.
 * @property {Uint8Array} pdf PDF binary data.
 * @property {string} html HTML document used to render the PDF.
 * @property {string | null} sourcePath Absolute path to the source Markdown file, or `null` for in-memory Markdown.
 */

/**
 * @typedef {Object} RenderFileToPdfResult
 * @property {string} inputFile Absolute input file path.
 * @property {RenderedPdfBuffer} file Rendered PDF binary and metadata for the Markdown file.
 */

/**
 * @typedef {Object} RenderStringToPdfResult
 * @property {string} fileName Virtual source file name used for output naming.
 * @property {RenderedPdfBuffer} file Rendered PDF binary and metadata for the Markdown content.
 */

/**
 * Render a single HTML document into PDF binary data.
 *
 * This function does not write files. It is intended for library consumers that
 * want to handle the resulting bytes in memory.
 *
 * @param {Object} options
 * @param {string} options.html HTML document to render.
 * @param {string} [options.documentLabel='document.html'] Label used in render errors.
 * @param {string | null} [options.chromePath=null] Optional Chrome or Chromium executable path.
 * @returns {Promise<Uint8Array>}
 */
export async function renderHtmlToPdf(options = {}) {
    if (typeof options.html !== 'string') {
        throw new Error('renderHtmlToPdf requires an html string.');
    }

    return runWithBrowser(options.chromePath ?? null, (browser) => renderPdfBuffer(browser, {
        html: options.html,
        documentLabel: options.documentLabel ?? 'document.html',
        waitForReadySignal: false,
    }), {
        onWarning: options.onWarning,
    });
}

/**
 * Render a single Markdown file into PDF binary data without writing files.
 *
 * @param {Object} [options={}]
 * @param {string} [options.cwd=process.cwd()] Base directory used to resolve relative paths.
 * @param {string} [options.inputFile]
 * @param {string} [options.input] Alias for `inputFile`.
 * @param {string} [options.outputFileName] Optional PDF file name for metadata purposes.
 * @param {string} [options.outputFile] Alias for `outputFileName`.
 * @param {string} [options.cssPath]
 * @param {string} [options.css] Alias for `cssPath`.
 * @param {string | null} [options.chromePath=null] Optional Chrome or Chromium executable path.
 * @param {string} [options.paperSize='A4'] Paper size such as `A4`, `Letter`, or `210mm 297mm`.
 * @param {string} [options.orientation='portrait'] Page orientation, either `portrait` or `landscape`.
 * @param {string} [options.fontSizePreset='m'] Overall typography preset: `xs`, `s`, `m`, `l`, `lg`, or `xl`.
 * @param {string} [options.fontSize] Alias for `fontSizePreset`.
 * @returns {Promise<RenderFileToPdfResult>}
 */
export async function renderMarkdownFileToPdf(options = {}) {
    const renderOptions = resolveFileRenderOptions(options);
    const sourceFile = await getMarkdownFile(renderOptions.inputFile);
    const entry = createSourceEntry({
        fileName: path.basename(sourceFile),
        sourcePath: sourceFile,
        outputFileName: renderOptions.outputFileName,
    });

    return runWithBrowser(renderOptions.chromePath, async (browser) => ({
        inputFile: renderOptions.inputFile,
        file: await renderSourceToMemory({
            browser,
            entry,
            baseHref: toDirectoryHref(path.dirname(sourceFile)),
            renderOptions,
        }),
    }), {
        onWarning: renderOptions.onWarning,
    });
}

/**
 * Render Markdown content supplied as a string into PDF binary data without writing files.
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
 * @param {string} [options.outputFileName] Optional PDF file name for metadata purposes.
 * @param {string} [options.outputFile] Alias for `outputFileName`.
 * @param {string} [options.cssPath]
 * @param {string} [options.css] Alias for `cssPath`.
 * @param {string | null} [options.chromePath=null] Optional Chrome or Chromium executable path.
 * @param {string} [options.paperSize='A4'] Paper size such as `A4`, `Letter`, or `210mm 297mm`.
 * @param {string} [options.orientation='portrait'] Page orientation, either `portrait` or `landscape`.
 * @param {string} [options.fontSizePreset='m'] Overall typography preset: `xs`, `s`, `m`, `l`, `lg`, or `xl`.
 * @param {string} [options.fontSize] Alias for `fontSizePreset`.
 * @returns {Promise<RenderStringToPdfResult>}
 */
export async function renderMarkdownStringToPdf(options = {}) {
    const renderOptions = resolveStringRenderOptions(options);
    const entry = createSourceEntry({
        fileName: renderOptions.fileName,
        sourcePath: null,
        markdown: renderOptions.markdown,
        title: renderOptions.title,
        outputFileName: renderOptions.outputFileName,
    });

    return runWithBrowser(renderOptions.chromePath, async (browser) => ({
        fileName: renderOptions.fileName,
        file: await renderSourceToMemory({
            browser,
            entry,
            baseHref: renderOptions.baseHref,
            renderOptions,
        }),
    }), {
        onWarning: renderOptions.onWarning,
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
 * @param {string} [options.cssPath]
 * @param {string} [options.css] Alias for `cssPath`.
 * @param {string} [options.paperSize='A4'] Paper size such as `A4`, `Letter`, or `210mm 297mm`.
 * @param {string} [options.orientation='portrait'] Page orientation, either `portrait` or `landscape`.
 * @param {string} [options.fontSizePreset='m'] Overall typography preset: `xs`, `s`, `m`, `l`, `lg`, or `xl`.
 * @param {string} [options.fontSize] Alias for `fontSizePreset`.
 * @returns {Promise<string>}
 */
export async function renderMarkdownToHtml(options) {
    const renderOptions = resolveDocumentRenderOptions(options);

    return renderMarkdownDocument({
        markdown: renderOptions.markdown,
        title: renderOptions.title,
        baseHref: renderOptions.baseHref,
        paperLayout: renderOptions.paperLayout,
        fontSizePreset: renderOptions.fontSizePreset,
        cssOverride: await resolveCssOverride(renderOptions.css, renderOptions.cwd),
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

export function createSourceEntry({
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

export async function renderSourceToMemory({
    browser,
    entry,
    baseHref,
    renderOptions,
}) {
    const sourcePath = entry.sourcePath ?? null;
    const markdown = typeof entry.markdown === 'string'
        ? entry.markdown
        : await readFileUtf8(sourcePath);
    const title = entry.title ?? extractTitle(markdown) ?? toTitle(entry.fileName);
    const pdfName = resolvePdfName(entry.fileName, entry.outputFileName);
    const html = await renderMarkdownDocument({
        markdown,
        title,
        baseHref,
        paperLayout: renderOptions.paperLayout,
        fontSizePreset: renderOptions.fontSizePreset,
        cssOverride: await resolveCssOverride(renderOptions.css, renderOptions.cwd),
    });
    const pdf = await renderPdfBuffer(browser, {
        html,
        documentLabel: entry.fileName,
    });

    return {
        title,
        fileName: entry.fileName,
        pdfName,
        pdf,
        html,
        sourcePath,
    };
}

export function resolvePdfName(fileName, outputFileName) {
    const defaultBaseName = fileName.replace(/\.md$/i, '');
    return outputFileName ?? `${defaultBaseName}.pdf`;
}

export async function statInputPath(inputPath) {
    try {
        return await statFile(inputPath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(`Input path does not exist: ${inputPath}`);
        }

        throw error;
    }
}

export async function getMarkdownFiles(directoryPath) {
    const stats = await statInputPath(directoryPath);

    if (!stats.isDirectory()) {
        throw new Error(`Input path is not a directory: ${directoryPath}`);
    }

    const entries = await readDirectory(directoryPath);

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

export async function getMarkdownFile(filePath) {
    const stats = await statInputPath(filePath);

    if (!stats.isFile()) {
        throw new Error(`Input path is not a file: ${filePath}`);
    }

    if (!filePath.endsWith('.md')) {
        throw new Error(`Input file is not a Markdown file: ${filePath}`);
    }

    return filePath;
}

export function toTitle(fileName) {
    return fileName
        .replace(/\.md$/i, '')
        .replace(/^\d+-/, '')
        .split('-')
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
}

async function readFileUtf8(filePath) {
    const { readFile } = await import('node:fs/promises');
    return readFile(filePath, 'utf8');
}

async function resolveCssOverride(cssOption, cwd) {
    if (cssOption == null) {
        return '';
    }

    const cssValue = String(cssOption);

    if (!cssValue.trim()) {
        return '';
    }

    const candidatePath = path.resolve(cwd, cssValue);

    try {
        const stats = await statFile(candidatePath);

        if (!stats.isFile()) {
            throw new Error(`CSS path is not a file: ${candidatePath}`);
        }

        return readFileUtf8(candidatePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return cssValue;
        }

        throw error;
    }
}

async function statFile(filePath) {
    const { stat } = await import('node:fs/promises');
    return stat(filePath);
}

async function readDirectory(directoryPath) {
    const { readdir } = await import('node:fs/promises');
    return readdir(directoryPath, { withFileTypes: true });
}
