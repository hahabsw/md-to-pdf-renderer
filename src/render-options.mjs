import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    extractTitle,
    resolvePaperLayout,
    resolvePaperOrientation,
} from './markdown-document.mjs';

export function resolveRenderOptions(options = {}) {
    const cwd = resolveCwd(options);
    const renderRuntime = resolveRenderRuntimeOptions(options, cwd);

    return {
        inputDir: resolvePathOption(cwd, options.inputDir ?? options.input ?? '.'),
        ...renderRuntime,
    };
}

export function resolveFileRenderOptions(options = {}) {
    const cwd = resolveCwd(options);
    const renderRuntime = resolveRenderRuntimeOptions(options, cwd);

    return {
        inputFile: resolvePathOption(cwd, options.inputFile ?? options.input ?? '.'),
        outputFileName: normalizePdfFileName(options.outputFileName ?? options.outputFile ?? null),
        ...renderRuntime,
    };
}

export function resolveDocumentRenderOptions(options = {}) {
    if (typeof options.markdown !== 'string') {
        throw new Error('renderMarkdownToHtml requires a markdown string.');
    }

    const cwd = resolveCwd(options);
    const title = options.title?.trim() || extractTitle(options.markdown) || 'Document';
    const paperLayout = resolvePaperLayout(options.paperSize, resolvePaperOrientation(options.orientation));

    return {
        markdown: options.markdown,
        title,
        cwd,
        baseHref: options.baseHref ?? toDirectoryHref(resolvePathOption(cwd, options.baseDir ?? options.inputDir ?? '.')),
        paperLayout,
        css: options.cssPath ?? options.css ?? null,
    };
}

export function resolveStringRenderOptions(options = {}) {
    if (typeof options.markdown !== 'string') {
        throw new Error('renderMarkdownString requires a markdown string.');
    }

    const cwd = resolveCwd(options);
    const renderRuntime = resolveRenderRuntimeOptions(options, cwd);

    return {
        markdown: options.markdown,
        fileName: normalizeMarkdownFileName(options.fileName ?? options.name ?? 'document.md'),
        title: options.title?.trim() || extractTitle(options.markdown) || 'Document',
        outputFileName: normalizePdfFileName(options.outputFileName ?? options.outputFile ?? null),
        baseHref: options.baseHref ?? toDirectoryHref(resolvePathOption(cwd, options.baseDir ?? options.inputDir ?? '.')),
        ...renderRuntime,
    };
}

export function toDirectoryHref(directoryPath) {
    const href = pathToFileURL(directoryPath).href;
    return href.endsWith('/') ? href : `${href}/`;
}

function normalizeMarkdownFileName(value) {
    const trimmed = String(value).trim();

    if (!trimmed) {
        return 'document.md';
    }

    return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
}

function normalizePdfFileName(value) {
    if (value == null) {
        return null;
    }

    const trimmed = String(value).trim();

    if (!trimmed) {
        return null;
    }

    return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

function resolveCwd(options) {
    return path.resolve(options.cwd ?? process.cwd());
}

function resolveRenderRuntimeOptions(options, cwd) {
    const outputDir = resolvePathOption(cwd, options.outputDir ?? options.output ?? '.');
    const htmlDir = resolveOptionalPathOption(cwd, options.htmlDir ?? options.html ?? null);
    const paperOrientation = resolvePaperOrientation(options.orientation);

    return {
        cwd,
        outputDir,
        htmlDir,
        css: options.cssPath ?? options.css ?? null,
        chromePath: options.chromePath ?? null,
        logToFile: Boolean(options.logToFile ?? options.logFile),
        writeManifest: Boolean(options.writeManifest ?? options.manifest),
        manifestPath: path.join(outputDir, 'README.md'),
        renderLogPath: path.join(outputDir, 'render.log'),
        onProgress: typeof options.onProgress === 'function' ? options.onProgress : noopProgress,
        paperOrientation,
        paperLayout: resolvePaperLayout(options.paperSize, paperOrientation),
    };
}

function resolvePathOption(cwd, value) {
    return path.resolve(cwd, value);
}

function resolveOptionalPathOption(cwd, value) {
    return value ? resolvePathOption(cwd, value) : null;
}

async function noopProgress() {}
