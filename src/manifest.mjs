export function buildManifestMarkdown(manifest) {
    return [
        '# PDF Outputs',
        '',
        `Generated: ${formatDate(new Date())}`,
        '',
        ...manifest.map((item) => `- ${item.title}: \`${item.pdfName}\` (source: \`${item.fileName}\`)`),
        '',
    ].join('\n');
}

function formatDate(date) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}`;
}
