import { parseScheduleTables } from './roster.js';

export async function wordTable(buffer, DOM = globalThis.DOMParser) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js');
  const { value } = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
    externalFileAccess: false,
    convertImage: () => [],
  });
  const document = new DOM().parseFromString(value, 'text/html');
  const title = [...document.body.querySelectorAll(':scope > p')].map((p) => p.textContent.trim()).find((text) => text.includes('值班表')) || '';
  const sheets = [...document.querySelectorAll('table')].map((table) => {
    const rows = [...table.rows].map(() => []);
    [...table.rows].forEach((row, index) => {
      let column = 0;
      [...row.cells].forEach((cell) => {
        while (rows[index][column] != null) column += 1;
        const content = [...cell.childNodes].map((node) => node.textContent).join('\n').trim();
        for (let r = 0; r < cell.rowSpan && rows[index + r]; r += 1) {
          for (let c = 0; c < cell.colSpan; c += 1) rows[index + r][column + c] = c === 0 ? content : '';
        }
        column += cell.colSpan;
      });
    });
    return { rows };
  });
  return { title, sheets };
}

async function spreadsheetTable(buffer, extension) {
  const { read, utils, set_cptable } = await import('xlsx');
  if (extension === 'xls') set_cptable(await import('xlsx/dist/cpexcel'));
  const book = read(buffer, { type: 'array', ...(extension === 'csv' ? { codepage: 65001 } : {}) });
  const sheets = book.SheetNames.map((sheetName) => {
    const sheet = book.Sheets[sheetName];
    const rows = utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: true });
    for (const { s, e } of sheet['!merges'] || []) {
      if (s.c !== e.c || !rows[s.r]?.[s.c]) continue;
      for (let r = s.r + 1; r <= e.r && rows[r]; r += 1) rows[r][s.c] = rows[s.r][s.c];
    }
    return { rows };
  });
  return { title: sheets.flatMap(({ rows }) => rows.slice(0, 3)).flat().find((cell) => String(cell).includes('值班表')) || '', sheets };
}

function textRows(items) {
  const lines = [];
  for (const item of items.filter((entry) => entry.str?.trim())) {
    const [x, y] = item.transform.slice(4);
    let line = lines.find((entry) => Math.abs(entry.y - y) < 2.4);
    if (!line) { line = { y, items: [] }; lines.push(line); }
    line.items.push({ x, text: item.str });
  }
  return lines.sort((a, b) => b.y - a.y).map((line) => line.items.sort((a, b) => a.x - b.x));
}

function readPdfPage(lines, previousColumns) {
  let columns = previousColumns;
  const rows = [];
  let title = '';
  let entry = null;
  const flush = () => { if (entry) rows.push(entry); entry = null; };
  for (const cells of lines) {
    const line = cells.map((cell) => cell.text).join('').trim();
    if (line.includes('周值班表') || /周\s+值班表/.test(line)) title = line;
    const timeHead = cells.find((cell) => /^(?:值班时间|日期)$/.test(cell.text.trim()));
    const leaderHead = cells.find((cell) => /^(?:值班组长|组长)$/.test(cell.text.trim()));
    const memberHead = cells.find((cell) => /^(?:值班人员|队员)$/.test(cell.text.trim()));
    if (timeHead && leaderHead && memberHead) {
      flush();
      const firstCut = (timeHead.x + leaderHead.x) / 2;
      const secondCut = leaderHead.x + (memberHead.x - leaderHead.x) * 0.34;
      columns = [firstCut, secondCut];
      continue;
    }
    if (!columns) continue;
    const row = ['', '', ''];
    for (const cell of cells) {
      const column = cell.x < columns[0] ? 0 : cell.x < columns[1] ? 1 : 2;
      row[column] += cell.text;
    }
    if (/^(?:周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,4}[./月年-]\d)/.test(row[0])) {
      flush();
      entry = row;
    } else if (entry && (!row[0].trim() || /^\d{1,2}\s*[:：]/.test(row[0]))) {
      if (row[1]?.trim()) entry[1] += `\n${row[1].trim()}`;
      if (row[2]?.trim()) entry[2] += `\n${row[2].trim()}`;
    } else if (entry) {
      flush();
    }
  }
  flush();
  return { title, columns, rows };
}

export async function pdfTable(buffer, pdfWorker) {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (pdfWorker) GlobalWorkerOptions.workerSrc = pdfWorker;
  const loading = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: true, stopAtErrors: true });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 40) throw new Error('请上传不超过 40 页的值班表。');
    const output = { title: '', sheets: [] };
    let columns;
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const { items } = await page.getTextContent();
      const parsed = readPdfPage(textRows(items), columns);
      columns = parsed.columns;
      output.title ||= parsed.title;
      if (parsed.rows.length) output.sheets.push({ rows: [['值班时间', '值班组长', '值班人员'], ...parsed.rows] });
    }
    if (!output.sheets.length) throw new Error('PDF 中没有可识别的值班表。请上传 Word、Excel 或同版式的文字 PDF。');
    return output;
  } finally {
    await loading.destroy();
  }
}

export async function parseScheduleFile(file, { year, pdfWorker, DOM } = {}) {
  const extension = file.name.toLowerCase().split('.').pop();
  const buffer = await file.arrayBuffer();
  let result;
  if (extension === 'docx') result = await wordTable(buffer, DOM);
  else if (extension === 'pdf') result = await pdfTable(buffer, pdfWorker);
  else if (['xlsx', 'xls', 'csv'].includes(extension)) result = await spreadsheetTable(buffer, extension);
  else throw new Error('请选择 DOCX、PDF、XLSX、XLS 或 CSV 文件。');
  return parseScheduleTables(result.sheets, result.title || file.name, year);
}