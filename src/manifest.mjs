export function buildManifestMarkdown(manifest) {
    return [
        '# PDF 산출물 목록',
        '',
        `생성일: ${formatDate(new Date())}`,
        '',
        ...manifest.map((item) => `- ${item.title}: \`${item.pdfName}\` (원본: \`${item.fileName}\`)`),
        '',
    ].join('\n');
}

function formatDate(date) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}`;
}
