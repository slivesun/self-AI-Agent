/**
 * 极简 DOCX 生成器：不引第三方库。
 * DOCX 本质是一个 zip，里面放几份 OOXML。这里用 stored（不压缩）方式打包，
 * 体积略大但实现简单、无依赖，Word / WPS / mammoth 都能正常读。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

/** stored zip（method=0），足够 Word 读取 */
function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(0, 8); // method=stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    locals.push(local, entry.data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + entry.data.length;
  }

  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, end]);
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Run {
  text: string;
  bold?: boolean;
  code?: boolean;
}

/** 行内标记：**粗体** 与 `代码` */
function parseRuns(text: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true });
    else runs.push({ text: token.slice(1, -1), code: true });
    last = m.index + token.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}

function runXml(run: Run): string {
  const props: string[] = [];
  if (run.bold) props.push('<w:b/>');
  if (run.code) {
    props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/>');
  }
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  const text = esc(run.text).replace(/\n/g, '<w:br/>');
  return `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

interface ParaOptions {
  heading?: number;
  bullet?: boolean;
  code?: boolean;
  quote?: boolean;
}

function paraXml(runs: Run[], opts: ParaOptions = {}): string {
  const pPr: string[] = [];
  if (opts.heading) {
    const size = [0, 40, 32, 28, 24, 22, 20][Math.min(6, opts.heading)] || 20;
    pPr.push(`<w:spacing w:before="240" w:after="120"/>`);
    // 标题用加粗 + 字号表达，不依赖 styles.xml 里的内置样式名（WPS 也能正常显示）
    runs = runs.map((r) => ({ ...r, bold: true }));
    pPr.push(`<w:outlineLvl w:val="${opts.heading - 1}"/>`);
    return `<w:p><w:pPr>${pPr.join('')}<w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>${runs
      .map((r) => runXml({ ...r, bold: true }))
      .join('')}</w:p>`;
  }
  if (opts.bullet) pPr.push('<w:ind w:left="420" w:hanging="220"/>');
  if (opts.quote) pPr.push('<w:ind w:left="360"/>', '<w:shd w:val="clear" w:fill="F5F5F5"/>');
  if (opts.code) {
    pPr.push('<w:ind w:left="360"/>', '<w:shd w:val="clear" w:fill="F2F2F2"/>');
    runs = runs.map((r) => ({ ...r, code: true }));
  }
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${runs.map(runXml).join('')}</w:p>`;
}

/** Markdown → WordprocessingML 正文 */
export function markdownToDocumentXml(markdown: string): string {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const body: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ');

    if (/^```/.test(line.trim())) {
      if (inCode) {
        body.push(paraXml(parseRuns(codeBuf.join('\n')), { code: true }));
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (!line.trim()) {
      body.push('<w:p/>');
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      body.push(paraXml(parseRuns(heading[2].trim()), { heading: heading[1].length }));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      body.push(paraXml([{ text: '• ' }, ...parseRuns(line.replace(/^\s*[-*+]\s+/, ''))], { bullet: true }));
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      body.push(paraXml(parseRuns(line.trim()), { bullet: true }));
      continue;
    }

    if (/^>\s?/.test(line)) {
      body.push(paraXml(parseRuns(line.replace(/^>\s?/, '')), { quote: true }));
      continue;
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      // 表格行先按文本保留，中文宽度下比"自作聪明拆表"更可靠
      body.push(paraXml([{ text: line.trim() }], { code: true }));
      continue;
    }

    if (/^(\*\*\*|---|___)\s*$/.test(line.trim())) {
      body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr></w:pPr></w:p>');
      continue;
    }

    body.push(paraXml(parseRuns(line)));
  }

  if (inCode && codeBuf.length) body.push(paraXml(parseRuns(codeBuf.join('\n')), { code: true }));

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<w:body>',
    body.join(''),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1247" w:bottom="1440" w:left="1247" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
    '</w:body>',
    '</w:document>',
  ].join('');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Markdown → docx Buffer */
export function markdownToDocx(markdown: string): Buffer {
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(markdownToDocumentXml(markdown), 'utf8') },
  ]);
}
