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
 * 한 문단(w:p)을 만든다. 여러 런을 담을 수 있어 굵은 라벨 + 일반 본문 혼합이 된다.
 * text 는 문자열(단일 런) 또는 [{ t, bold, color, size }] 런 배열.
 * opts: { size, bold, color, before, after(twips), line(줄간격 twips), align,
 *         indent(들여쓰기 twips), topBorder(hex|null), shade(hex|null) }
 */
function para(text, opts = {}) {
  const {
    size = 22,      // 11pt
    bold = false,
    color = null,
    before = 0,
    after = 120,
    line = null,
    align = null,
    indent = 0,
    topBorder = null,
    shade = null,
  } = opts;

  const spacing =
    `<w:spacing w:before="${before}" w:after="${after}"` +
    (line ? ` w:line="${line}" w:lineRule="auto"` : "") +
    "/>";
  const bdr = topBorder
    ? `<w:pBdr><w:top w:val="single" w:sz="6" w:space="6" w:color="${topBorder}"/></w:pBdr>`
    : "";
  const shd = shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : "";
  const ind = indent ? `<w:ind w:left="${indent}"/>` : "";
  const jc = align ? `<w:jc w:val="${align}"/>` : "";

  const ppr = "<w:pPr>" + spacing + bdr + shd + ind + jc + "</w:pPr>";

  const runs = Array.isArray(text)
    ? text
    : [{ t: text, bold, color, size }];

  let runXml = "";
  for (const r of runs) {
    if (r.t == null || r.t === "") continue;
    const rpr =
      "<w:rPr>" +
      (r.bold ? "<w:b/>" : "") +
      `<w:sz w:val="${r.size || size}"/><w:szCs w:val="${r.size || size}"/>` +
      ((r.color || color) ? `<w:color w:val="${r.color || color}"/>` : "") +
      "</w:rPr>";
    runXml += `<w:r>${rpr}<w:t xml:space="preserve">${xe(r.t)}</w:t></w:r>`;
  }
  return `<w:p>${ppr}${runXml}</w:p>`;
}

/* 브랜드 색(딥그린+골드) */
const GREEN = "1B4332";
const GREEN2 = "2D6A4F";
const GOLD = "9A7B29";
const GRAY = "6B7280";
const INK = "1F2937";

/**
 * 섹션 문단 하나를 렌더한다. p 는 문자열 또는 형태 객체.
 *  "본문"                       → 일반 본문
 *  { lead: "..." }               → 도입 문단(조금 큼)
 *  { h3: "소제목" }              → 소제목
 *  { bullet: "..." }             → 불릿 항목
 *  { label: "라벨", text: "..." }→ 굵은 라벨 + 본문(한 줄)
 *  { note: "..." }               → 작은 회색 주석
 */
function renderPara(p) {
  if (typeof p === "string") {
    return para(p, { size: 21, color: INK, after: 130, line: 288 });
  }
  if (p.lead != null) {
    return para(p.lead, { size: 23, color: INK, after: 160, line: 300 });
  }
  if (p.h3 != null) {
    return para(p.h3, { size: 23, bold: true, color: GREEN2, before: 200, after: 90 });
  }
  if (p.bullet != null) {
    return para([{ t: "•  ", bold: true, color: GOLD }, { t: p.bullet, color: INK }],
      { size: 21, after: 90, indent: 260, line: 282 });
  }
  if (p.label != null) {
    return para([{ t: p.label + "  ", bold: true, color: GREEN2 }, { t: p.text || "", color: INK }],
      { size: 21, after: 110, line: 282 });
  }
  if (p.note != null) {
    return para(p.note, { size: 17, color: GRAY, after: 90, line: 270 });
  }
  return para(String(p), { size: 21, color: INK, after: 130 });
}

/**
 * 수준 높은 보고서 한 편을 .docx Buffer 로 만든다.
 * {
 *   title, subtitle,
 *   publisher, date,               // 표지 발행정보
 *   sections: [{ heading, paragraphs:[...] }],
 *   colophon: [string],            // 마지막 판권(발행처 주소·연락처 등)
 *   meta:[string]                  // (구버전 호환) 있으면 표지 아래 회색 줄로 표기
 * }
 */
function buildDocx({
  title = "보고서",
  subtitle = "",
  publisher = "",
  date = "",
  meta = [],
  sections = [],
  colophon = [],
} = {}) {
  const body = [];

  // ── 표지 블록 ──
  body.push(para("R E P O R T", { size: 16, bold: true, color: GOLD, after: 60 }));
  body.push(para(title, { size: 40, bold: true, color: GREEN, after: subtitle ? 40 : 120, line: 360 }));
  if (subtitle) body.push(para(subtitle, { size: 24, color: GREEN2, after: 140, line: 320 }));

  // 발행 정보(가로줄 위)
  const pubRun = [];
  if (publisher) pubRun.push({ t: "발행  ", bold: true, color: GREEN2 }, { t: publisher + "     ", color: INK });
  if (date) pubRun.push({ t: "발행일  ", bold: true, color: GREEN2 }, { t: date, color: INK });
  if (pubRun.length) body.push(para(pubRun, { size: 19, before: 40, after: 60, topBorder: GOLD }));
  for (const m of meta) body.push(para(m, { size: 18, color: GRAY, after: 40 }));
  body.push(para("", { after: 40, topBorder: "D9D9D9" }));

  // ── 섹션 ──
  for (const sec of sections) {
    if (sec.heading) {
      body.push(para(sec.heading, { size: 28, bold: true, color: GREEN, before: 260, after: 110, topBorder: "E5E7EB" }));
    }
    for (const p of sec.paragraphs || []) body.push(renderPara(p));
  }

  // ── 판권(colophon) ──
  if (colophon.length) {
    body.push(para("", { before: 240, after: 60, topBorder: GOLD }));
    colophon.forEach((line, i) => {
      body.push(para(line, { size: i === 0 ? 19 : 17, bold: i === 0, color: i === 0 ? GREEN : GRAY, after: 40 }));
    });
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
