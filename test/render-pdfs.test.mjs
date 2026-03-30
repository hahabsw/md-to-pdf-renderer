import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
    formatError,
    getHelpText,
    main,
    parseArgs,
    renderHtmlToPdf,
    renderMarkdownFileToPdf,
    renderMarkdownStringToPdf,
    renderMarkdownToHtml,
} from '../src/render-pdfs.mjs';
import * as publicApi from '../src/render-pdfs.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, 'bin', 'md-to-pdf-renderer.mjs');
const fixtureInputDir = path.join(repoRoot, 'fixtures', 'readme-showcase');
const fixtureInputFile = path.join(fixtureInputDir, 'rendering-showcase.md');

async function createTempDir() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'md-to-pdf-renderer-test-'));
}

async function runCli(args, options = {}) {
    try {
        const result = await execFileAsync(process.execPath, [cliPath, ...args], {
            cwd: repoRoot,
            timeout: options.timeout ?? 120_000,
            maxBuffer: 10 * 1024 * 1024,
        });

        return {
            code: 0,
            stdout: result.stdout,
            stderr: result.stderr,
        };
    } catch (error) {
        return {
            code: error.code ?? 1,
            stdout: error.stdout ?? '',
            stderr: error.stderr ?? '',
        };
    }
}

test('prints help text', async () => {
    const result = await runCli(['--help']);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /--html <dir>/);
    assert.match(result.stdout, /--manifest/);
    assert.match(result.stdout, /--css <path>/);
    assert.match(result.stdout, /--input <path>/);
    assert.match(result.stdout, /Default: disabled/);
});

test('exports help text for library consumers', () => {
    const helpText = getHelpText();

    assert.match(helpText, /md-to-pdf-renderer/);
    assert.match(helpText, /optional HTML output/);
});

test('exports only memory-oriented library rendering APIs', () => {
    assert.equal('renderMarkdownDirectory' in publicApi, false);
    assert.equal('renderMarkdownFile' in publicApi, false);
    assert.equal('renderMarkdownPath' in publicApi, false);
    assert.equal('renderMarkdownString' in publicApi, false);
    assert.equal(typeof publicApi.renderMarkdownFileToPdf, 'function');
    assert.equal(typeof publicApi.renderMarkdownStringToPdf, 'function');
    assert.equal(typeof publicApi.renderHtmlToPdf, 'function');
});

test('parses CLI arguments for programmatic consumers', () => {
    const args = parseArgs([
        '--input', 'docs',
        '--output', 'out',
        '--output-file', 'guide.pdf',
        '--html', 'out/html',
        '--manifest',
        '--css', 'styles/print.css',
        '--paper-size', 'Letter',
        '--orientation', 'landscape',
        '--chrome-path', '/usr/bin/chromium',
        '--log-file',
    ]);

    assert.deepEqual(args, {
        input: 'docs',
        output: 'out',
        outputFile: 'guide.pdf',
        html: 'out/html',
        manifest: true,
        css: 'styles/print.css',
        paperSize: 'Letter',
        orientation: 'landscape',
        chromePath: '/usr/bin/chromium',
        logFile: true,
    });
});

test('formats Error and non-Error values consistently', () => {
    assert.equal(formatError(new Error('boom')), 'boom');
    assert.equal(formatError('plain failure'), 'plain failure');
});

test('renders PDFs without creating HTML files or a manifest by default', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');

    try {
        const result = await runCli(['--input', fixtureInputDir, '--output', outputDir]);

        assert.equal(result.code, 0, result.stderr || result.stdout);

        const pdfPath = path.join(outputDir, 'rendering-showcase.pdf');
        const htmlDirPath = path.join(outputDir, 'html');

        const pdfStat = await fs.stat(pdfPath);
        assert.ok(pdfStat.size > 0);
        await assert.rejects(fs.stat(path.join(outputDir, 'README.md')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(htmlDirPath), { code: 'ENOENT' });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('writes outputs to the current working directory without a manifest when output is omitted', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();

    try {
        const exitCode = await main(
            ['--input', fixtureInputFile],
            {
                cwd: tempDir,
                stdout: { write: () => {} },
                stderr: { write: () => {} },
            },
        );

        assert.equal(exitCode, 0);

        const pdfPath = path.join(tempDir, 'rendering-showcase.pdf');
        const htmlDirPath = path.join(tempDir, 'html');

        const pdfStat = await fs.stat(pdfPath);

        assert.ok(pdfStat.size > 0);
        await assert.rejects(fs.stat(path.join(tempDir, 'README.md')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(htmlDirPath), { code: 'ENOENT' });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('renders a single Markdown file through the CLI', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');

    try {
        const result = await runCli(['--input', fixtureInputFile, '--output', outputDir]);

        assert.equal(result.code, 0, result.stderr || result.stdout);

        const pdfPath = path.join(outputDir, 'rendering-showcase.pdf');
        const pdfStat = await fs.stat(pdfPath);

        assert.ok(pdfStat.size > 0);
        await assert.rejects(fs.stat(path.join(outputDir, 'README.md')), { code: 'ENOENT' });
        assert.match(result.stdout, /Discovered 1 markdown file\(s\)\./);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('uses a custom output PDF name for single-file CLI renders', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');

    try {
        const result = await runCli([
            '--input',
            fixtureInputFile,
            '--output',
            outputDir,
            '--output-file',
            'custom-guide.pdf',
        ]);

        assert.equal(result.code, 0, result.stderr || result.stdout);

        const pdfPath = path.join(outputDir, 'custom-guide.pdf');
        const pdfStat = await fs.stat(pdfPath);

        assert.ok(pdfStat.size > 0);
        await assert.rejects(fs.stat(path.join(outputDir, 'README.md')), { code: 'ENOENT' });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('writes a custom single-file PDF into the current working directory when output is omitted', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();

    try {
        const exitCode = await main(
            ['--input', fixtureInputFile, '--output-file', 'guide-v2.pdf'],
            {
                cwd: tempDir,
                stdout: { write: () => {} },
                stderr: { write: () => {} },
            },
        );

        assert.equal(exitCode, 0);

        const pdfPath = path.join(tempDir, 'guide-v2.pdf');
        const pdfStat = await fs.stat(pdfPath);

        assert.ok(pdfStat.size > 0);
        await assert.rejects(fs.stat(path.join(tempDir, 'README.md')), { code: 'ENOENT' });
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('writes a manifest only when requested through the CLI', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');

    try {
        const result = await runCli(['--input', fixtureInputDir, '--output', outputDir, '--manifest']);

        assert.equal(result.code, 0, result.stderr || result.stdout);

        const manifestPath = path.join(outputDir, 'README.md');
        const manifest = await fs.readFile(manifestPath, 'utf8');

        assert.match(manifest, /# PDF Outputs/);
        assert.match(manifest, /Generated:/);
        assert.match(manifest, /rendering-showcase\.pdf/);
        assert.match(manifest, /source:/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('writes optional HTML and render logs when requested', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');
    const htmlDir = path.join(outputDir, 'html');

    try {
        const result = await runCli([
            '--input',
            fixtureInputDir,
            '--output',
            outputDir,
            '--html',
            htmlDir,
            '--log-file',
        ]);

        assert.equal(result.code, 0, result.stderr || result.stdout);

        const htmlPath = path.join(htmlDir, 'rendering-showcase.html');
        const logPath = path.join(outputDir, 'render.log');
        const html = await fs.readFile(htmlPath, 'utf8');
        const log = await fs.readFile(logPath, 'utf8');

        assert.match(html, /<!doctype html>/i);
        assert.match(html, /class="mermaid"/);
        assert.match(html, /katex/i);
        assert.match(log, /Render started\./);
        assert.match(log, /html=.*output\/html/);
        assert.match(log, /css=disabled/);
        assert.match(log, /Render finished successfully\./);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('renders HTML through the library API without side effects', async () => {
    const markdown = [
        '# API Sample',
        '',
        '[[TOC]]',
        '',
        '## Diagram',
        '',
        '```mermaid',
        'flowchart TD',
        '  A[Markdown] --> B[PDF]',
        '```',
        '',
        'Inline math: $E = mc^2$.',
    ].join('\n');

    const html = await renderMarkdownToHtml({
        markdown,
        title: 'API Sample',
        baseDir: fixtureInputDir,
    });

    assert.match(html, /<title>API Sample<\/title>/);
    assert.match(html, /class="toc"/);
    assert.match(html, /class="mermaid"/);
    assert.match(html, /katex/i);
});

test('renders HTML through the library API with computed defaults', async () => {
    const html = await renderMarkdownToHtml({
        markdown: '# Derived Title\n\n## Section',
        baseDir: fixtureInputDir,
    });

    assert.match(html, /<title>Derived Title<\/title>/);
    assert.match(html, /<h2 id="section">Section<\/h2>/);
});

test('applies CSS overrides from a provided file path', async () => {
    const tempDir = await createTempDir();
    const cssPath = path.join(tempDir, 'override.css');

    try {
        await fs.writeFile(cssPath, 'body { color: rgb(1, 2, 3); }\n.code-card { border-width: 5px; }', 'utf8');

        const html = await renderMarkdownToHtml({
            markdown: '# Styled Title\n\n```js\nconsole.log("hi");\n```',
            baseDir: fixtureInputDir,
            cssPath,
        });

        assert.match(html, /body \{ color: rgb\(1, 2, 3\); \}/);
        assert.match(html, /\.code-card \{ border-width: 5px; \}/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('rejects invalid programmatic HTML render input', async () => {
    await assert.rejects(
        renderMarkdownToHtml({ title: 'Missing Markdown' }),
        /renderMarkdownToHtml requires a markdown string\./,
    );
});

test('renders PDF bytes from an HTML string through the library API', { timeout: 120_000 }, async () => {
    const pdf = await renderHtmlToPdf({
        html: '<!doctype html><html><head><title>Buffer Test</title></head><body><h1>Hello</h1></body></html>',
        documentLabel: 'buffer-test.html',
    });

    assert.ok(pdf instanceof Uint8Array);
    assert.ok(pdf.length > 0);
    assert.equal(Buffer.from(pdf).subarray(0, 4).toString('ascii'), '%PDF');
});

test('rejects invalid HTML to PDF render input', async () => {
    await assert.rejects(
        renderHtmlToPdf({ documentLabel: 'missing.html' }),
        /renderHtmlToPdf requires an html string\./,
    );
});

test('renders PDFs from a Markdown string to memory through the library API', { timeout: 120_000 }, async () => {
    const result = await renderMarkdownStringToPdf({
        markdown: '# Memory PDF\n\nHello from memory.',
        fileName: 'memory-doc.md',
        outputFileName: 'memory-doc.pdf',
    });

    assert.equal(result.fileName, 'memory-doc.md');
    assert.equal(result.file.fileName, 'memory-doc.md');
    assert.equal(result.file.pdfName, 'memory-doc.pdf');
    assert.equal(result.file.sourcePath, null);
    assert.ok(result.file.pdf instanceof Uint8Array);
    assert.ok(result.file.pdf.length > 0);
    assert.equal(Buffer.from(result.file.pdf).subarray(0, 4).toString('ascii'), '%PDF');
    assert.match(result.file.html, /<title>Memory PDF<\/title>/);
});

test('renders PDFs from a Markdown file to memory through the library API', { timeout: 120_000 }, async () => {
    const result = await renderMarkdownFileToPdf({
        inputFile: fixtureInputFile,
        outputFileName: 'memory-file.pdf',
    });

    assert.equal(result.inputFile, fixtureInputFile);
    assert.equal(result.file.fileName, 'rendering-showcase.md');
    assert.equal(result.file.pdfName, 'memory-file.pdf');
    assert.equal(result.file.sourcePath, fixtureInputFile);
    assert.ok(result.file.pdf instanceof Uint8Array);
    assert.ok(result.file.pdf.length > 0);
    assert.equal(Buffer.from(result.file.pdf).subarray(0, 4).toString('ascii'), '%PDF');
    assert.match(result.file.html, /<!doctype html>/i);
});

test('runs the CLI entrypoint through main() with injected streams', async () => {
    const stdout = [];
    const stderr = [];
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');

    try {
        const exitCode = await main(
            ['--input', fixtureInputDir, '--output', outputDir],
            {
                cwd: repoRoot,
                stdout: { write: (chunk) => stdout.push(String(chunk)) },
                stderr: { write: (chunk) => stderr.push(String(chunk)) },
            },
        );

        assert.equal(exitCode, 0);
        assert.equal(stderr.length, 0);
        assert.ok(stdout.some((chunk) => chunk.includes('Render started.')));
        assert.ok(stdout.some((chunk) => chunk.includes('Render finished successfully.')));

        const pdfStat = await fs.stat(path.join(outputDir, 'rendering-showcase.pdf'));
        assert.ok(pdfStat.size > 0);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('returns a non-zero exit code from main() on failure', async () => {
    const stdout = [];
    const stderr = [];
    const tempDir = await createTempDir();
    const missingInputDir = path.join(tempDir, 'missing');

    try {
        const exitCode = await main(
            ['--input', missingInputDir, '--output', path.join(tempDir, 'output')],
            {
                cwd: repoRoot,
                stdout: { write: (chunk) => stdout.push(String(chunk)) },
                stderr: { write: (chunk) => stderr.push(String(chunk)) },
            },
        );

        assert.equal(exitCode, 1);
        assert.equal(stdout.length, 0);
        assert.ok(stderr.some((chunk) => chunk.includes('Input path does not exist:')));
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('fails with a clear error when the input directory is missing', async () => {
    const tempDir = await createTempDir();
    const missingInputDir = path.join(tempDir, 'does-not-exist');
    const outputDir = path.join(tempDir, 'output');

    try {
        const result = await runCli(['--input', missingInputDir, '--output', outputDir]);

        assert.notEqual(result.code, 0);
        assert.match(result.stderr || result.stdout, /Input path does not exist:/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
