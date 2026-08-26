/* 지구촌소식 AI기자 — 주간 '사회연대경제 전환' 이슈리포트 자동 발행
 *
 * 단순 기사 수집이 아니라, 매주 하나의 의미 있는 주제를 정해 관련 자료를 조사하고
 * 그 전체를 한 편의 '수준 높은 보고서'로 종합해 발행한다.
 *   1) 주제 선정(주차별 로테이션) → 2) 관련 자료 리서치(Daum→Google)
 *   3) Gemini 로 보고서 원고 집필(출처 자료 기반, 해외사례 심층)
 *   4) docx 로 세련되게 조판(표지·발행정보·판권) + 요약을 게시글 본문으로
 *   5) 'global' 게시판에 글 등록 + docx 첨부 (완전 자동, 주 1회)
 *
 * 발행: 도시공동체본부 / 집필 초안: 지구촌소식 AI기자.
 * 저작권: 원문 전문을 저장하지 않는다. 우리가 쓴 분석·요약 + 출처 링크만 남긴다.
 * 환각 방지: 집필 지침에서 '제공된 출처 자료와 널리 알려진 배경 사실'만 쓰도록 강제하고,
 *   참고자료(링크)는 LLM 이 아니라 실제 수집 목록으로 코드가 직접 붙인다.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { db, UPLOAD_DIR } = require("./db");
const { fromDaum, fromGoogle } = require("./newsletter");
const { buildDocx } = require("./docx");

const AUTHOR = "도시공동체본부";        // 발행인(게시글 작성자 표기)
const PERSONA = "지구촌소식 AI기자";     // 집필 페르소나
const BOARD = "global";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const COLOPHON = [
  "사단법인 도시공동체본부  ·  행정안전부 소관 비영리법인",
  "대전광역시 서구 대덕대로242번길 15, 501호-G19",
  "Tel. 1670-9678   ·   E-mail. contact@ucc.or.kr",
  "본 리포트는 지구촌소식 AI기자가 공개자료를 바탕으로 자동 작성한 것이며, 인용 원문의 저작권은 각 매체에 있습니다.",
];

/* Gemini(Generative Language API) — 텍스트 집필 */
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const GEMINI_TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || "gemini-2.0-flash";

/**
 * 주간 주제. 모두 해외 사례를 중심으로 사회연대경제(사회적경제·공동체·협동조합)로의
 * 전환 흐름에 맞닿은 주제만 골랐다. 주차별로 하나씩 돌아가며 다룬다.
 */
const THEMES = [
  {
    key: "sse-policy",
    title: "해외 사회연대경제 정책의 최신 흐름",
    focus: "각국이 사회연대경제를 제도로 뒷받침하는 방식과 그 시사점",
    queries: ["해외 사회연대경제 정책", "유럽 사회적경제 법", "사회연대경제 국제 동향"],
  },
  {
    key: "coops",
    title: "협동조합이 떠받치는 지역경제, 해외의 실험",
    focus: "노동자·소비자·플랫폼 협동조합이 지역 고용과 돌봄을 지탱하는 사례",
    queries: ["해외 협동조합 지역경제", "노동자협동조합 사례", "플랫폼 협동조합 해외"],
  },
  {
    key: "community",
    title: "주민이 소유하는 공동체경제, 해외 사례",
    focus: "주민이 자원과 돌봄을 함께 소유·운영하는 공동체경제 모델",
    queries: ["해외 지역공동체 경제", "커뮤니티 자산 해외 사례", "주민참여 마을기업 해외"],
  },
  {
    key: "energy",
    title: "주민참여 에너지전환과 연대경제",
    focus: "주민이 발전 수익을 나누는 에너지 공동체와 햇빛소득마을의 접점",
    queries: ["해외 에너지 협동조합", "주민참여 재생에너지 마을 해외", "커뮤니티 에너지 해외"],
  },
  {
    key: "care",
    title: "돌봄을 다시 짜는 사회적경제, 해외의 길",
    focus: "돌봄·복지 공백을 사회적경제가 메우는 해외 제도와 현장",
    queries: ["해외 사회적협동조합 돌봄", "돌봄 사회적경제 해외", "커뮤니티 케어 해외 사례"],
  },
  {
    key: "finance",
    title: "연대금융, 사회적경제를 지탱하는 돈의 구조",
    focus: "사회적경제 조직을 키우는 인내자본·연대금융·중간지원 생태계",
    queries: ["해외 연대금융 사례", "사회적금융 해외", "임팩트 금융 지역 해외"],
  },
];

const insertPost = db.prepare(
  `INSERT INTO posts (board, title, content, author, pinned, created_at, updated_at, source_guid)
   VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
);
const existsGuid = db.prepare("SELECT 1 FROM posts WHERE source_guid = ?");
const insertAttach = db.prepare(
  `INSERT INTO attachments (post_id, filename, original, mimetype, size, sort)
   VALUES (?, ?, ?, ?, ?, 0)`
);

/* ------------------------------------------------------------ 유틸 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ISO 시각 → 'YYYY. MM. DD.' (KST) */
function fmtKst(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}. ${String(k.getUTCMonth() + 1).padStart(2, "0")}. ${String(k.getUTCDate()).padStart(2, "0")}.`;
}

/** ISO 주차 키 { year, week, key } */
function isoWeek(date) {
  const dt = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return { year: dt.getUTCFullYear(), week, key: `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}` };
}

/** 요약 발췌(원문 전문 방지) */
function buildExcerpt(item, maxChars = 500) {
  const raw = String(item.content || item.summary || "").replace(/\s+/g, " ").trim();
  if (raw.length < 20) return String(item.summary || "").replace(/\s+/g, " ").trim();
  if (raw.length <= maxChars) return raw;
  return raw.slice(0, maxChars - 1).trim() + "…";
}

function safeFileName(s) {
  return String(s || "보고서")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "보고서";
}

/* --------------------------------------------------- 1) 자료 리서치 */

async function researchSources(theme, { maxSources = 8 } = {}) {
  const seen = new Set();
  const sources = [];
  for (const q of theme.queries) {
    if (sources.length >= maxSources) break;
    let items = [];
    try {
      items = await fromDaum(q);
      if (!items || !items.length) items = await fromGoogle(q);
    } catch (e) {
      console.error("[report] 리서치 실패:", q, e.message);
      continue;
    }
    for (const it of items || []) {
      if (sources.length >= maxSources) break;
      if (!it.title || !it.url) continue;
      const key = (it.guid || it.url).split("?")[0];
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        title: String(it.title).replace(/\s+/g, " ").trim(),
        source: it.source || "",
        url: it.url,
        date: fmtKst(it.published_at),
        excerpt: buildExcerpt(it),
      });
    }
    await sleep(300);
  }
  return sources;
}

/* --------------------------------------------- 2) Gemini 집필 호출 */

async function geminiJson(prompt, ms = 45000) {
  const key = GEMINI_KEY();
  if (!key) return null;
  const url = `${GEMINI_BASE()}/v1beta/models/${GEMINI_TEXT_MODEL()}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: "application/json" },
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) { console.error("[report] Gemini HTTP", r.status, t.slice(0, 200)); return null; }
    let data; try { data = JSON.parse(t); } catch { return null; }
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const txt = (parts && parts.map((p) => p.text || "").join("")) || "";
    if (!txt) return null;
    try { return JSON.parse(txt); } catch {
      const m = txt.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch {} }
      return null;
    }
  } catch (e) {
    console.error("[report] Gemini 호출 오류:", e.message);
    return null;
  } finally { clearTimeout(to); }
}

function buildPrompt(theme, sources) {
  const src = sources.map((s, i) =>
    `[출처 ${i + 1}] 제목: ${s.title}\n매체: ${s.source || "미상"} / 보도일: ${s.date || "미상"}\n발췌: ${s.excerpt}`
  ).join("\n\n");

  return [
    "당신은 사단법인 도시공동체본부의 리서처 '지구촌소식 AI기자'입니다.",
    `주제: "${theme.title}" — ${theme.focus}`,
    "아래 [출처] 자료들을 종합해, 해외 사례를 특히 자세히 소개하는 수준 높은 한국어 이슈리포트를 작성하세요.",
    "",
    "엄격한 규칙:",
    "- 제공된 출처 자료와 널리 알려진 배경 사실만 사용합니다. 출처에 없는 구체적 수치·인명·연도를 지어내지 마세요.",
    "- 과장 없이 사실 중심으로, 공공기관 발행물다운 차분하고 신뢰감 있는 문체로 씁니다.",
    "- 해외 사례는 국가/사례별로 소제목을 나눠 배경·작동방식·의미를 구체적으로 설명합니다.",
    "- '참고자료'는 작성하지 마세요(코드가 실제 링크로 자동 추가합니다).",
    "",
    "다음 JSON 스키마로만 답하세요(설명·코드블록 없이 JSON 객체 하나):",
    "{",
    '  "title": "보고서 제목(30자 내외)",',
    '  "subtitle": "한 줄 부제",',
    '  "summary": "게시글 본문용 개요 3~5문장(핵심 요지)",',
    '  "sections": [',
    '    { "heading": "1. 개요", "paragraphs": ["문단", {"lead":"도입문단"}] },',
    '    { "heading": "2. 배경", "paragraphs": ["문단", {"bullet":"항목"}] },',
    '    { "heading": "3. 해외 사례", "paragraphs": [{"h3":"국가/사례 소제목"}, "설명 문단"] },',
    '    { "heading": "4. 시사점", "paragraphs": [{"bullet":"시사점"}] },',
    '    { "heading": "5. 도시공동체본부의 관점", "paragraphs": ["문단"] }',
    "  ]",
    "}",
    "paragraphs 항목은 문자열 또는 {\"h3\":..}, {\"bullet\":..}, {\"lead\":..}, {\"label\":..,\"text\":..} 중 하나입니다.",
    "",
    "=== 출처 자료 ===",
    src || "(수집된 자료가 부족합니다. 주제에 대한 일반적·검증된 배경 지식으로 신중히 작성하되 구체 수치는 피하세요.)",
  ].join("\n");
}

/** LLM 실패 시: 수집 자료로 만든 기본 다이제스트 리포트 */
function fallbackReport(theme, sources) {
  const sections = [
    { heading: "1. 개요", paragraphs: [
      { lead: `${theme.focus}. 이번 호는 관련 해외 보도를 모아 핵심 흐름과 시사점을 정리한다.` },
      { note: "※ 자동 요약본입니다. 각 사례의 자세한 내용은 아래 원문 링크에서 확인해 주세요." },
    ] },
  ];
  if (sources.length) {
    sections.push({
      heading: "2. 주요 보도와 사례",
      paragraphs: sources.flatMap((s) => [
        { h3: s.title },
        { label: "매체·보도", text: `${s.source || "미상"} · ${s.date || "미상"}` },
        s.excerpt,
      ]),
    });
  }
  sections.push({
    heading: "3. 시사점",
    paragraphs: [
      { bullet: "해외의 제도·금융·중간지원 설계를 국내 현실에 맞게 번역할 필요가 있다." },
      { bullet: "주민이 소유하고 수익을 나누는 구조가 지역회복의 지속가능성을 높인다." },
    ],
  });
  return {
    title: theme.title,
    subtitle: theme.focus,
    summary: `${theme.focus}. 관련 해외 보도 ${sources.length}건을 모아 핵심 흐름과 시사점을 정리했습니다.`,
    sections,
  };
}

/* ---------------------------------------------- 3) 보고서 조립 */

/** 렌더 가능한 문단 형태로 정규화(LLM 출력 방어) */
function normParas(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => {
    if (typeof p === "string") return p;
    if (p && typeof p === "object") {
      if (p.h3 != null || p.bullet != null || p.lead != null || p.note != null || (p.label != null && p.text != null)) return p;
      if (p.text != null) return String(p.text);
    }
    return String(p);
  });
}

/** 실제 수집 목록으로 참고자료 섹션(링크)을 직접 만든다 */
function referencesSection(sources) {
  const paras = [];
  sources.forEach((s, i) => {
    paras.push({ label: `${i + 1}.`, text: `${s.title} (${s.source || "미상"}, ${s.date || "미상"})` });
    if (s.url) paras.push({ note: s.url });
  });
  paras.push({ note: "※ 인용 원문의 저작권은 각 매체에 있으며, 전체 내용은 위 링크에서 확인할 수 있습니다." });
  return { heading: "참고자료", paragraphs: paras };
}

function makeReportDocx(report, sources, weekKey) {
  const sections = (report.sections || []).map((s) => ({
    heading: String(s.heading || "").trim(),
    paragraphs: normParas(s.paragraphs),
  }));
  sections.push(referencesSection(sources));

  return buildDocx({
    title: report.title || "사회연대경제 이슈리포트",
    subtitle: report.subtitle || "",
    publisher: AUTHOR,
    date: fmtKst(new Date().toISOString()),
    meta: [`분류  주간 이슈리포트 · 사회연대경제`, `발행호  ${weekKey}  ·  집필 ${PERSONA}`],
    sections,
    colophon: COLOPHON,
  });
}

/** 게시글 본문(요약본) — 순수 텍스트 */
function makePostBody(report, sources, weekKey) {
  const lines = [];
  lines.push(String(report.summary || report.subtitle || "").trim(), "");
  lines.push("○ 이번 리포트가 다루는 내용");
  for (const s of report.sections || []) {
    if (s.heading) lines.push(`· ${String(s.heading).replace(/^\d+\.\s*/, "")}`);
  }
  lines.push("");
  lines.push("○ 전체 보고서");
  lines.push("표지·발행정보·해외사례 심층 소개를 담은 전체 보고서를 아래 첨부(docx)로 내려받을 수 있습니다.");
  lines.push("");
  if (sources.length) {
    lines.push("○ 참고자료");
    sources.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title} — ${s.source || "미상"}`);
      if (s.url) lines.push(`   ${s.url}`);
    });
    lines.push("");
  }
  lines.push(`※ 본 리포트는 지구촌소식 AI기자가 공개자료를 바탕으로 자동 작성한 것입니다(발행 ${AUTHOR}, ${weekKey}). 인용 원문의 저작권은 각 매체에 있습니다.`);
  return lines.join("\n");
}

/* --------------------------------------------- 4) 발행(글+첨부) */

function publishReport(report, sources, weekKey, themeKey) {
  const guid = `report:${weekKey}:${themeKey}`;
  const title = `[리포트] ${String(report.title || "사회연대경제 이슈리포트").replace(/\s+/g, " ").trim()}`.slice(0, 200);
  const now = new Date().toISOString();

  const res = insertPost.run(BOARD, title, makePostBody(report, sources, weekKey), AUTHOR, now, now, guid);
  const postId = Number(res.lastInsertRowid);

  try {
    const buf = makeReportDocx(report, sources, weekKey);
    const stored = crypto.randomBytes(12).toString("hex") + ".docx";
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
    const original = safeFileName(`${report.title || "사회연대경제 이슈리포트"} (${weekKey})`) + ".docx";
    insertAttach.run(postId, stored, original, DOCX_MIME, buf.length);
    return { postId, title, attached: true };
  } catch (e) {
    console.error("[report] docx 첨부 실패(post " + postId + "):", e.message);
    return { postId, title, attached: false };
  }
}

/* -------------------------------------------------- 1회 발행 실행 */

/**
 * 이번 주 리포트를 만든다. 주차별로 주제를 로테이션하며, 같은 주차·주제 글이
 * 이미 있으면(수동/자동 중복 실행) 건너뛴다.
 * force:true 면 주차 중복이어도 새 주제로 강제 발행(관리자 '지금 발행'용).
 */
async function collectOnce({ force = false } = {}) {
  const wk = isoWeek(new Date());
  let idx = (wk.week - 1) % THEMES.length;
  if (force) {
    // 이미 이번 주 주제가 있으면 다음 주제로 밀어 새 리포트를 만든다
    for (let n = 0; n < THEMES.length; n++) {
      const t = THEMES[(idx + n) % THEMES.length];
      if (!existsGuid.get(`report:${wk.key}:${t.key}`)) { idx = (idx + n) % THEMES.length; break; }
    }
  }
  const theme = THEMES[idx];
  const guid = `report:${wk.key}:${theme.key}`;

  if (!force && existsGuid.get(guid)) {
    console.log(`[report] 이번 주 리포트 이미 발행됨: ${guid}`);
    return { published: false, reason: "exists", weekKey: wk.key, theme: theme.key };
  }

  console.log(`[report] 리포트 작성 시작 — ${wk.key} / ${theme.title}`);
  const sources = await researchSources(theme);
  console.log(`[report] 자료 ${sources.length}건 수집`);

  let report = await geminiJson(buildPrompt(theme, sources));
  let ai = true;
  if (!report || !report.sections || !report.sections.length) {
    console.warn("[report] LLM 집필 실패 → 기본 다이제스트로 대체");
    report = fallbackReport(theme, sources);
    ai = false;
  }

  const out = publishReport(report, sources, wk.key, theme.key);
  console.log(`[report] 발행 완료 — post ${out.postId} (${ai ? "AI집필" : "다이제스트"}, 첨부 ${out.attached})`);
  return { published: true, ai, weekKey: wk.key, theme: theme.key, ...out };
}

/* ------------------- 스케줄러: 매주 월요일 08:30 (서버 시간) ------- */

function msUntilWeekly(weekday, hour, minute) {
  const now = new Date();
  const t = new Date(now);
  t.setHours(hour, minute, 0, 0);
  let add = (weekday - now.getDay() + 7) % 7;
  if (add === 0 && t <= now) add = 7;
  t.setDate(t.getDate() + add);
  return t.getTime() - now.getTime();
}

function startScheduler() {
  const WD = 1, H = 8, M = 30; // 월요일 08:30
  const run = async () => {
    try { await collectOnce(); } catch (e) { console.error("[report] 주간 발행 오류:", e.message); }
    setTimeout(run, msUntilWeekly(WD, H, M));
  };
  setTimeout(run, msUntilWeekly(WD, H, M));
  const next = new Date(Date.now() + msUntilWeekly(WD, H, M));
  console.log(`[report] 주간 스케줄러 시작 — 다음 발행: ${next.toLocaleString()}`);
}

module.exports = { collectOnce, startScheduler, THEMES, AUTHOR, PERSONA, BOARD };
