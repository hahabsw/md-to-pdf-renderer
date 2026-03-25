# md-to-pdf-renderer

Markdown 문서를 HTML과 PDF로 렌더링하는 독립 도구입니다.

## 목적

- `*.md` 문서를 일괄 HTML/PDF 변환
- Mermaid 다이어그램 렌더링
- 표, 코드 블록, 트리 구조, 인쇄용 레이아웃 처리

## 의존성

- `markdown-it`
- `mermaid`
- `puppeteer-core`
- Chrome 또는 Chromium 실행 파일

## 사용 방법

현재 저장소 루트에서 실행:

```bash
node tools/md-to-pdf-renderer/src/render-pdfs.mjs --input output --output output/pdf
```

루트 호환 스크립트로 실행:

```bash
node scripts/render-output-pdfs.mjs
```

도구 폴더에서 직접 실행:

```bash
cd tools/md-to-pdf-renderer
npm install
npm run render -- --input ../../output --output ../../output/pdf
```

`scripts/render-output-pdfs.mjs` 는 기존 호출 경로를 유지하기 위한 호환 래퍼이며, 실제 구현 소스는 `tools/md-to-pdf-renderer/src/render-pdfs.mjs` 가 소유합니다.

## 옵션

| 옵션 | 설명 | 기본값 |
| ---- | ---- | ------ |
| `--input` | 입력 Markdown 디렉토리 | `output` |
| `--output` | 출력 PDF 디렉토리 | `<input>/pdf` |
| `--html` | 출력 HTML 디렉토리 | `<output>/html` |
| `--chrome-path` | Chrome/Chromium 실행 파일 경로 | `/usr/bin/google-chrome` |

## 출력물

- `<output>/*.pdf`
- `<html>/*.html`
- `<output>/README.md`
