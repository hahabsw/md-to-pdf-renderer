import { formatError } from './render-engine.mjs';
import { renderMarkdownPath } from './file-renderer.mjs';

/**
 * Return the CLI help text used by `--help`.
 *
 * @returns {string}
 */
export function getHelpText() {
    return `
md-to-pdf-renderer

Convert top-level Markdown files in a directory into styled PDF files, with optional HTML output.

Usage:
  md-to-pdf-renderer [options]

Options:
  --input <path>         Source Markdown directory or file. Default: current working directory
  --output <dir>         PDF output directory. Default: current working directory
  --output-file <name>   PDF file name for single-file input. Example: guide.pdf
  --html <dir>           Also write intermediate HTML files to this directory. Default: disabled
  --manifest             Also write a README.md manifest file to the output directory. Default: disabled
  --paper-size <size>    Paper size such as A4, Letter, Legal, A3, or "210mm 297mm". Default: A4
  --orientation <mode>   Page orientation: portrait or landscape. Default: portrait
  --log-file             Write progress logs to <output>/render.log
  --chrome-path <path>   Use a custom Chrome or Chromium executable instead of Puppeteer's bundled browser
  --help, -h             Show this help message

Examples:
  md-to-pdf-renderer --output output
  md-to-pdf-renderer --input docs/guide.md
  md-to-pdf-renderer --input docs/guide.md --output pdf
  md-to-pdf-renderer --input docs/guide.md --output-file guide-v2.pdf
  md-to-pdf-renderer --input docs --output pdf --manifest
  md-to-pdf-renderer --input docs/guide.md --output pdf --output-file guide-v2.pdf
  md-to-pdf-renderer --input docs --output pdf --html pdf/html
  md-to-pdf-renderer --input docs --output pdf --paper-size Letter --orientation landscape --log-file
  md-to-pdf-renderer --input docs --output pdf --chrome-path /usr/bin/chromium
`.trimStart();
}

/**
 * Parse CLI flags into an option object suitable for `main()`.
 *
 * Unknown flags are ignored for now so wrappers can pre-process arguments.
 *
 * @param {string[]} argv
 * @returns {{
 *   help?: boolean,
 *   input?: string,
 *   output?: string,
 *   outputFile?: string,
 *   html?: string,
 *   manifest?: boolean,
 *   chromePath?: string,
 *   paperSize?: string,
 *   orientation?: string,
 *   logFile?: boolean,
 * }}
 */
export function parseArgs(argv) {
    const parsed = {};

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            parsed.help = true;
            continue;
        }

        if (arg === '--input') {
            parsed.input = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--output') {
            parsed.output = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--output-file') {
            parsed.outputFile = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--html') {
            parsed.html = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--manifest') {
            parsed.manifest = true;
            continue;
        }

        if (arg === '--chrome-path') {
            parsed.chromePath = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--paper-size') {
            parsed.paperSize = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--orientation') {
            parsed.orientation = argv[i + 1];
            i += 1;
            continue;
        }

        if (arg === '--log-file') {
            parsed.logFile = true;
        }
    }

    return parsed;
}

/**
 * Run the CLI programmatically.
 *
 * This is useful for embedding the CLI behavior inside another Node.js process
 * while providing custom stdio streams.
 *
 * @param {string[]} [argv=process.argv.slice(2)] CLI-style argument list.
 * @param {Object} [runtime={}]
 * @param {string} [runtime.cwd=process.cwd()] Working directory used to resolve relative paths.
 * @param {{ write(chunk: string): unknown }} [runtime.stdout=process.stdout] Stream-like target for progress output.
 * @param {{ write(chunk: string): unknown }} [runtime.stderr=process.stderr] Stream-like target for error output.
 * @returns {Promise<0 | 1>}
 */
export async function main(argv = process.argv.slice(2), runtime = {}) {
    const args = parseArgs(argv);
    const stdout = runtime.stdout ?? process.stdout;
    const stderr = runtime.stderr ?? process.stderr;
    const cwd = runtime.cwd ?? process.cwd();

    if (args.help) {
        stdout.write(getHelpText());
        return 0;
    }

    try {
        await renderMarkdownPath({
            cwd,
            input: args.input,
            output: args.output,
            outputFile: args.outputFile,
            html: args.html,
            manifest: args.manifest,
            paperSize: args.paperSize,
            orientation: args.orientation,
            logFile: args.logFile,
            chromePath: args.chromePath,
            onProgress: (message) => {
                stdout.write(`${message}\n`);
            },
        });
        return 0;
    } catch (error) {
        stderr.write(`${formatError(error)}\n`);
        return 1;
    }
}
