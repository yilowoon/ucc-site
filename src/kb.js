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
const { db, UPLOAD_DIR } = require("./db");
const fileparse = require("./fileparse");

const VIEWS = path.join(__dirname, "..", "views");
const REBUILD_TTL_MS = 10 * 60 * 1000; // DB·파일 콘텐츠 변동 반영(10분)

/* 안정 앵커: 기관 개요·연락처(형식이 바뀌어도 정확히 유지) */
const CORE =
  "[기관 개요]\n" +
  "사단법인 도시공동체본부(영문 Urban Community Center)는 행정안전부 소관 비영리 사단법인입니다. " +
  "인구감소·지방소멸 위기의 한계지역 사회적경제 거버넌스를 혁신하기 위해 진단부터 자립까지 직접 솔루션·교육·서비스를 제공하는 도시·공동체 혁신 플랫폼입니다. " +
  "주소: 대전광역시 유성구 대정로 28번안길 71. 전화 1670-9678. 이메일 contact@ucc.or.kr. 웹 ucc.or.kr.";

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

/* 게시물(알림마당 글) — DB 콘텐츠를 RAG 데이터로 */
function postChunks() {
  const out = [];
  try {
    const rows = db.prepare("SELECT id, board, title, content, created_at FROM posts ORDER BY created_at DESC").all();
    for (const p of rows) {
      const text = stripHtml(p.content || "");
      if (!text) continue;
      const bname = (cfg.BOARDS[p.board] && cfg.BOARDS[p.board].name) || p.board || "게시판";
      out.push({ title: `${bname} · ${p.title}`, text: clip(text, 1500), source: "게시물",
        url: `/board/${p.board}/${p.id}`, date: String(p.created_at || "").slice(0, 10) });
    }
  } catch (_) {}
  return out;
}

/* 뉴스레터(데일리뉴스·지구촌소식브리프) — 제목+요약 */
function newsletterChunks() {
  const out = [];
  try {
    const rows = db.prepare("SELECT id, title, summary, content, published_at FROM newsletter ORDER BY published_at DESC LIMIT 180").all();
    for (const n of rows) {
      const text = stripHtml((n.summary || "") + " " + (n.content || ""));
      if (!text) continue;
      out.push({ title: `뉴스 · ${n.title}`, text: clip(text, 800), source: "뉴스레터",
        url: `/newsletter/${n.id}`, date: String(n.published_at || "").slice(0, 10) });
    }
  } catch (_) {}
  return out;
}

/* 업로드 자료(문서) — docx/pptx/txt 등 파싱 */
function fileChunks() {
  const out = [];
  let files = [];
  try { files = fs.readdirSync(UPLOAD_DIR); } catch (_) { return out; }
  for (const f of files) {
    if (!fileparse.PARSEABLE.test(f)) continue;
    let text = "";
    try { text = fileparse.extractText(path.join(UPLOAD_DIR, f)); } catch (_) {}
    if (!text) continue;
    text = text.replace(/\s+/g, " ").trim();
    const base = f.replace(/\.[^.]+$/, "");
    // 해시형 파일명이면 본문 앞부분을 제목으로
    const title = /^[0-9a-f]{10,}$/i.test(base) ? clip(text, 46).replace(/ …$/, "") : base;
    out.push({ title: `자료 · ${title}`, text: clip(text, 2200), source: "업로드자료",
      url: `/uploads/${encodeURIComponent(f)}` });
  }
  return out;
}

/* -------------------------------------------------- KB 조립 + 청크 */
let _kb = null, _chunks = null, _builtAt = 0;

function toChunk(title, text, source, url, date) {
  return { title, text, source: source || "안내", url: url || "", date: date || "",
    titleKey: String(title).normalize("NFC").toLowerCase(),
    key: (title + " " + text).normalize("NFC").toLowerCase() };
}

function build() {
  const chunks = [];
  // 1) 안정 앵커(기관 개요)
  chunks.push(toChunk("기관 개요", CORE.replace(/^\[기관 개요\]\n/, ""), "안내"));

  // 2) PAGES(본부소개·회원·교육 등)
  for (const key of Object.keys(PAGES)) {
    const p = PAGES[key];
    const text = stripHtml(p.html || "");
    if (text) chunks.push(toChunk(p.title, clip(text, 1200), "안내", p.path || ""));
  }
  // 3) 알림마당 개요 + 사람들 + 프로젝트 뷰
  chunks.push(toChunk("알림마당", boardsText().replace(/^\[알림마당\]\n/, ""), "안내"));
  const pe = peopleText();
  if (pe) chunks.push(toChunk("사람들", pe.replace(/^\[사람들\]\n/, ""), "안내", "/members/board"));
  for (const [label, file] of EXTRA_VIEWS) {
    const t = stripHtml(stripEjs(readView(file)));
    if (t) chunks.push(toChunk(label, clip(t, 900), "안내"));
  }
  // 4) DB 콘텐츠(게시물·뉴스레터) + 업로드 자료
  for (const c of postChunks()) chunks.push(toChunk(c.title, c.text, c.source, c.url, c.date));
  for (const c of newsletterChunks()) chunks.push(toChunk(c.title, c.text, c.source, c.url, c.date));
  for (const c of fileChunks()) chunks.push(toChunk(c.title, c.text, c.source, c.url));

  _chunks = chunks.filter((c) => c.text);
  _kb = _chunks.map((c) => `[${c.title}]\n${c.text}`).join("\n\n");
  _builtAt = Date.now();
  return _kb;
}

function ensureFresh() {
  if (_chunks == null || Date.now() - _builtAt > REBUILD_TTL_MS) build();
}
function getKB() { ensureFresh(); return _kb; }
function getChunks() { ensureFresh(); return _chunks; }
function rebuild() { _kb = null; _chunks = null; _builtAt = 0; return getKB(); }

/* 지식베이스 현황(관리자용) */
function stats() {
  ensureFresh();
  const bySource = {};
  let chars = 0;
  for (const c of _chunks) { bySource[c.source] = (bySource[c.source] || 0) + 1; chars += c.text.length; }
  return { total: _chunks.length, bySource, chars, builtAt: new Date(_builtAt).toISOString() };
}

module.exports = { getKB, getChunks, rebuild, stats };
