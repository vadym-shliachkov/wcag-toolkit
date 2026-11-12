// A small .xlsx writer (Office Open XML in a zip), enough for findings.xlsx: several sheets of text and numbers,
// bold and shaded rows, wrapped text, frozen header, filters, collapsible row groups and links. No dependency:
// the zip is built with node:zlib.
import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0, 10); head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26); head.writeUInt16LE(0, 28);
    locals.push(head, nameBuf, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0, 12); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

const xml = (s) => String(s ?? '')
  // Characters XML 1.0 does not allow are dropped.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (n) => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

// Styles: 0 plain (wrapped, top), 1 header, 2 group row, 3 link, 4 muted, 5 bold link on a group row.
export const STYLE = { plain: 0, header: 1, group: 2, link: 3, muted: 4, groupLink: 5 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="10"/><name val="Calibri"/></font><font><u/><sz val="10"/><color rgb="FF1F4E9E"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><top style="thin"><color rgb="FFB8C2D3"/></top></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// A cell: a string, a number, or { v, s, link } (link: a URL; the cell shows v and opens the URL).
function cellXml(ref, c) {
  const o = c != null && typeof c === 'object' ? c : { v: c };
  const s = o.s ?? STYLE.plain;
  if (o.v == null || o.v === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
  if (typeof o.v === 'number') return `<c r="${ref}" s="${s}"><v>${o.v}</v></c>`;
  const v = String(o.v).slice(0, 32000);
  if (o.link && /^https?:\/\//.test(o.link) && o.link.length < 250) {
    const f = `HYPERLINK("${o.link.replace(/"/g, '""')}","${v.slice(0, 250).replace(/"/g, '""')}")`;
    return `<c r="${ref}" s="${s}" t="str"><f>${xml(f)}</f><v>${xml(v)}</v></c>`;
  }
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}

// sheet: { name, columns: [{ title, width }], rows: [{ cells: [...], level, style }], filter }
function sheetXml(sheet) {
  const cols = sheet.columns.map((c, n) => `<col min="${n + 1}" max="${n + 1}" width="${c.width ?? 18}" customWidth="1"/>`).join('');
  const all = [{ cells: sheet.columns.map((c) => ({ v: c.title, s: STYLE.header })) }, ...sheet.rows];
  const outline = sheet.rows.some((r) => r.level);
  const body = all.map((r, i) => {
    const cells = r.cells.map((c, n) => {
      const cc = c != null && typeof c === 'object' ? c : { v: c };
      return cellXml(`${colName(n)}${i + 1}`, r.style != null && cc.s == null ? { ...cc, s: r.style } : cc);
    }).join('');
    return `<row r="${i + 1}"${r.level ? ` outlineLevel="${r.level}"` : ''}>${cells}</row>`;
  }).join('');
  const last = `${colName(sheet.columns.length - 1)}${all.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr>${outline ? '<outlinePr summaryBelow="0"/>' : ''}</sheetPr>
<dimension ref="A1:${last}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"${outline ? ' outlineLevelRow="1"' : ''}/>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
${sheet.filter ? `<autoFilter ref="A1:${last}"/>` : ''}
</worksheet>`;
}

export function writeXlsx(file, sheets, { title = 'Findings' } = {}) {
  const safeName = (n, i) => String(n).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`;
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title></cp:coreProperties>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xml(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${sheets.some((s) => s.filter) ? `<definedNames>${sheets.map((s, i) => (s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(safeName(s.name, i))}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>` : '')).join('')}</definedNames>` : ''}</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  fs.writeFileSync(file, zip(files));
  return file;
}
