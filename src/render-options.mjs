import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    extractTitle,
    resolvePaperLayout,
    resolvePaperOrientation,
} from './markdown-document.mjs';

export function resolveRenderOptions(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const inputDir = path.resolve(cwd, options.inputDir ?? options.input ?? '.');
    const outputDir = path.resolve(cwd, options.outputDir ?? options.output ?? '.');
    const htmlTarget = options.htmlDir ?? options.html ?? null;
    const htmlDir = htmlTarget ? path.resolve(cwd, htmlTarget) : null;
    const logToFile = Boolean(options.logToFile ?? options.logFile);
    const writeManifest = Boolean(options.writeManifest ?? options.manifest);
    const paperOrientation = resolvePaperOrientation(options.orientation);
    const paperLayout = resolvePaperLayout(options.paperSize, paperOrientation);

    return {
        inputDir,
        outputDir,
        htmlDir,
        chromePath: options.chromePath ?? null,
        logToFile,
        writeManifest,
        manifestPath: path.join(outputDir, 'README.md'),
        renderLogPath: path.join(outputDir, 'render.log'),
        onProgress: typeof options.onProgress === 'function' ? options.onProgress : async () => {},
        paperOrientation,
        paperLayout,
    };
}

export function resolveFileRenderOptions(options = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const inputFile = path.resolve(cwd, options.inputFile ?? options.input ?? '.');
    const outputDir = path.resolve(cwd, options.outputDir ?? options.output ?? '.');
    const htmlTarget = options.htmlDir ?? options.html ?? null;
    const htmlDir = htmlTarget ? path.resolve(cwd, htmlTarget) : null;
    const logToFile = Boolean(options.logToFile ?? options.logFile);
    const writeManifest = Boolean(options.writeManifest ?? options.manifest);
    const paperOrientation = resolvePaperOrientation(options.orientation);
    const paperLayout = resolvePaperLayout(options.paperSize, paperOrientation);
    const outputFileName = normalizePdfFileName(options.outputFileName ?? options.outputFile ?? null);

    return {
        inputFile,
        outputDir,
        outputFileName,
        htmlDir,
        chromePath: options.chromePath ?? null,
        logToFile,
        writeManifest,
        manifestPath: path.join(outputDir, 'README.md'),
        renderLogPath: path.join(outputDir, 'render.log'),
        onProgress: typeof options.onProgress === 'function' ? options.onProgress : async () => {},
        paperOrientation,
        paperLayout,
    };
}

export function resolveDocumentRenderOptions(options = {}) {
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

export function resolveStringRenderOptions(options = {}) {
    if (typeof options.markdown !== 'string') {
        throw new Error('renderMarkdownString requires a markdown string.');
    }

    const cwd = path.resolve(options.cwd ?? process.cwd());
    const outputDir = path.resolve(cwd, options.outputDir ?? options.output ?? '.');
    const htmlTarget = options.htmlDir ?? options.html ?? null;
    const htmlDir = htmlTarget ? path.resolve(cwd, htmlTarget) : null;
    const logToFile = Boolean(options.logToFile ?? options.logFile);
    const writeManifest = Boolean(options.writeManifest ?? options.manifest);
    const paperOrientation = resolvePaperOrientation(options.orientation);
    const paperLayout = resolvePaperLayout(options.paperSize, paperOrientation);
    const baseDir = path.resolve(cwd, options.baseDir ?? options.inputDir ?? '.');
    const fileName = normalizeMarkdownFileName(options.fileName ?? options.name ?? 'document.md');
    const outputFileName = normalizePdfFileName(options.outputFileName ?? options.outputFile ?? null);
    const title = options.title?.trim() || extractTitle(options.markdown) || 'Document';

    return {
        markdown: options.markdown,
        fileName,
        title,
        outputDir,
        outputFileName,
        htmlDir,
        chromePath: options.chromePath ?? null,
        logToFile,
        writeManifest,
        manifestPath: path.join(outputDir, 'README.md'),
        renderLogPath: path.join(outputDir, 'render.log'),
        onProgress: typeof options.onProgress === 'function' ? options.onProgress : async () => {},
        paperOrientation,
        paperLayout,
        baseHref: options.baseHref ?? toDirectoryHref(baseDir),
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
