/* docx.js — 의존성 없는 .docx(Word) 생성기
 *
 * .docx 는 결국 XML 파일 몇 개를 담은 ZIP 컨테이너다.
 * 외부 패키지 없이 Node 내장 zlib 만으로 ZIP(local header + central dir + EOCD)을
 * 직접 조립한다. 서식은 명명 스타일 대신 런 속성(굵기·크기·색)으로 직접 지정해
 * styles.xml 없이도 Word/한글/구글문서에서 그대로 열린다.
 *
 * 사용:
 *   const { buildDocx } = require("./docx");
 *   const buf = buildDocx({
 *     title: "보고서 제목",
 *     meta:  ["매체: …", "작성: 지구촌소식 AI기자"],
 *     sections: [
 *       { heading: "요약", paragraphs: ["문단1", "문단2"] },
 *       { heading: "원문 정보", paragraphs: ["링크: https://…"] },
 *     ],
 *   });
 *   fs.writeFileSync("out.docx", buf);
 */
"use strict";

const zlib = require("node:zlib");

/* ------------------------------------------------------------ CRC32 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/* -------------------------------------------------------------- ZIP */

/**
 * 파일 목록을 ZIP(Buffer)으로 만든다.
 * entries: [{ name, data(Buffer), store(bool) }]
 * store=true 면 무압축(저장), 아니면 deflate.
 */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const uncompSize = e.data.length;
    let method, body;
    if (e.store) {
      method = 0;
      body = e.data;
    } else {
      method = 8;
      body = zlib.deflateRawSync(e.data);
    }
    const compSize = body.length;

    // 로컬 파일 헤더 (UTF-8 파일명 플래그 bit 11)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);       // version needed
    lh.writeUInt16LE(0x0800, 6);   // flags: UTF-8
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);       // mod time
    lh.writeUInt16LE(0x21, 12);    // mod date (1980-01-01)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compSize, 18);
    lh.writeUInt32LE(uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);       // extra len
    locals.push(lh, nameBuf, body);

    // 중앙 디렉터리 헤더
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);       // version made by
    ch.writeUInt16LE(20, 6);       // version needed
    ch.writeUInt16LE(0x0800, 8);   // flags: UTF-8
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);       // mod time
    ch.writeUInt16LE(0x21, 14);    // mod date
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compSize, 20);
    ch.writeUInt32LE(uncompSize, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);       // extra len
    ch.writeUInt16LE(0, 32);       // comment len
    ch.writeUInt16LE(0, 34);       // disk number
    ch.writeUInt16LE(0, 36);       // internal attrs
    ch.writeUInt32LE(0, 38);       // external attrs
    ch.writeUInt32LE(offset, 42);  // local header offset
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const centralSize = centralBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                  // disk number
  eocd.writeUInt16LE(0, 6);                  // disk w/ central dir
  eocd.writeUInt16LE(entries.length, 8);     // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);    // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);                 // comment len

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ------------------------------------------------------- OOXML 조립 */

/** XML 특수문자 이스케이프 */
function xe(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 한 문단(w:p)을 만든다.
 * opts: { size(반포인트), bold, color(hex 6자리), before, after(단위 twips), align }
 */
function para(text, opts = {}) {
  const {
    size = 22,      // 11pt
    bold = false,
    color = null,
    before = 0,
    after = 120,
    align = null,
  } = opts;

  const rpr =
    "<w:rPr>" +
    (bold ? "<w:b/>" : "") +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    (color ? `<w:color w:val="${color}"/>` : "") +
    "</w:rPr>";

  const ppr =
    "<w:pPr>" +
    `<w:spacing w:before="${before}" w:after="${after}"/>` +
    (align ? `<w:jc w:val="${align}"/>` : "") +
    "</w:pPr>";

  // 빈 문단(간격용)도 허용
  const run = text === "" ? "" : `<w:r>${rpr}<w:t xml:space="preserve">${xe(text)}</w:t></w:r>`;
  return `<w:p>${ppr}${run}</w:p>`;
}

/**
 * 보고서 구조를 받아 .docx Buffer 를 만든다.
 * { title, meta:[string], sections:[{ heading, paragraphs:[string] }] }
 */
function buildDocx({ title = "보고서", meta = [], sections = [] } = {}) {
  const body = [];

  // 제목
  body.push(para(title, { size: 36, bold: true, color: "1B4332", after: 80 }));

  // 메타(매체·작성자 등) — 회색 작은 글씨
  for (const m of meta) {
    body.push(para(m, { size: 18, color: "6B7280", after: 40 }));
  }
  if (meta.length) body.push(para("", { after: 120 }));

  // 섹션
  for (const sec of sections) {
    if (sec.heading) {
      body.push(para(sec.heading, { size: 26, bold: true, color: "2D6A4F", before: 160, after: 80 }));
    }
    for (const p of sec.paragraphs || []) {
      body.push(para(p, { size: 22, after: 120 }));
    }
  }

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" +
    body.join("") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
    "</w:sectPr>" +
    "</w:body></w:document>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
  ]);
}

module.exports = { buildDocx };
