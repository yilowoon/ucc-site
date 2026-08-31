/* 지구촌소식브리프 — 주간 '사회연대경제 전환' 이슈 브리프 자동 발행
 *
 * 단순 기사 수집이 아니라, 매주 하나의 의미 있는 주제를 정해 관련 자료를 조사하고
 * 그 전체를 한 편의 '수준 높은 보고서'로 종합해 발행한다.
 *   1) 주제 선정(주차별 로테이션) → 2) 관련 자료 리서치(Daum→Google)
 *   3) Gemini 로 보고서 원고 집필(출처 자료 기반, 해외사례 심층)
 *   4) docx 로 세련되게 조판(표지·발행정보·판권) + 요약을 게시글 본문으로
 *   5) 'global' 게시판에 글 등록 + docx 첨부 (완전 자동, 주 1회)
 *
 * 발행: 도시공동체본부 / 발간물명: 지구촌소식브리프.
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
const PERSONA = "지구촌소식브리프";      // 발간물 브랜드
const BOARD = "global";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const COLOPHON = [
  "사단법인 도시공동체본부  ·  행정안전부 소관 비영리법인",
  "대전광역시 서구 대덕대로242번길 15, 501호-G19",
  "Tel. 1670-9678   ·   E-mail. contact@ucc.or.kr",
  `본 자료는 도시공동체본부가 공개자료를 바탕으로 주간 정리한 '${PERSONA}'이며, 인용 원문의 저작권은 각 매체에 있습니다.`,
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

/** 요약 발췌(원문 전문 방지) — LLM 근거용이라 넉넉히, 단 전문 저장은 피한다 */
function buildExcerpt(item, maxChars = 1000) {
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

async function geminiJson(prompt, { ms = 90000, maxTokens = 8192, temperature = 0.5 } = {}) {
  const key = GEMINI_KEY();
  if (!key) return null;
  const url = `${GEMINI_BASE()}/v1beta/models/${GEMINI_TEXT_MODEL()}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
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

/** 출처 자료를 프롬프트용 텍스트 블록으로 */
function sourceBlock(sources) {
  if (!sources.length) return "(수집 자료가 부족합니다. 주제에 대한 널리 알려진·검증된 배경지식으로 신중히 작성하되, 불확실한 구체 수치·고유명사는 단정하지 마세요.)";
  return sources.map((s, i) =>
    `[출처 ${i + 1}] ${s.title}\n  매체: ${s.source || "미상"} / 보도일: ${s.date || "미상"}${s.url ? `\n  링크: ${s.url}` : ""}\n  발췌: ${s.excerpt}`
  ).join("\n\n");
}

const PERSONA_PROMPT =
  "당신은 사단법인 도시공동체본부의 수석 연구위원입니다. 도시·지역 사회연대경제 분야에서 박사학위를 지닌 전문가로서, " +
  "국제 비교연구와 정책분석에 능하며, 공공기관이 발행하는 심층 이슈리포트를 집필합니다.";

const RULES = [
  "엄격한 원칙:",
  "- 제공된 [출처] 자료와 널리 알려진 검증된 사실만 사용합니다. 출처에 없는 구체적 수치·인명·기관명·연도를 지어내지 마세요.",
  "- 불확실한 사실은 단정하지 말고 '~로 알려져 있다', '~로 평가된다' 식으로 신중하게 표현합니다.",
  "- 과장·홍보성 표현을 피하고, 근거와 인과관계를 명료하게 제시하는 학술적·분석적 문체를 씁니다.",
  "- 추상적 일반론에 그치지 말고 제도의 작동 방식, 주체, 재원, 성과와 한계를 구체적으로 설명합니다.",
  "- '참고자료' 목록은 작성하지 마세요(코드가 실제 링크로 자동 추가합니다).",
].join("\n");

/** 1단계: 보고서 개요(제목·부제·요약 + 심층 소개할 해외 사례 3~4개) */
function buildOutlinePrompt(theme, sources) {
  return [
    PERSONA_PROMPT,
    `주제: "${theme.title}" — ${theme.focus}`,
    "아래 [출처] 자료를 검토해, A4 약 10쪽 분량의 심층 이슈리포트를 위한 설계안을 만드세요.",
    "특히 본문에서 '자세히 소개할 해외 사례'를 국가/제도 단위로 3~4개 선정하세요(가능하면 서로 다른 나라).",
    RULES,
    "",
    "다음 JSON만 출력(설명·코드블록 없이):",
    "{",
    '  "title": "보고서 제목(35자 내외, 구체적)",',
    '  "subtitle": "한 줄 부제",',
    '  "summary": "게시글 본문용 개요 4~6문장(핵심 논지와 결론 요지)",',
    '  "cases": [ { "country": "국가", "name": "제도/사례명", "angle": "이 사례에서 특히 조명할 점 한 줄" } ]',
    "}",
    "",
    "=== 출처 자료 ===",
    sourceBlock(sources),
  ].join("\n");
}

/** 개요를 받아 절(section) 집필 계획을 만든다 */
function sectionPlan(outline) {
  const cases = Array.isArray(outline.cases) ? outline.cases.slice(0, 4) : [];
  const plan = [
    { heading: "1. 개요", brief: "보고서 전체의 핵심 논지·문제의식과 결론의 요지를 제시. 왜 지금 이 주제가 중요한지 설득력 있게." },
    { heading: "2. 문제의식과 구조적 배경", brief: "저성장·양극화·인구감소·돌봄공백 등 구조적 맥락에서 사회연대경제가 부상하는 배경을 이론적·실증적으로 심층 분석." },
    { heading: "3. 국제 담론과 정책 동향", brief: "UN·ILO·OECD·EU 등 국제사회의 사회연대경제 의제화와 각국 정부 정책의 흐름을, 널리 알려진 사실 위주로 정리." },
  ];
  cases.forEach((c, i) => {
    plan.push({
      heading: `${4 + i}. 해외 사례 | ${c.country || "해외"} — ${c.name || "사례"}`,
      brief: `${c.country || ""}의 '${c.name || "사례"}'를 ①역사적 배경 ②제도·거버넌스 구조 ③실제 작동 방식과 재원 ④성과와 한계 ⑤한국에의 함의 순으로 매우 구체적으로. 특히 조명할 점: ${c.angle || "지역경제·공동체에 준 효과"}.`,
      isCase: true,
    });
  });
  const base = 4 + cases.length;
  plan.push({ heading: `${base}. 국내 현황과 국제 비교`, brief: "한국 사회연대경제의 현황·제도·규모를 앞의 해외 사례와 비교해 강점과 격차를 분석." });
  plan.push({ heading: `${base + 1}. 시사점과 정책 제언`, brief: "제도·금융(연대금융)·중간지원·인력양성 등 층위별로 구체적이고 실행가능한 제언을 제시." });
  plan.push({ heading: `${base + 2}. 도시공동체본부의 전략적 방향`, brief: "본부의 햇빛소득마을(주민참여 재생에너지)·커뮤니티 사업과 연결한 실천 전략을 단계적으로 제안." });
  plan.push({ heading: `${base + 3}. 결론`, brief: "핵심 논지를 응축하고, 향후 과제와 전망을 제시." });
  return plan;
}

/** 2단계: 개별 절을 심층 집필 */
function buildSectionPrompt(theme, sources, outline, spec, index, total) {
  return [
    PERSONA_PROMPT,
    `[보고서] ${outline.title} — ${outline.subtitle}`,
    `[집필할 절] ${spec.heading}  (전체 ${total}개 절 중 ${index + 1}번째)`,
    `[이 절에서 다룰 내용] ${spec.brief}`,
    "",
    "요구 수준:",
    "- 박사급 연구자의 깊이로, 구체적 사실·메커니즘·인과관계·비교를 담아 서술합니다.",
    `- 이 절 하나의 분량이 최소 1,800자, 가능하면 2,400자 이상이 되도록 충실히 씁니다(A4 약 1~1.5쪽).`,
    "- 2~3개의 소제목(h3)으로 논리적으로 구조화하고, 핵심 항목은 불릿으로 정리합니다.",
    spec.isCase
      ? "- 이 절은 특정 해외 사례의 심층 분석입니다. 배경→제도→작동방식→성과와 한계→한국 함의가 모두 드러나야 합니다."
      : "- 균형 잡힌 시각으로 반대 논거나 한계도 함께 다룹니다.",
    RULES,
    "",
    "다음 JSON만 출력(설명·코드블록 없이):",
    '{ "paragraphs": [ "문단", {"h3":"소제목"}, "문단", {"bullet":"항목"}, {"label":"핵심","text":"..."} ] }',
    "paragraphs 항목은 문자열 또는 {\"h3\":..},{\"bullet\":..},{\"lead\":..},{\"label\":..,\"text\":..} 중 하나입니다. 문단은 길고 밀도 있게 쓰세요.",
    "",
    "=== 출처 자료 ===",
    sourceBlock(sources),
  ].join("\n");
}

/** 개요 + 절별 집필을 묶어 완성 보고서 객체를 만든다. 실패 절은 건너뛴다. */
async function writeFullReport(theme, sources) {
  const outline = await geminiJson(buildOutlinePrompt(theme, sources), { maxTokens: 2048, temperature: 0.5 });
  if (!outline || !outline.title) return null;

  const plan = sectionPlan(outline);
  const sections = [];
  for (let i = 0; i < plan.length; i++) {
    const spec = plan[i];
    let paras = [];
    for (let attempt = 0; attempt < 2 && paras.length === 0; attempt++) {
      const r = await geminiJson(buildSectionPrompt(theme, sources, outline, spec, i, plan.length), { maxTokens: 8192, temperature: 0.55 });
      paras = normParas(r && r.paragraphs);
      if (paras.length === 0) await sleep(500);
    }
    if (paras.length === 0) paras = [{ note: "(이 절은 자료 부족으로 생략되었습니다.)" }];
    sections.push({ heading: spec.heading, paragraphs: paras });
    console.log(`[report]  · 절 ${i + 1}/${plan.length} 집필: ${spec.heading} (${paras.length}문단)`);
    await sleep(400);
  }
  return { title: outline.title, subtitle: outline.subtitle || theme.focus, summary: outline.summary || theme.focus, sections };
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
    summary: `관련 해외 동향과 사례 ${sources.length}건을 모아 핵심 흐름과 시사점을 정리한 자동 다이제스트입니다.`,
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
    meta: [`${PERSONA}  ·  주간 이슈 브리프`, `발행  ${AUTHOR}  ·  ${weekKey}`],
    sections,
    colophon: COLOPHON,
  });
}

/** 보고서에서 '주요 시사점'을 뽑는다(시사점/제언 절의 불릿·문단 우선) */
function extractImplications(report, max = 5) {
  const secs = report.sections || [];
  const pick = secs.find((s) => /시사점|제언|함의/.test(String(s.heading || "")))
    || secs.find((s) => /결론/.test(String(s.heading || "")));
  const out = [];
  const take = (arr) => {
    for (const p of arr || []) {
      if (out.length >= max) break;
      let t = "";
      if (typeof p === "string") t = p;
      else if (p && typeof p === "object") t = p.bullet || p.lead || p.text || "";
      t = String(t).replace(/\s+/g, " ").trim();
      if (t.length >= 12) out.push(t.length > 160 ? t.slice(0, 159).trim() + "…" : t);
    }
  };
  if (pick) take(pick.paragraphs);
  // 시사점 절이 비면 각 절 첫 문단에서 보완
  if (out.length === 0) for (const s of secs) { if (out.length >= max) break; take((s.paragraphs || []).slice(0, 1)); }
  return out;
}

/** [주요내용] — docx 보고서 본문을 요약해 표기한다.
 *  요약(summary)을 기본으로 하되, 얇으면 각 절의 첫 핵심 문장으로 보강한다. */
function buildContentSummary(report, subtitle) {
  const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
  // 기사 앞머리 데이트라인·바이라인 제거: "(서울=연합뉴스) 홍길동 기자 = "
  const stripByline = (t) =>
    clean(t)
      .replace(/^\([^)]*\)\s*/, "")
      .replace(/^[가-힣]{2,5}\s*(기자|특파원|논설위원)\s*[=·]\s*/, "");

  let base = clean(report.summary);
  if (subtitle && base.startsWith(subtitle)) base = clean(base.slice(subtitle.length).replace(/^[.\s·]+/, ""));
  const parts = base ? [base] : [];
  const sub = clean(subtitle);

  if (base.length < 320) {
    for (const sec of report.sections || []) {
      if (/참고자료/.test(sec.heading || "")) continue;
      for (const p of sec.paragraphs || []) {
        let t = typeof p === "string" ? p : (p && (p.lead || p.text || p.bullet)) || "";
        t = stripByline(t);
        if (t.length >= 40) {
          const sent = (t.match(/^[^.!?。]+[.!?。]/) || [t])[0].trim();
          const dupSub = sub && (sent.includes(sub) || sub.includes(sent));
          if (!dupSub && !parts.some((x) => x.includes(sent))) parts.push(sent);
          break;
        }
      }
      if (parts.join(" ").length >= 700) break;
    }
  }
  let out = parts.join(" ");
  if (out.length > 800) out = out.slice(0, 799).trim() + "…";
  return out;
}

/** 게시글 본문 — 순수 텍스트. 참고자료 URL 은 뷰에서 새 창 링크로 렌더된다. */
function makePostBody(report, sources, weekKey) {
  const lines = [];
  const dateStr = fmtKst(new Date().toISOString());
  const subtitle = String(report.subtitle || report.summary || "").trim();

  // 0) 머리글 — 부제(첫머리글) + 발간 정보
  if (subtitle) lines.push(subtitle, "");
  lines.push(`발행  ${AUTHOR}     발행일  ${dateStr}`);
  lines.push(`${PERSONA}  ·  주간 이슈 브리프`);
  lines.push(`발행번호  ·  ${weekKey}`);
  lines.push("");

  // 1) 주요내용 — 보고서 내용 요약
  const content = buildContentSummary(report, subtitle);
  lines.push("[주요내용]");
  lines.push(content || subtitle || "자세한 내용은 첨부된 보고서를 확인해 주세요.");
  lines.push("");

  // 2) 시사점
  const imps = extractImplications(report);
  if (imps.length) {
    lines.push("[시사점]");
    imps.forEach((t) => lines.push(`- ${t}`));
    lines.push("");
  }

  // 3) 참고자료 (URL 은 그대로 두면 뷰가 새 창 링크로 만든다)
  if (sources.length) {
    lines.push("[참고자료]");
    sources.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title} — ${s.source || "미상"}`);
      if (s.url) lines.push(`   ${s.url}`);
    });
    lines.push("");
  }

  // 4) 전체 보고서 안내 + 고지
  lines.push("[전체 보고서]");
  lines.push("해외사례를 심층 소개한 전체 보고서(A4)는 아래 첨부(docx)로 내려받을 수 있습니다.");
  lines.push("");
  lines.push(`※ 본 자료는 도시공동체본부가 공개자료를 바탕으로 주간 정리한 '${PERSONA}'입니다(${weekKey}). 인용 원문의 저작권은 각 매체에 있습니다.`);
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
  const sources = await researchSources(theme, { maxSources: 12 });
  console.log(`[report] 자료 ${sources.length}건 수집`);

  let ai = true;
  let report = await writeFullReport(theme, sources);
  if (!report || !report.sections || !report.sections.length) {
    console.warn("[report] LLM 집필 실패 → 기본 다이제스트로 대체");
    report = fallbackReport(theme, sources);
    ai = false;
  }

  const out = publishReport(report, sources, wk.key, theme.key);
  console.log(`[report] 발행 완료 — post ${out.postId} (${ai ? "AI집필" : "다이제스트"}, 첨부 ${out.attached})`);
  return { published: true, ai, weekKey: wk.key, theme: theme.key, ...out };
}

/* ------------------- 스케줄러: 매주 월요일 07:00 (서버 시간) ------- */

function msUntilWeekly(weekday, hour, minute) {
  const now = new Date();
  const t = new Date(now);
  t.setHours(hour, minute, 0, 0);
  let add = (weekday - now.getDay() + 7) % 7;
  if (add === 0 && t <= now) add = 7;
  t.setDate(t.getDate() + add);
  return t.getTime() - now.getTime();
}

// 이번 주 월요일 hour:minute 시각(서버 로컬)
function thisWeekMonday(hour, minute) {
  const t = new Date();
  t.setHours(hour, minute, 0, 0);
  const day = t.getDay();            // 0=일 … 6=토
  const back = day === 0 ? 6 : day - 1; // 이번 주 월요일까지 되돌릴 일수
  t.setDate(t.getDate() - back);
  return t;
}

function startScheduler() {
  const WD = 1, H = 7, M = 0; // 월요일 07:00
  let running = false; // 정시/캐치업 동시 실행 방지

  const publishIfDue = async (reason) => {
    if (running) return;
    running = true;
    try {
      const r = await collectOnce();               // 주 단위 멱등: 이미 발행됐으면 no-op
      if (r && r.published) console.log(`[report] 주간 발행 완료 (${reason})`);
    } catch (e) {
      console.error(`[report] 주간 발행 오류 (${reason}):`, e.message);
    } finally { running = false; }
  };

  // 1) 정시 실행: 매주 월요일 07:00
  const run = async () => {
    await publishIfDue("정시");
    setTimeout(run, msUntilWeekly(WD, H, M));
  };
  setTimeout(run, msUntilWeekly(WD, H, M));

  // 2) 안전망: 매시간 점검 — 재시작 등으로 정시를 놓쳤어도, 이번 주 월요일 07:00이 지났는데
  //    이번 주 리포트가 없으면 즉시 캐치업 발행(멱등이라 중복 없음)
  const safety = () => {
    if (Date.now() >= thisWeekMonday(H, M).getTime()) publishIfDue("캐치업");
  };
  safety();                                  // 시작 즉시 1회(재시작 캐치업)
  setInterval(safety, 60 * 60 * 1000);       // 매시간 재점검

  const next = new Date(Date.now() + msUntilWeekly(WD, H, M));
  console.log(`[report] 주간 스케줄러 시작 — 정시 발행: ${next.toLocaleString()} · 안전망(매시간 캐치업) 활성`);
}

module.exports = { collectOnce, startScheduler, THEMES, AUTHOR, PERSONA, BOARD };
