/* kb.js — 사이트 콘텐츠에서 챗봇 지식베이스(KB)를 자동 생성
 *
 * 소스(정본): src/pages.js(PAGES) · 프로젝트/소개 뷰(EJS) · views/people.ejs(이사진) · config(게시판).
 * 페이지를 고치고 서버를 재시작(배포)하면 KB가 자동으로 따라온다. 수동 관리 불필요.
 * 서버 시작 시 1회 빌드해 캐시하며, rebuild()로 강제 재생성할 수 있다.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PAGES } = require("./pages");
const cfg = require("./config");

const VIEWS = path.join(__dirname, "..", "views");

/* 안정 앵커: 기관 개요·연락처(형식이 바뀌어도 정확히 유지) */
const CORE =
  "[기관 개요]\n" +
  "사단법인 도시공동체본부(영문 Urban Community Center)는 행정안전부 소관 비영리 사단법인입니다. " +
  "인구감소·지방소멸 위기의 한계지역 사회적경제 거버넌스를 혁신하기 위해 진단부터 자립까지 직접 솔루션·교육·서비스를 제공하는 도시·공동체 혁신 플랫폼입니다. " +
  "주소: 대전광역시 서구 대덕대로242번길 15, 501호-G19. 전화 1670-9678. 이메일 contact@ucc.or.kr. 웹 ucc.or.kr.";

/* 프로젝트/소개 전용 뷰 (PAGES 로 렌더되지 않는 페이지) */
const EXTRA_VIEWS = [
  ["비전과 목표", "vision.ejs"],
  ["조직도", "org.ejs"],
  ["두잉새롬마당", "forum.ejs"],
  ["커뮤니티모임", "community.ejs"],
  ["문화예술과학융합", "convergence.ejs"],
  ["지역회복 표준체계", "biz.ejs"],
  ["엑스시그마 플랫폼", "xsigma.ejs"],
  ["햇빛소득마을", "solar.ejs"],
];

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function stripEjs(s) { return String(s).replace(/<%[\s\S]*?%>/g, " "); }
function stripHtml(s) {
  let x = String(s)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<span class="[^"]*-en"[^>]*>[\s\S]*?<\/span>/gi, " ") // 영문 라벨(section-en 등) 제거
    .replace(/<\/h[1-6]>/gi, ": ")                                  // 소제목 → 내용과 한 문장으로
    .replace(/<\/(p|li|div|figcaption|dd|dt|td|th)>/gi, ". ")        // 블록 끝 → 문장 경계
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<[^>]+>/g, " ");
  x = decodeEntities(x).replace(/\s+/g, " ").replace(/(\s*\.){2,}/g, ".").replace(/\s+\./g, ".").trim();
  return x;
}
function readView(name) {
  try { return fs.readFileSync(path.join(VIEWS, name), "utf8"); } catch (e) { return ""; }
}
function clip(s, n) {
  s = String(s);
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const p = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("다. "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (p > n * 0.5 ? cut.slice(0, p + 1) : cut).trim() + " …";
}

/* people.ejs → 이사장·상임대표·이사·자문위원을 1인 1문장으로 */
function peopleText() {
  const src = readView("people.ejs");
  if (!src) return "";
  const grab = (marker) => {
    const m = src.match(new RegExp("const\\s+" + marker + "\\s*=\\s*\\[([\\s\\S]*?)\\];"));
    if (!m) return [];
    const objs = m[1].match(/\{[^{}]*name:\s*"[^"]+"[^{}]*\}/g) || [];
    return objs.map((o) => ({
      name: (o.match(/name:\s*"([^"]+)"/) || [])[1] || "",
      spec: (o.match(/specialty:\s*"([^"]*)"/) || [])[1] || (o.match(/pos:\s*"([^"]*)"/) || [])[1] || "",
    })).filter((x) => x.name);
  };
  const dirs = grab("directors");
  const advs = grab("advisors");
  const execName = (src.match(/exec-name[^>]*>\s*([^<]+?)\s*</) || [])[1] || "";
  const execRole = (src.match(/exec-role[^>]*>\s*([^<]+?)\s*</) || [])[1] || "상임대표";
  // 이사장: 인사말(PAGES.greeting)에서 추출
  const greet = (PAGES.greeting && PAGES.greeting.html) || "";
  const chair = greet.match(/이사장\s*<strong>\s*([^<]+?)\s*<\/strong>\s*([가-힣]*)/);

  const lines = ["[사람들]"];
  if (chair) lines.push(`도시공동체본부의 이사장은 ${chair[1].trim()}${chair[2] ? " " + chair[2].trim() : ""}입니다.`);
  if (execName) lines.push(`${execRole}는 ${execName}입니다.`);
  for (const d of dirs) lines.push(`${d.name} 이사${d.spec ? `는 ${d.spec} 분야를 맡고 있습니다` : "님입니다"}.`);
  for (const a of advs) lines.push(`${a.name} 자문위원${a.spec ? `는 ${a.spec} 분야입니다` : "님입니다"}.`);
  return lines.join("\n");
}

/* 게시판(알림마당) */
function boardsText() {
  const list = cfg.BOARD_KEYS.map((k) => `${cfg.BOARDS[k].name} — ${cfg.BOARDS[k].desc}`).join("\n");
  return "[알림마당]\n" + list;
}

/* -------------------------------------------------- KB 조립 + 청크 */
let _kb = null, _chunks = null;

function build() {
  const parts = [CORE];

  // PAGES(본부소개·회원·교육 등) 전부 자동 포함
  for (const key of Object.keys(PAGES)) {
    const p = PAGES[key];
    const text = stripHtml(p.html || "");
    if (text) parts.push(`[${p.title}]\n${clip(text, 1200)}`);
  }

  parts.push(boardsText());

  const pe = peopleText();
  if (pe) parts.push(pe);

  for (const [label, file] of EXTRA_VIEWS) {
    const t = stripHtml(stripEjs(readView(file)));
    if (t) parts.push(`[${label}]\n${clip(t, 900)}`);
  }

  _kb = parts.join("\n\n");

  // 로컬 검색용 청크(섹션 단위)
  _chunks = parts.map((blk) => {
    const nl = blk.indexOf("\n");
    const title = nl > 0 ? blk.slice(0, nl).replace(/^\[|\]$/g, "").trim() : "";
    const text = nl > 0 ? blk.slice(nl + 1).trim() : blk.trim();
    return { title, text, titleKey: title.normalize("NFC").toLowerCase(), key: (title + " " + text).normalize("NFC").toLowerCase() };
  }).filter((c) => c.text);

  return _kb;
}

function getKB() { if (_kb == null) build(); return _kb; }
function getChunks() { if (_chunks == null) build(); return _chunks; }
function rebuild() { _kb = null; _chunks = null; return getKB(); }

module.exports = { getKB, getChunks, rebuild };
