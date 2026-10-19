/* fileparse.js — 업로드 파일에서 텍스트 추출(무의존, node:zlib만 사용)
 *
 * 지원: .txt/.md/.csv(그대로), .docx(word/document.xml), .pptx(ppt/slides/*.xml)
 * PDF 등 한글 CID 폰트 기반 포맷은 추출 신뢰도가 낮아 제외(파일명만 등록).
 * 모든 추출은 try/catch로 감싸 실패 시 빈 문자열을 반환한다.
 */
"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");

/** ZIP(버퍼)에서 이름이 nameRe에 맞는 엔트리들의 압축 해제 버퍼를 반환 */
function unzipEntries(buf, nameRe) {
  const out = [];
  let i = 0;
  while (i < buf.length - 4) {
    // 로컬 파일 헤더 시그니처 PK\x03\x04
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const method = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const name = buf.slice(i + 30, i + 30 + nameLen).toString("utf8");
      const dataStart = i + 30 + nameLen + extraLen;
      // 데이터 디스크립터(compSize=0)인 경우는 건너뜀(간단화) — 대부분의 Office 파일은 크기가 기록됨
      if (compSize > 0 && dataStart + compSize <= buf.length && nameRe.test(name)) {
        try {
          const comp = buf.slice(dataStart, dataStart + compSize);
          const data = method === 8 ? zlib.inflateRawSync(comp) : comp;
          out.push({ name, text: data.toString("utf8") });
        } catch (_) { /* skip */ }
      }
      i = compSize > 0 ? dataStart + compSize : dataStart;
    } else i++;
  }
  return out;
}

function xmlToText(xml) {
  return String(xml)
    .replace(/<w:p[ >]/g, "\n<w:p ").replace(/<a:p>/g, "\n<a:p>") // 문단 경계
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

function fromDocx(buf) {
  const parts = unzipEntries(buf, /^word\/document\.xml$/);
  return parts.map((p) => xmlToText(p.text)).join("\n").trim();
}
function fromPptx(buf) {
  const parts = unzipEntries(buf, /^ppt\/slides\/slide\d+\.xml$/);
  return parts.map((p) => xmlToText(p.text)).join("\n").trim();
}

/** 텍스트가 '실제 내용'으로 보이는지(한글/영문 비율) */
function looksText(s) {
  if (!s || s.length < 40) return false;
  const good = (s.match(/[가-힣A-Za-z0-9]/g) || []).length;
  return good / s.length > 0.3;
}

/** 파일 경로 → 추출 텍스트(없으면 "") */
function extractText(filePath) {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  try {
    if (ext === "txt" || ext === "md" || ext === "csv") {
      const t = fs.readFileSync(filePath, "utf8");
      return looksText(t) ? t : "";
    }
    if (ext === "docx") { const t = fromDocx(fs.readFileSync(filePath)); return looksText(t) ? t : ""; }
    if (ext === "pptx") { const t = fromPptx(fs.readFileSync(filePath)); return looksText(t) ? t : ""; }
  } catch (_) { /* skip */ }
  return "";
}

const PARSEABLE = /\.(txt|md|csv|docx|pptx)$/i;

module.exports = { extractText, PARSEABLE, unzipEntries };
