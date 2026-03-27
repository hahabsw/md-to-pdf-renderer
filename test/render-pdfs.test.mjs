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
    renderMarkdownDirectory,
    renderMarkdownFile,
    renderMarkdownPath,
    renderMarkdownToHtml,
} from '../src/render-pdfs.mjs';

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
    assert.match(result.stdout, /--input <path>/);
    assert.match(result.stdout, /Default: disabled/);
});

test('exports help text for library consumers', () => {
    const helpText = getHelpText();

    assert.match(helpText, /md-to-pdf-renderer/);
    assert.match(helpText, /optional HTML output/);
});

test('parses CLI arguments for programmatic consumers', () => {
    const args = parseArgs([
        '--input', 'docs',
        '--output', 'out',
        '--html', 'out/html',
        '--paper-size', 'Letter',
        '--orientation', 'landscape',
        '--chrome-path', '/usr/bin/chromium',
        '--log-file',
    ]);

    assert.deepEqual(args, {
        input: 'docs',
        output: 'out',
        html: 'out/html',
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

test('renders PDFs without creating HTML files by default', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');

    try {
        const result = await runCli(['--input', fixtureInputDir, '--output', outputDir]);

        assert.equal(result.code, 0, result.stderr || result.stdout);

        const pdfPath = path.join(outputDir, 'rendering-showcase.pdf');
        const manifestPath = path.join(outputDir, 'README.md');
        const htmlDirPath = path.join(outputDir, 'html');

        const pdfStat = await fs.stat(pdfPath);
        assert.ok(pdfStat.size > 0);

        const manifest = await fs.readFile(manifestPath, 'utf8');
        assert.match(manifest, /rendering-showcase\.pdf/);
        assert.match(manifest, /# PDF 산출물 목록/);

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
        const manifest = await fs.readFile(path.join(outputDir, 'README.md'), 'utf8');
        const pdfStat = await fs.stat(pdfPath);

        assert.ok(pdfStat.size > 0);
        assert.match(manifest, /rendering-showcase\.pdf/);
        assert.match(result.stdout, /Discovered 1 markdown file\(s\)\./);
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

test('rejects invalid programmatic HTML render input', async () => {
    await assert.rejects(
        renderMarkdownToHtml({ title: 'Missing Markdown' }),
        /renderMarkdownToHtml requires a markdown string\./,
    );
});

test('renders PDFs through the library API and returns output metadata', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');
    const htmlDir = path.join(outputDir, 'html');
    const messages = [];

    try {
        const result = await renderMarkdownDirectory({
            cwd: repoRoot,
            inputDir: fixtureInputDir,
            outputDir,
            htmlDir,
            logFile: true,
            onProgress: (message) => {
                messages.push(message);
            },
        });

        assert.equal(result.outputDir, outputDir);
        assert.equal(result.htmlDir, htmlDir);
        assert.equal(result.files.length, 1);
        assert.equal(result.files[0].fileName, 'rendering-showcase.md');
        assert.ok(result.files[0].pdfPath.endsWith('rendering-showcase.pdf'));
        assert.ok(result.files[0].htmlPath.endsWith('rendering-showcase.html'));

        const pdfStat = await fs.stat(result.files[0].pdfPath);
        const html = await fs.readFile(result.files[0].htmlPath, 'utf8');
        const manifest = await fs.readFile(result.manifestPath, 'utf8');
        const log = await fs.readFile(result.renderLogPath, 'utf8');

        assert.ok(pdfStat.size > 0);
        assert.match(html, /<!doctype html>/i);
        assert.match(manifest, /rendering-showcase\.pdf/);
        assert.match(log, /Render finished successfully\./);
        assert.ok(messages.some((message) => message.includes('Rendering rendering-showcase.md')));
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('renders a single Markdown file through the library API and returns file metadata', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');
    const htmlDir = path.join(outputDir, 'html');

    try {
        const result = await renderMarkdownFile({
            cwd: repoRoot,
            inputFile: fixtureInputFile,
            outputDir,
            htmlDir,
        });

        assert.equal(result.inputFile, fixtureInputFile);
        assert.equal(result.outputDir, outputDir);
        assert.equal(result.file.fileName, 'rendering-showcase.md');
        assert.ok(result.file.pdfPath.endsWith('rendering-showcase.pdf'));
        assert.ok(result.file.htmlPath.endsWith('rendering-showcase.html'));

        const pdfStat = await fs.stat(result.file.pdfPath);
        assert.ok(pdfStat.size > 0);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test('auto-detects directory and file inputs through renderMarkdownPath', { timeout: 120_000 }, async () => {
    const tempDir = await createTempDir();
    const fileOutputDir = path.join(tempDir, 'file-output');
    const dirOutputDir = path.join(tempDir, 'dir-output');

    try {
        const fileResult = await renderMarkdownPath({
            cwd: repoRoot,
            input: fixtureInputFile,
            output: fileOutputDir,
        });
        const dirResult = await renderMarkdownPath({
            cwd: repoRoot,
            input: fixtureInputDir,
            output: dirOutputDir,
        });

        assert.equal(fileResult.file.fileName, 'rendering-showcase.md');
        assert.equal(dirResult.files.length, 1);
        assert.equal(dirResult.files[0].fileName, 'rendering-showcase.md');
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
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
