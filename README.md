# md-to-pdf-renderer

`md-to-pdf-renderer` is a standalone Node.js tool that converts Markdown documents into print-ready PDF files, with optional HTML output.

It is designed for documentation export workflows where the same Markdown source should be rendered consistently with:

- A4-oriented PDF layout
- Mermaid diagram rendering
- Syntax-highlighted code blocks and plain-text blocks
- Tables, blockquotes, and general document formatting
- Task lists, footnotes, and GitHub-style callouts
- `[[TOC]]` placeholder based table of contents
- Inline and block math rendering with KaTeX
- Optional manifest generation for produced PDFs

### Quickstart For Humans And Agents

Quickstart for humans and agents:
```bash
npx md-to-pdf-renderer
```
This will render all of the markdown files in the current directory and write the output to the current directory.

Fastest successful path:

```bash
npx md-to-pdf-renderer --input fixtures/readme-showcase --output out --log-file
```

Expected output:

- `out/rendering-showcase.pdf`
- `out/render.log`

Tool contract:

- Input is the top-level `*.md` files in the `--input` directory.
- Output is `*.pdf` in `--output`, or in the current working directory when `--output` is omitted.
- A manifest `README.md` is only written when `--manifest` is provided.
- Intermediate HTML files are only written when `--html <dir>` is provided.
- For automation, prefer passing both `--input` and `--output` explicitly instead of relying on defaults.
- The command exits with a non-zero status when the input directory is missing, empty, or when Mermaid rendering fails.
- On Linux ARM boards, prefer a system Chromium or Chrome path via `--chrome-path` or `PUPPETEER_EXECUTABLE_PATH`.

### Preview

Example source: `fixtures/readme-showcase/rendering-showcase.md`

Generated output:

- `fixtures/readme-showcase-output/rendering-showcase.pdf`
- `fixtures/readme-showcase-output/html/rendering-showcase.html`

The preview HTML above was generated with `--html fixtures/readme-showcase-output/html`.

Preview images from the latest showcase render:

<p>
  <img src="docs/readme-assets/showcase-overview.png" alt="Showcase overview" width="49%" />
  <img src="docs/readme-assets/showcase-details.png" alt="Showcase details" width="49%" />
</p>



### What it does

When you run the renderer:

1. It scans the input directory for top-level `*.md` files.
2. It converts each Markdown file into rendered HTML in memory.
3. It opens that HTML in a bundled Puppeteer-managed browser.
4. It renders Mermaid blocks before printing.
5. It writes the final PDF files.
6. It optionally writes intermediate HTML files when `--html <dir>` is set.
7. It optionally creates a `README.md` manifest inside the PDF output directory when `--manifest` is set.

### Requirements

- Node.js
- `npm install` for this tool directory
- No separate Chrome installation is required by default
- Network access for Mermaid ESM loading from jsDelivr at render time
- Linux ARM boards may need a system Chromium or Chrome executable instead of Puppeteer's bundled browser

### Dependencies

- `markdown-it`
- `markdown-it-footnote`
- `markdown-it-task-lists`
- `highlight.js`
- `katex`
- `mermaid`
- `puppeteer`

### Install

From the tool directory:

```bash
npm install
```

### Usage

Quick start with `npx`:

```bash
npx md-to-pdf-renderer
```

This writes output files into the current working directory by default.

Single file:

```bash
npx md-to-pdf-renderer --input docs/guide.md
```

Single file with a custom PDF name:

```bash
npx md-to-pdf-renderer --input docs/guide.md --output-file guide-v2.pdf
```

Single file with a custom output directory:

```bash
npx md-to-pdf-renderer --input docs/guide.md --output output
```

Write a manifest too:

```bash
npx md-to-pdf-renderer --input input --output output --manifest
```

Show CLI help:

```bash
npx md-to-pdf-renderer --help
```

Override the built-in CSS:

```bash
npx md-to-pdf-renderer --input input --output output --css styles/print.css
```

```bash
npx md-to-pdf-renderer --input input --output output --paper-size A4 --orientation portrait --log-file
```

Save intermediate HTML too:

```bash
npx md-to-pdf-renderer --input input --output output --html output/html
```

Linux ARM example:

```bash
npx md-to-pdf-renderer --input input --output output --chrome-path /usr/bin/chromium
```

Run from the repository root:

```bash
node src/render-pdfs.mjs --input input --output output --paper-size A4 --orientation portrait
```

### CLI options


| Option          | Description                                                              | Default                      |
| --------------- | ------------------------------------------------------------------------ | ---------------------------- |
| `--input`       | Directory or Markdown file to render                                     | Current working directory    |
| `--output`      | Directory where PDF files are written                                    | Current working directory    |
| `--output-file` | PDF file name for single-file input only                                 | Source file name with `.pdf` |
| `--html`        | Also write intermediate HTML files to this directory                     | Disabled                     |
| `--manifest`    | Also write `<output>/README.md` manifest                                 | Disabled                     |
| `--css`         | Use an existing CSS file path or inline CSS text, appended after the built-in styles | Disabled                     |
| `--paper-size`  | Print paper size such as `A4`, `Letter`, `Legal`, `A3`, or `210mm 297mm` | `A4`                         |
| `--orientation` | Print orientation: `portrait` or `landscape`                             | `portrait`                   |
| `--font-size`   | Overall font size preset: `xs`, `s`, `m`, `l`, `lg`, or `xl`             | `m`                          |
| `--log-file`    | Write progress logs to `<output>/render.log`                             | Disabled                     |
| `--chrome-path` | Optional path to a custom Chrome or Chromium executable                  | Bundled Puppeteer browser    |


### Output structure

The tool generates:

- `<output>/*.pdf`
- `<output>/README.md` only when `--manifest` is enabled
- `<output>/render.log` when `--log-file` is enabled
- `<html>/*.html` only when `--html <dir>` is enabled

Example:

```text
input/
  01-overview.md
  02-architecture.md

output/
  01-overview.pdf
  02-architecture.pdf
  render.log

output/html/
  01-overview.html
  02-architecture.html
```

### Programmatic API

Minimal examples with only the essential options:

```js
import {
  renderHtmlToPdf,
  renderMarkdownFileToPdf,
  renderMarkdownStringToPdf,
  renderMarkdownToHtml,
} from 'md-to-pdf-renderer';

const html = await renderMarkdownToHtml({
  markdown: '# Hello\n\n[[TOC]]',
});

const pdf = await renderHtmlToPdf({
  html,
});

const stringResult = await renderMarkdownStringToPdf({
  markdown: '# In Memory\n\nHello from a variable.',
});

const fileResult = await renderMarkdownFileToPdf({
  inputFile: 'docs/guide.md',
});

console.log(pdf);                  // Uint8Array
console.log(stringResult.file.pdf); // Uint8Array
console.log(fileResult.file.pdf);   // Uint8Array
```

Available exports:

- `renderHtmlToPdf(options)` renders HTML to PDF bytes without writing files.
- `renderMarkdownFileToPdf(options)` renders one Markdown file to PDF bytes without writing files.
- `renderMarkdownStringToPdf(options)` renders Markdown content from a string to PDF bytes without writing files.
- `renderMarkdownToHtml(options)` renders a single Markdown string to HTML without writing files.

The library API is intentionally memory-oriented. If you want files on disk, use the CLI.

The PDF-producing APIs return an object, not raw bytes directly. The actual PDF binary is in `result.file.pdf`.

Example:

```js
const result = await renderMarkdownStringToPdf({
  markdown: '# Hello\n\nRendered in memory.',
  fileName: 'hello.md',
});

console.log(result.fileName);      // 'hello.md'
console.log(result.file.title);    // 'Hello'
console.log(result.file.pdfName);  // 'hello.pdf'
console.log(result.file.html);     // rendered HTML string
console.log(result.file.pdf);      // Uint8Array
```

If you only need the PDF bytes, destructure them:

```js
const {
  file: { pdf },
} = await renderMarkdownStringToPdf({
  markdown: '# Hello',
});

console.log(pdf); // Uint8Array
```

If your source data starts as an object instead of a Markdown string, convert it to Markdown first and then read the PDF bytes from `result.file.pdf`:

```js
import { renderMarkdownStringToPdf } from 'md-to-pdf-renderer';

const report = {
  title: 'Weekly Report',
  summary: 'Build is stable and release prep has started.',
  items: [
    'Completed PDF renderer refactor',
    'Added memory-based API',
    'Updated CLI defaults',
  ],
};

function reportToMarkdown(data) {
  return [
    `# ${data.title}`,
    '',
    data.summary,
    '',
    '## Highlights',
    '',
    ...data.items.map((item) => `- ${item}`),
  ].join('\n');
}

const result = await renderMarkdownStringToPdf({
  markdown: reportToMarkdown(report),
  fileName: 'weekly-report.md',
  outputFileName: 'weekly-report.pdf',
  cssPath: './styles/print.css',
});

console.log(result.file.pdf); // Uint8Array
```

`renderMarkdownFileToPdf(options)` options:


| Field                           | Type            | Default                      | Description                                                        |
| ------------------------------- | --------------- | ---------------------------- | ------------------------------------------------------------------ |
| `cwd`                           | `string`        | `process.cwd()`              | Base path used to resolve relative options                         |
| `inputFile` / `input`           | `string`        | Required                     | Markdown file to render                                            |
| `outputFileName` / `outputFile` | `string`        | Source file name with `.pdf` | Custom PDF file name for returned metadata                         |
| `cssPath` / `css`               | `string`        | Disabled                     | Existing CSS file path or inline CSS text appended after the built-in styles |
| `paperSize`                     | `string`        | `A4`                         | Paper size such as `A4`, `Letter`, `Legal`, `A3`, or `210mm 297mm` |
| `orientation`                   | `string`        | `portrait`                   | Page orientation: `portrait` or `landscape`                        |
| `fontSizePreset` / `fontSize`   | `string`        | `m`                          | Overall font size preset: `xs`, `s`, `m`, `l`, `lg`, or `xl`       |
| `chromePath`                    | `string | null` | Auto-detect                  | Custom Chrome or Chromium executable                               |


`renderMarkdownFileToPdf()` return shape:


| Field             | Type         | Description                            |
| ----------------- | ------------ | -------------------------------------- |
| `inputFile`       | `string`     | Absolute input file path               |
| `file.title`      | `string`     | Resolved document title                |
| `file.fileName`   | `string`     | Source Markdown file name              |
| `file.pdfName`    | `string`     | Output PDF file name used in metadata  |
| `file.pdf`        | `Uint8Array` | PDF binary data                        |
| `file.html`       | `string`     | Rendered HTML used to generate the PDF |
| `file.sourcePath` | `string`     | Absolute source Markdown file path     |


`renderMarkdownStringToPdf(options)` options:


| Field                           | Type            | Default                         | Description                                                        |
| ------------------------------- | --------------- | ------------------------------- | ------------------------------------------------------------------ |
| `markdown`                      | `string`        | Required                        | Markdown source to render from memory                              |
| `title`                         | `string`        | First `# Heading` or `Document` | HTML document title                                                |
| `fileName` / `name`             | `string`        | `document.md`                   | Virtual Markdown file name used for output naming                  |
| `cwd`                           | `string`        | `process.cwd()`                 | Base path used to resolve relative options                         |
| `baseDir` / `inputDir`          | `string`        | `.`                             | Base directory for relative asset links                            |
| `baseHref`                      | `string`        | Derived from `baseDir`          | Explicit `<base href>` value                                       |
| `outputFileName` / `outputFile` | `string`        | Virtual file name with `.pdf`   | Custom PDF file name for returned metadata                         |
| `cssPath` / `css`               | `string`        | Disabled                        | Existing CSS file path or inline CSS text appended after the built-in styles |
| `paperSize`                     | `string`        | `A4`                            | Paper size such as `A4`, `Letter`, `Legal`, `A3`, or `210mm 297mm` |
| `orientation`                   | `string`        | `portrait`                      | Page orientation: `portrait` or `landscape`                        |
| `fontSizePreset` / `fontSize`   | `string`        | `m`                             | Overall font size preset: `xs`, `s`, `m`, `l`, `lg`, or `xl`       |
| `chromePath`                    | `string | null` | Auto-detect                     | Custom Chrome or Chromium executable                               |


`renderMarkdownStringToPdf()` return shape:


| Field             | Type         | Description                                               |
| ----------------- | ------------ | --------------------------------------------------------- |
| `fileName`        | `string`     | Virtual Markdown file name                                |
| `file.title`      | `string`     | Resolved document title                                   |
| `file.fileName`   | `string`     | Virtual Markdown file name again inside the file metadata |
| `file.pdfName`    | `string`     | Output PDF file name used in metadata                     |
| `file.pdf`        | `Uint8Array` | PDF binary data                                           |
| `file.html`       | `string`     | Rendered HTML used to generate the PDF                    |
| `file.sourcePath` | `null`       | Always `null` for in-memory Markdown                      |


`renderHtmlToPdf(options)` options:


| Field           | Type            | Default         | Description                          |
| --------------- | --------------- | --------------- | ------------------------------------ |
| `html`          | `string`        | Required        | HTML document to render              |
| `documentLabel` | `string`        | `document.html` | Label used in render errors          |
| `chromePath`    | `string | null` | Auto-detect     | Custom Chrome or Chromium executable |


`renderMarkdownToHtml(options)` options:


| Field                  | Type     | Default                         | Description                                         |
| ---------------------- | -------- | ------------------------------- | --------------------------------------------------- |
| `markdown`             | `string` | Required                        | Markdown source to render                           |
| `title`                | `string` | First `# Heading` or `Document` | HTML document title                                 |
| `cwd`                  | `string` | `process.cwd()`                 | Base path used to resolve relative options          |
| `baseDir` / `inputDir` | `string` | `.`                             | Base directory for relative asset links             |
| `baseHref`             | `string` | Derived from `baseDir`          | Explicit `<base href>` value                        |
| `cssPath` / `css`      | `string` | Disabled                        | Existing CSS file path or inline CSS text appended after the built-in styles |
| `paperSize`            | `string` | `A4`                            | Paper size such as `A4`, `Letter`, or `210mm 297mm` |
| `orientation`          | `string` | `portrait`                      | Page orientation: `portrait` or `landscape`         |
| `fontSizePreset` / `fontSize` | `string` | `m`                        | Overall font size preset: `xs`, `s`, `m`, `l`, `lg`, or `xl` |


### Rendering notes

- The title of each document is taken from the first Markdown `# Heading` when available.
- If no top-level heading exists, the file name is converted into a readable title.
- Mermaid fences using ````mermaid` are rendered as diagrams.
- Standard fenced code blocks are syntax highlighted when the language is known, with automatic highlighting as a fallback.
- Code fences using ````text` are rendered with a plain text oriented layout.
- Task lists using `- [x]` and `- [ ]` are rendered with checkbox styling.
- Footnotes using `[^name]` syntax are rendered at the end of the document.
- GitHub-style callouts such as `> [!NOTE]` and `> [!WARNING]` are rendered as callout cards.
- `[[TOC]]` is replaced with a generated table of contents linking to document headings.
- Inline math using `$...$` and block math using `$$...$$` are rendered with KaTeX.
- The generated PDFs use print CSS and support `--paper-size` plus `--orientation`.
- `--font-size`, `fontSizePreset`, and `fontSize` change the overall typography scale, including Mermaid diagram text.
- `--css`, `cssPath`, and `css` accept either an existing CSS file path or inline CSS text for overriding the built-in styles.
- Render progress is always printed to the console.
- Intermediate HTML files are skipped by default and are only persisted when `--html <dir>` is passed.
- `<output>/README.md` is only written when `--manifest` is enabled.
- `<output>/render.log` is only written when `--log-file` is enabled.
- Mermaid rendering errors fail the command instead of silently producing a broken diagram in the PDF.
- Missing, empty, or invalid input directories fail with a clear error message.
- On Linux ARM, the bundled Puppeteer browser may be unusable, so pass `--chrome-path` or set `PUPPETEER_EXECUTABLE_PATH`.

### License

MIT
