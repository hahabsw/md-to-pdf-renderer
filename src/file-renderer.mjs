import fs from 'node:fs/promises';
import path from 'node:path';
import { buildManifestMarkdown } from './manifest.mjs';
import {
    createSourceEntry,
    formatError,
    getMarkdownFile,
    getMarkdownFiles,
    renderSourceToMemory,
    statInputPath,
} from './render-engine.mjs';
import {
    resolveFileRenderOptions,
    resolveRenderOptions,
    resolveStringRenderOptions,
    toDirectoryHref,
} from './render-options.mjs';
import { runWithBrowser } from './browser-renderer.mjs';

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

function assertNoOutputFileName(options, apiName) {
    if (options.outputFileName != null || options.outputFile != null) {
        throw new Error(`${apiName} does not support outputFileName for directory renders. Use a single Markdown input instead.`);
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

    try {
        const renderedFiles = await runWithBrowser(renderOptions.chromePath, async (browser) => {
            await logProgress(`Discovered ${sourceEntries.length} markdown file(s).`);

            const files = [];

            for (const [index, entry] of sourceEntries.entries()) {
                files.push(await renderSourceEntry({
                    browser,
                    entry,
                    baseHref,
                    renderOptions,
                    logProgress,
                    index,
                    totalEntries: sourceEntries.length,
                }));
            }

            return files;
        });

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
    }
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
    const rendered = await renderSourceToMemory({
        browser,
        entry,
        baseHref,
        renderOptions,
    });
    const outputPaths = buildOutputPaths(renderOptions, rendered.fileName, rendered.pdfName);

    await logProgress(`[${index + 1}/${totalEntries}] Rendering ${rendered.fileName}`);

    if (outputPaths.htmlPath) {
        await fs.writeFile(outputPaths.htmlPath, rendered.html, 'utf8');
    }

    await fs.writeFile(outputPaths.pdfPath, rendered.pdf);

    await logProgress(`[${index + 1}/${totalEntries}] Completed ${rendered.fileName} -> ${outputPaths.pdfName}`);

    return {
        title: rendered.title,
        fileName: rendered.fileName,
        pdfName: outputPaths.pdfName,
        pdfPath: outputPaths.pdfPath,
        htmlPath: outputPaths.htmlPath,
        sourcePath: rendered.sourcePath,
    };
}

function buildOutputPaths(renderOptions, fileName, pdfName) {
    const htmlName = `${pdfName.replace(/\.pdf$/i, '')}.html`;
    const htmlPath = renderOptions.htmlDir ? path.join(renderOptions.htmlDir, htmlName) : null;

    return {
        pdfName,
        pdfPath: path.join(renderOptions.outputDir, pdfName),
        htmlPath,
    };
}
