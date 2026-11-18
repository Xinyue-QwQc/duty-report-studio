import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { parseScheduleFile } from '../src/domain/readers.js';
import { scheduleRange } from '../src/domain/roster.js';

const title = '示例值班表';
const rows = [
  ['值班时间', '值班组长', '值班人员'],
  ['2099-06-01中午', '组长甲（3）', '队员甲、队员乙'],
  ['2099-06-02下午', '组长乙（2）', '队员丙'],
];

async function docxFixture() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraph = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const table = rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join('')}</w:tr>`).join('');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph(title)}<w:tbl>${table}</w:tbl></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

// Build a text PDF with positioned columns and a Unicode map from the invented strings above.
function pdfFixture() {
  const lines = [[title], ...rows];
  const textHex = (text) => Buffer.from(text, 'utf16le').swap16().toString('hex');
  const content = lines.map((row, y) => row.map((cell, x) =>
    `BT /F1 12 Tf 1 0 0 1 ${40 + x * 168} ${760 - y * 30} Tm <${textHex(cell)}> Tj ET`).join('\n')).join('\n');
  const codes = [...new Set(lines.flat().join(''))].map((char) => `<${textHex(char)}>`);
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /RosterTest def
/CMapType 2 def
1 begincodespacerange
<0000> <ffff>
endcodespacerange
${codes.length} beginbfchar
${codes.map((code) => `${code} ${code}`).join('\n')}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  const stream = (value) => `<< /Length ${Buffer.byteLength(value)} >>
stream
${value}
endstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(content),
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 500 >>',
    stream(cmap),
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj
${object}
endobj
`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref
0 ${offsets.length + 1}
0000000000 65535 f\x20
`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n\x20
`).join('');
  pdf += `trailer
<< /Size ${offsets.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF
`;
  return Buffer.from(pdf);
}

for (const [extension, makeFixture] of [['docx', docxFixture], ['pdf', pdfFixture]]) {
  test(`imports a real ${extension.toUpperCase()} file with correct dates and names`, async () => {
    const { window } = new JSDOM();
    try {
      const file = new File([await makeFixture()], `示例值班表.${extension}`);
      const { sessions, warnings } = await parseScheduleFile(file, { DOM: window.DOMParser });
      assert.deepEqual(warnings, []);
      assert.deepEqual(sessions.map(({ date, shift, leader, members, declared }) => [date, shift, leader, members, declared]), [
        ['2099-06-01', '中午', '组长甲', ['组长甲', '队员甲', '队员乙'], 3],
        ['2099-06-02', '下午', '组长乙', ['组长乙', '队员丙'], 2],
      ]);
      assert.deepEqual(scheduleRange(sessions, '2099-06-01'), { start: '2099-06-01', end: '2099-06-02' });
    } finally { window.close(); }
  });
}
