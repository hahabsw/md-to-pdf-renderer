import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './cli.mjs';

export { getHelpText, main, parseArgs } from './cli.mjs';
export {
    formatError,
    renderMarkdownDirectory,
    renderMarkdownFile,
    renderMarkdownPath,
    renderMarkdownToHtml,
} from './render-engine.mjs';

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    const exitCode = await main();
    process.exitCode = exitCode;
}
