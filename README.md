# md-to-pdf-renderer

English version is shown first. Korean version follows below.

## English

`md-to-pdf-renderer` is a standalone Node.js tool that converts Markdown documents into print-ready HTML and PDF files.

It is designed for documentation export workflows where the same Markdown source should be rendered consistently with:

- A4-oriented PDF layout
- Mermaid diagram rendering
- Styled code blocks and plain-text blocks
- Tables, blockquotes, and general document formatting
- A generated manifest file for produced PDFs

### What it does

When you run the renderer:

1. It scans the input directory for top-level `*.md` files.
2. It converts each Markdown file into an intermediate HTML file.
3. It opens that HTML in Chrome/Chromium through `puppeteer-core`.
4. It renders Mermaid blocks before printing.
5. It writes the final PDF files.
6. It creates a `README.md` manifest inside the PDF output directory.

### Requirements

- Node.js
- `npm install` for this tool directory
- Chrome or Chromium executable available on the machine
- Network access for Mermaid ESM loading from jsDelivr at render time

### Dependencies

- `markdown-it`
- `mermaid`
- `puppeteer-core`

### Install

From the tool directory:

```bash
cd tools/md-to-pdf-renderer
npm install
```

### Usage

Run from the repository root:

```bash
node tools/md-to-pdf-renderer/src/render-pdfs.mjs --input input --output output
```

Run through the compatibility wrapper from the repository root:

```bash
node scripts/render-output-pdfs.mjs
```

Run directly from the tool directory:

```bash
cd tools/md-to-pdf-renderer
npm run render -- --input ../../input --output ../../output
```

### CLI options

| Option | Description | Default |
| ---- | ---- | ---- |
| `--input` | Directory containing source Markdown files | `input` |
| `--output` | Directory where PDF files are written | `output` |
| `--html` | Directory where intermediate HTML files are written | `<output>/html` |
| `--chrome-path` | Path to the Chrome/Chromium executable | `/usr/bin/google-chrome` |

### Output structure

The tool generates:

- `<output>/*.pdf`
- `<html>/*.html`
- `<output>/README.md`

Example:

```text
output/
  01-overview.md
  02-architecture.md
  pdf/
    01-overview.pdf
    02-architecture.pdf
    README.md
    html/
      01-overview.html
      02-architecture.html
```

### Rendering notes

- The title of each document is taken from the first Markdown `# Heading` when available.
- If no top-level heading exists, the file name is converted into a readable title.
- Mermaid fences using ```` ```mermaid ```` are rendered as diagrams.
- Code fences using ```` ```text ```` are rendered with a plain text oriented layout.
- The generated PDFs use print CSS with A4 page sizing.

### Compatibility note


---

## 한국어

`md-to-pdf-renderer`는 Markdown 문서를 인쇄용 HTML 및 PDF로 변환하는 독립형 Node.js 도구입니다.

문서 산출물 생성 흐름에서 같은 Markdown 원본을 일관된 형식으로 내보내기 위해 만들어졌으며, 다음을 지원합니다.

- A4 기준 PDF 레이아웃
- Mermaid 다이어그램 렌더링
- 코드 블록 및 일반 텍스트 블록 스타일링
- 표, 인용문, 일반 문단 포맷팅
- 생성된 PDF 목록용 매니페스트 파일 출력

### 하는 일

렌더러를 실행하면 다음 순서로 동작합니다.

1. 입력 디렉터리에서 최상위 `*.md` 파일을 찾습니다.
2. 각 Markdown 파일을 중간 HTML 파일로 변환합니다.
3. `puppeteer-core`를 통해 Chrome/Chromium에서 해당 HTML을 엽니다.
4. PDF 출력 전에 Mermaid 블록을 렌더링합니다.
5. 최종 PDF 파일을 생성합니다.
6. PDF 출력 디렉터리에 결과 목록용 `README.md`를 생성합니다.

### 요구 사항

- Node.js
- 이 도구 디렉터리에서 `npm install` 수행
- 실행 가능한 Chrome 또는 Chromium 설치
- 렌더링 시 Mermaid ESM을 jsDelivr에서 불러오기 위한 네트워크 접근

### 의존성

- `markdown-it`
- `mermaid`
- `puppeteer-core`

### 설치

도구 디렉터리에서 실행:

```bash
cd tools/md-to-pdf-renderer
npm install
```

### 사용 방법

저장소 루트에서 직접 실행:

```bash
node tools/md-to-pdf-renderer/src/render-pdfs.mjs --input input --output output
```

저장소 루트의 호환 래퍼로 실행:

```bash
node scripts/render-output-pdfs.mjs
```

도구 디렉터리에서 직접 실행:

```bash
cd tools/md-to-pdf-renderer
npm run render -- --input ../../input --output ../../output
```

### CLI 옵션

| 옵션 | 설명 | 기본값 |
| ---- | ---- | ---- |
| `--input` | 원본 Markdown 디렉터리 | `input` |
| `--output` | PDF 출력 디렉터리 | `output` |
| `--html` | 중간 HTML 출력 디렉터리 | `<output>/html` |
| `--chrome-path` | Chrome/Chromium 실행 파일 경로 | `/usr/bin/google-chrome` |

### 출력 구조

생성 결과는 다음과 같습니다.

- `<output>/*.pdf`
- `<html>/*.html`
- `<output>/README.md`

예시:

```text
output/
  01-overview.md
  02-architecture.md
  pdf/
    01-overview.pdf
    02-architecture.pdf
    README.md
    html/
      01-overview.html
      02-architecture.html
```

### 렌더링 참고 사항

- 문서 제목은 가능하면 첫 번째 Markdown `# Heading`에서 가져옵니다.
- 최상위 제목이 없으면 파일명을 사람이 읽기 쉬운 제목으로 변환합니다.
- ```` ```mermaid ```` 코드 펜스는 다이어그램으로 렌더링됩니다.
- ```` ```text ```` 코드 펜스는 일반 텍스트용 레이아웃으로 렌더링됩니다.
- 생성되는 PDF는 A4 기준의 print CSS를 사용합니다.

### 호환성 참고
