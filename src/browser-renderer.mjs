import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

export async function renderPdf(browser, { html, pdfPath, documentLabel }) {
    const pdf = await renderPdfBuffer(browser, { html, documentLabel });
    await fs.writeFile(pdfPath, pdf);
}

export async function renderPdfBuffer(browser, { html, documentLabel, waitForReadySignal = true }) {
    const page = await browser.newPage();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'md-to-pdf-renderer-'));
    const tempHtmlPath = path.join(tempDir, `${toSafeTempName(documentLabel)}.html`);

    try {
        await fs.writeFile(tempHtmlPath, html, 'utf8');
        await page.goto(pathToFileURL(tempHtmlPath).href, {
            waitUntil: 'networkidle0',
        });
        await page.emulateMediaType('print');

        if (waitForReadySignal) {
            await page.waitForFunction(
                () => document.body.dataset.mermaidReady === 'true' || Boolean(document.body.dataset.mermaidError),
                {
                    timeout: 30_000,
                },
            );
            const mermaidError = await page.evaluate(() => document.body.dataset.mermaidError || null);

            if (mermaidError) {
                throw new Error(`Mermaid render failed for ${documentLabel}: ${mermaidError}`);
            }
        }

        await page.evaluate(async () => {
            const imageLoads = Array.from(document.images, (image) => {
                if (image.complete) {
                    return null;
                }

                return new Promise((resolve) => {
                    const done = () => resolve();
                    image.addEventListener('load', done, { once: true });
                    image.addEventListener('error', done, { once: true });
                });
            }).filter(Boolean);

            await Promise.all(imageLoads);

            if (document.fonts?.ready) {
                await document.fonts.ready;
            }
        });
        return await page.pdf({
            printBackground: true,
            displayHeaderFooter: false,
            preferCSSPageSize: true,
        });
    } finally {
        await page.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

export async function runWithBrowser(chromePath, callback, options = {}) {
    const launchOptions = await resolveBrowserLaunchOptions(chromePath);
    const warning = getMacOsNodeArchitectureWarning();

    if (warning && typeof options.onWarning === 'function') {
        await options.onWarning(warning);
    }

    const browser = await puppeteer.launch({
        ...launchOptions,
        headless: true,
    });

    try {
        return await callback(browser);
    } finally {
        await browser.close();
    }
}

export function getMacOsNodeArchitectureWarning(environment = getRuntimeEnvironment()) {
    if (environment.platform !== 'darwin' || environment.arch !== 'x64') {
        return null;
    }

    if (!String(environment.cpuModel ?? '').includes('Apple')) {
        return null;
    }

    return 'md-to-pdf-renderer warning: x64 Node is running on Apple Silicon macOS. '
        + 'Puppeteer will launch Chrome through Rosetta, which can make PDF rendering much slower. '
        + 'Use an arm64 build of Node instead. Check with: node -p "process.arch"';
}

export async function resolveBrowserLaunchOptions(cliChromePath) {
    const executablePath = cliChromePath
        || process.env.PUPPETEER_EXECUTABLE_PATH
        || process.env.CHROME_PATH;

    if (executablePath) {
        return buildBrowserLaunchOptions(executablePath);
    }

    const systemBrowser = await findSystemBrowser();

    if (systemBrowser) {
        return buildBrowserLaunchOptions(systemBrowser);
    }

    if (process.platform === 'linux' && (process.arch === 'arm64' || process.arch === 'arm')) {
        throw new Error(
            'Linux ARM does not reliably support Puppeteer\'s bundled Chrome in this tool. '
            + 'Install Chromium or Chrome on the board and run again with --chrome-path <path> '
            + 'or set PUPPETEER_EXECUTABLE_PATH.',
        );
    }

    return {};
}

function buildBrowserLaunchOptions(executablePath) {
    const browser = detectBrowserType(executablePath);

    if (browser === 'firefox') {
        throw new Error(
            'Firefox is not supported by this renderer. '
            + 'Use a Chrome or Chromium executable with --chrome-path '
            + 'or set PUPPETEER_EXECUTABLE_PATH to a Chrome/Chromium binary.',
        );
    }

    return {
        browser,
        executablePath,
        args: [
            '--no-sandbox',
            '--disable-gpu',
            '--allow-file-access-from-files',
        ],
    };
}

function detectBrowserType(executablePath) {
    const lower = executablePath.toLowerCase();

    if (lower.includes('firefox')) {
        return 'firefox';
    }

    return 'chrome';
}

function getRuntimeEnvironment() {
    return {
        platform: process.platform,
        arch: process.arch,
        cpuModel: os.cpus()[0]?.model ?? '',
    };
}

async function findSystemBrowser() {
    const candidates = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium',
        '/usr/lib/chromium-browser/chromium-browser',
        '/usr/lib/chromium/chromium',
    ];

    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // Keep scanning known browser paths.
        }
    }

    return null;
}

function toSafeTempName(documentLabel) {
    const normalized = String(documentLabel || 'document')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || 'document';
}
