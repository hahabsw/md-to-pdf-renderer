import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
    getHelpText,
    renderMarkdownDirectory,
    renderMarkdownToHtml,
} from '../src/render-pdfs.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, 'bin', 'md-to-pdf-renderer.mjs');
const fixtureInputDir = path.join(repoRoot, 'fixtures', 'readme-showcase');

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
    assert.match(result.stdout, /Default: disabled/);
});

test('exports help text for library consumers', () => {
    const helpText = getHelpText();

    assert.match(helpText, /md-to-pdf-renderer/);
    assert.match(helpText, /optional HTML output/);
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

test('fails with a clear error when the input directory is missing', async () => {
    const tempDir = await createTempDir();
    const missingInputDir = path.join(tempDir, 'does-not-exist');
    const outputDir = path.join(tempDir, 'output');

    try {
        const result = await runCli(['--input', missingInputDir, '--output', outputDir]);

        assert.notEqual(result.code, 0);
        assert.match(result.stderr || result.stdout, /Input directory does not exist:/);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
