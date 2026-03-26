#!/usr/bin/env node

import { main } from '../src/render-pdfs.mjs';

const exitCode = await main(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
});

process.exitCode = exitCode;
