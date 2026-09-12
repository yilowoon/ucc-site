/* 지구촌소식브리프 — 일일 '사회연대경제 전환' 이슈 브리프 자동 발행
 *
 * 단순 기사 수집이 아니라, 매일 하나의 주제를 정해 관련 자료를 조사하고
 * '무슨 일이 있었나 → 왜 → 무엇이 달라지나' 흐름의 심층 보고서(A4 약 10쪽)로 재구성해 발행한다.
 *   1) 주제 선정(일자별 로테이션) → 2) 관련 자료 리서치(Daum→Google)+관련성 필터
 *   3) Gemini 로 설계안+절별 심층 집필(완결 문장, 한줄요약·핵심수치, 출처 자료 기반)
 *   4) docx 로 세련되게 조판(표지·발행정보·판권) + 요약을 게시글 본문으로
 *   5) 'global' 게시판에 글 등록 + docx 첨부 (완전 자동, 매일 07:00)
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

const { db, UPLOAD_DIR, getSetting, setSetting } = require("./db");
const { fromDaum, fromGoogle } = require("./newsletter");
const { buildDocx } = require("./docx");

const AUTHOR = "도시공동체본부";        // 발행 기관(게시글 작성자 표기)
const PUBLISHER_NAME = "이형구";         // 발행인(대표)
const PERSONA = "지구촌소식브리프";      // 발간물 브랜드
const BOARD = "global";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const COLOPHON = [
  "사단법인 도시공동체본부  ·  행정안전부 소관 비영리법인",
  "대전광역시 서구 대덕대로242번길 15, 501호-G19",
  "Tel. 1670-9678   ·   E-mail. contact@ucc.or.kr",
  `본 자료는 도시공동체본부가 공개자료를 바탕으로 매일 정리한 '${PERSONA}'이며, 인용 원문의 저작권은 각 매체에 있습니다.`,
];

/* Gemini(Generative Language API) — 텍스트 집필 */
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const GEMINI_TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite";

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
    match: ["사회적경제 기본법", "사회연대경제", "사회적경제 정책", "SSE"],
  },
  {
    key: "coops",
    title: "협동조합이 떠받치는 지역경제, 해외의 실험",
    focus: "노동자·소비자·플랫폼 협동조합이 지역 고용과 돌봄을 지탱하는 사례",
    queries: ["해외 협동조합 지역경제", "노동자협동조합 사례", "플랫폼 협동조합 해외"],
    match: ["노동자협동조합", "소비자협동조합", "플랫폼 협동조합", "협동조합"],
  },
  {
    key: "community",
    title: "주민이 소유하는 공동체경제, 해외 사례",
    focus: "주민이 자원과 돌봄을 함께 소유·운영하는 공동체경제 모델",
    queries: ["해외 지역공동체 경제", "커뮤니티 자산 해외 사례", "주민참여 마을기업 해외"],
    match: ["지역공동체", "공동체경제", "커뮤니티 자산", "마을기업", "공동체"],
  },
  {
    key: "energy",
    title: "주민참여 에너지전환과 연대경제",
    focus: "주민이 발전 수익을 나누는 에너지 공동체와 햇빛소득마을의 접점",
    queries: ["해외 에너지 협동조합", "주민참여 재생에너지 마을 해외", "커뮤니티 에너지 해외"],
    match: ["에너지 협동조합", "커뮤니티 에너지", "재생에너지", "에너지전환", "태양광", "햇빛"],
  },
  {
    key: "care",
    title: "돌봄을 다시 짜는 사회적경제, 해외의 길",
    focus: "돌봄·복지 공백을 사회적경제가 메우는 해외 제도와 현장",
    queries: ["해외 사회적협동조합 돌봄", "돌봄 사회적경제 해외", "커뮤니티 케어 해외 사례"],
    match: ["돌봄", "커뮤니티 케어", "커뮤니티케어", "사회서비스", "사회적협동조합"],
  },
  {
    key: "finance",
    title: "연대금융, 사회적경제를 지탱하는 돈의 구조",
    focus: "사회적경제 조직을 키우는 인내자본·연대금융·중간지원 생태계",
    queries: ["해외 연대금융 사례", "사회적금융 해외", "임팩트 금융 지역 해외"],
    match: ["연대금융", "사회적금융", "임팩트투자", "임팩트금융", "인내자본", "마이크로파이낸스", "사회투자"],
  },
];

// 주제 무관 기사(정치·정부일정·인기뉴스 등) 유입 방지용 공통 키워드.
// 기사 제목+발췌에 아래(공통) 또는 해당 주제 match 키워드가 하나라도 있어야 채택.
const CORE_KEYWORDS = [
  "사회연대경제", "사회적경제", "연대경제", "협동조합", "사회적기업", "사회적협동조합",
  "마을기업", "자활기업", "소셜벤처", "사회적가치", "사회적금융", "연대금융",
  "임팩트투자", "임팩트금융", "공동체경제", "커뮤니티 자산",
];

// 해외 신호 키워드 — 이 소식지는 '해외 전용'이라, 국내 기사 배제를 위해 아래 중 하나가 반드시 있어야 채택.
const OVERSEAS_KEYWORDS = [
  "해외", "국제", "글로벌", "세계", "외신", "각국",
  "유럽", "유럽연합", "eu", "미국", "영국", "프랑스", "독일", "이탈리아", "스페인", "네덜란드", "벨기에",
  "스위스", "스웨덴", "덴마크", "노르웨이", "핀란드", "오스트리아", "포르투갈", "아일랜드", "스코틀랜드",
  "캐나다", "퀘벡", "일본", "대만", "중국", "인도", "호주", "뉴질랜드", "브라질", "아르헨티나", "멕시코",
  "oecd", "ilo", "un", "유엔", "세계은행", "몬드라곤", "mondragon",
  // 영문 소스 대응
  "cooperative", "co-op", "social economy", "solidarity economy", "social enterprise", "europe", "global",
];

// 국내 소식지가 아님을 확실히 하기 위한 국내(한국) 전용 표지 — 해외 신호가 전혀 없을 때 배제 강화용.
const DOMESTIC_MARKERS = [
  "국내", "우리나라", "국회", "청와대", "대통령실", "행정안전부", "기획재정부", "보건복지부",
  "서울시", "부산시", "대구시", "인천시", "광주시", "대전시", "울산시", "세종시", "경기도", "충청", "전라", "경상", "강원", "제주",
  "시의회", "도의회", "구청", "시청", "도청",
];

/** 기사가 (1) 주제 관련성 + (2) 해외 소식 여부를 모두 만족하는지.
 *  국내 소식은 완전히 배제한다: 해외 신호가 없으면(그리고 국내 표지가 있으면) 제외. */
function isRelevant(item, theme) {
  const hay = ((item.title || "") + " " + (item.excerpt || item.summary || "")).toLowerCase();
  const topic = CORE_KEYWORDS.concat(theme.match || []).some((k) => hay.includes(String(k).toLowerCase()));
  if (!topic) return false;
  const overseas = OVERSEAS_KEYWORDS.some((k) => hay.includes(String(k).toLowerCase()));
  if (!overseas) return false;                 // 해외 신호 없으면 배제(국내 기사 차단)
  const domestic = DOMESTIC_MARKERS.some((k) => hay.includes(String(k).toLowerCase()));
  const overseasHits = OVERSEAS_KEYWORDS.filter((k) => hay.includes(String(k).toLowerCase())).length;
  // 국내 표지가 있으면서 해외 신호가 약하면(1개뿐) 국내 기사로 보고 배제
  if (domestic && overseasHits < 2) return false;
  return true;
}

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

// ── 무료 Gemini 분당 한도(503 과부하) 방지: 모든 호출을 직렬화하고 최소 간격을 강제한다 ──
// 무료 티어는 '분당 요청 수'가 엄격해 짧은 시간에 몰아치면 503이 난다. 병렬 대신 한 줄로,
// 호출 사이에 최소 간격(GEMINI_MIN_GAP_MS, 기본 5초 ≈ 12req/min)을 둔다.
const GEMINI_MIN_GAP_MS = Number(process.env.GEMINI_MIN_GAP_MS || 5000);
let _geminiChain = Promise.resolve();
let _lastGeminiAt = 0;
/** task(비동기)를 전역 직렬 큐에 넣고 직전 호출과 최소 간격을 둔 뒤 실행한다. */
function throttleGemini(task) {
  const run = _geminiChain.then(async () => {
    const wait = _lastGeminiAt + GEMINI_MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await task(); }
    finally { _lastGeminiAt = Date.now(); }
  });
  _geminiChain = run.then(() => {}, () => {}); // 체인이 거부로 끊기지 않도록 흡수
  return run;
}

/** 동시 실행 수를 제한하며 map(순서 보존) — 절 병렬 집필용 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

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

/** 일자 시퀀스 키 { year, dayOfYear, key: 'YYYY-Dddd' } (KST 기준, 연중 일수) */
function daySeq(date) {
  const base = date ? new Date(date) : new Date();
  const k = new Date(base.getTime() + 9 * 3600 * 1000); // KST
  const year = k.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const dayOfYear = Math.floor((Date.UTC(year, k.getUTCMonth(), k.getUTCDate()) - start) / 86400000) + 1;
  return { year, dayOfYear, key: `${year}-D${String(dayOfYear).padStart(3, "0")}` };
}

/** ISO 시각 → 'YYYY.MM.DD.' (KST, 공백 없음) */
function fmtDot(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}.${String(k.getUTCMonth() + 1).padStart(2, "0")}.${String(k.getUTCDate()).padStart(2, "0")}.`;
}

/** 문장 종결 보정 — 중간에 끊긴 텍스트를 마지막 '완결 문장'까지만 남긴다(… 로 자르지 않음). */
function completeSentences(t) {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  if (!s) return s;
  if (/[.!?。][”’"')\]】」』]?$/.test(s)) return s; // 이미 종결
  const idx = Math.max(s.lastIndexOf("."), s.lastIndexOf("!"), s.lastIndexOf("?"), s.lastIndexOf("。"));
  return idx >= 15 ? s.slice(0, idx + 1).trim() : s;
}

/** [오늘의 명언] — 공동체·연대·시민·변화 주제의 검증된 격언 풀(출처 확실한 것만; 조작 방지) */
const QUOTES = [
  { text: "빨리 가려면 혼자 가고, 멀리 가려면 함께 가라.", author: "아프리카 속담" },
  { text: "한 아이를 키우는 데 온 마을이 필요하다.", author: "아프리카 속담" },
  { text: "홀로 할 수 있는 일은 적지만, 함께라면 많은 일을 할 수 있다.", author: "헬렌 켈러" },
  { text: "사려 깊고 헌신적인 시민들의 작은 모임이 세상을 바꿀 수 있음을 결코 의심하지 말라.", author: "마거릿 미드" },
  { text: "우리가 세상에서 보고 싶은 변화, 우리 스스로가 그 변화가 되어야 한다.", author: "마하트마 간디" },
  { text: "혼자면 빠르지만, 함께면 멀리 그리고 오래간다.", author: "협동조합 격언" },
  { text: "무엇이든 나눌수록 커지는 것이 있다. 지식과 공동체가 그렇다.", author: "동서양 격언" },
];
function pickQuote(dayOfYear) {
  return QUOTES[((dayOfYear || 1) - 1) % QUOTES.length];
}

/** [참고자료] — 유사·중복 기사 제거 후 관련성 높은 상위 N건만 선별 */
function topReferences(sources, theme, limit = 10) {
  const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const seen = [];
  const uniq = [];
  for (const s of sources || []) {
    const n = norm(s.title);
    if (!n) continue;
    const dup = seen.some((x) => x === n || (x.length >= 12 && n.length >= 12 && (x.includes(n) || n.includes(x))));
    if (dup) continue;
    seen.push(n);
    uniq.push(s);
  }
  const kws = CORE_KEYWORDS.concat((theme && theme.match) || []);
  const score = (s) => {
    const title = String(s.title || "").toLowerCase();
    const hay = (title + " " + String(s.excerpt || "")).toLowerCase();
    let sc = 0;
    for (const k of kws) { const kk = String(k).toLowerCase(); if (hay.includes(kk)) sc += 1; if (title.includes(kk)) sc += 2; }
    return sc;
  };
  return uniq
    .map((s, i) => ({ s, sc: score(s), i }))
    .sort((a, b) => b.sc - a.sc || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

/** [주요내용] — 내용 중심의 요약(최소 3문장). 글의 요지·핵심을 정리한다.
 *  [시사점]과 기능 중첩을 피하기 위해 시사점/제언/함의 절은 제외하고 본문·발췌에서 핵심 문장을 뽑는다.
 *  AI(Gemini) 집필 시 보고서 요약+본문, 미설정 시 관련 기사 발췌의 핵심 문장으로 구성. */
function buildHighlight(report, refs, ai) {
  const TARGET = 560;   // 약 1분 분량(한글 기준 ~500-700자)
  const MAX_SENTS = 14; // 문장 수 상한
  const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();
  const stripByline = (t) =>
    clean(t).replace(/^\([^)]*\)\s*/, "").replace(/^[가-힣]{2,5}\s*(기자|특파원|논설위원)\s*[=·]\s*/, "");
  // 텍스트에서 앞쪽 최대 maxN개의 온전한 문장을 뽑는다
  const sentencesOf = (t, maxN) => {
    const s = stripByline(t);
    if (s.length < 20) return [];
    const out = [];
    const re = /[\s\S]{15,180}?[.!?。](?=\s|$)/g;
    let m;
    while ((m = re.exec(s)) && out.length < maxN) out.push(m[0].trim());
    if (!out.length) out.push(s.slice(0, 160).trim());
    return out;
  };
  const focus = clean(report.subtitle || report.title);
  const sents = [];
  const curLen = () => sents.join(" ").length;
  const push = (raw) => {
    let s = clean(raw);
    if (s.length < 15) return;
    if (!/[.!?。]$/.test(s)) s += ".";
    const key = s.slice(0, 16);
    if (sents.some((x) => x.slice(0, 16) === key)) return; // 중복 문장 제거
    sents.push(s);
  };
  const enough = () => curLen() >= TARGET || sents.length >= MAX_SENTS;

  // 1) 리드 문장 — 분석형 브리프면 한 줄 요약(oneLine)을 리드로
  if (ai && clean(report.oneLine).length >= 20) push(report.oneLine);
  else if (ai && clean(report.summary).length >= 30 && !/자동 다이제스트/.test(report.summary)) push(report.summary);
  else push(`이번 호는 ${focus} 관련 동향과 사례 ${(refs || []).length}건을 정리했습니다.`);

  // 2) 내용 문장 — 사실(핵심사건·배경·구조)만. 의미·전망은 [시사점]으로 분리(중첩 방지).
  if (ai && Array.isArray(report._factual) && report._factual.length) {
    for (const t of report._factual) { push(t); if (enough()) break; }
  } else if (ai) {
    for (const sec of report.sections || []) {
      if (/시사점|제언|함의|의미|영향|관전|전망|참고자료/.test(sec.heading || "")) continue;
      for (const p of sec.paragraphs || []) {
        if (enough()) break;
        const t = typeof p === "string" ? p : (p && (p.lead || p.text || p.h3 || p.bullet)) || "";
        for (const s of sentencesOf(t, 3)) { push(s); if (enough()) break; }
      }
      if (enough()) break;
    }
  } else {
    // 1차: 소스당 2문장으로 폭넓게, 부족하면 2차에서 3문장까지 더 채운다
    for (const pass of [2, 3]) {
      for (const r of refs || []) {
        if (enough()) break;
        for (const s of sentencesOf(r.excerpt || "", pass)) { push(s); if (enough()) break; }
      }
      if (enough()) break;
    }
  }

  // 3) 최소 3문장 보장(부족하면 제목으로 보완)
  if (sents.length < 3) {
    for (const r of refs || []) {
      if (sents.length >= 3) break;
      const t = clean(r.title);
      if (t) push(`${t} 등이 비중 있게 다뤄졌습니다.`);
    }
  }

  let out = sents.join(" ");
  return out.length > 1400 ? completeSentences(out.slice(0, 1400)) : completeSentences(out);
}

/** 요약 발췌(원문 전문 방지) — LLM 근거용이라 넉넉히, 단 전문 저장은 피한다 */
function buildExcerpt(item, maxChars = 2800) {
  const raw = String(item.content || item.summary || "").replace(/\s+/g, " ").trim();
  if (raw.length < 20) return String(item.summary || "").replace(/\s+/g, " ").trim();
  if (raw.length <= maxChars) return raw;
  return completeSentences(raw.slice(0, maxChars)); // 문장 중간에서 자르지 않음
}

function safeFileName(s) {
  return String(s || "보고서")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "보고서";
}

/* --------------------------------------------------- 1) 자료 리서치 */

// 주제별 영문 검색어 — 해외(영자) 뉴스 확보용(Bing 뉴스 영문판)
const QUERIES_EN = {
  "sse-policy": ["social solidarity economy policy", "EU social economy action plan", "social enterprise law Europe"],
  "coops": ["worker cooperative local economy", "platform cooperative", "cooperative movement community"],
  "community": ["community wealth building", "community land trust", "community ownership economy"],
  "energy": ["energy cooperative community", "citizen renewable energy community", "community solar cooperative"],
  "care": ["social cooperative care", "community care cooperative", "care economy social enterprise"],
  "finance": ["solidarity finance", "social impact investment community", "community development finance"],
};

/** Bing 뉴스 RSS 검색 — 실제 기사 URL(링크의 url= 파라미터) + 스니펫(description) 제공.
 *  Google 뉴스와 달리 링크가 해독 가능해 본문 fetch가 되고, 본문 실패 시에도 스니펫이 남는다. */
async function fromBingNews(keyword, lang = "en") {
  const mkt = lang === "ko" ? "ko-KR" : "en-US";
  const url = "https://www.bing.com/news/search?q=" + encodeURIComponent(keyword) + "&format=rss&mkt=" + mkt;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": lang === "ko" ? "ko" : "en" } });
    clearTimeout(to);
    const text = await r.text();
    const unesc = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
    const out = [];
    for (const it of text.split("<item>").slice(1, 8)) {
      const g = (re) => { const m = it.match(re); return m ? m[1] : ""; };
      const title = unesc(g(/<title>([\s\S]*?)<\/title>/));
      let link = unesc(g(/<link>([\s\S]*?)<\/link>/));
      const desc = unesc(g(/<description>([\s\S]*?)<\/description>/)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const pub = g(/<pubDate>([\s\S]*?)<\/pubDate>/);
      // Bing apiclick 링크에서 실제 기사 URL 추출
      const m = link.match(/[?&]url=([^&]+)/);
      if (m) { try { link = decodeURIComponent(m[1]); } catch (e) {} }
      if (!title || !/^https?:\/\//.test(link)) continue;
      let source = ""; try { source = new URL(link).hostname.replace(/^www\./, ""); } catch (e) {}
      out.push({ title, summary: desc, source, url: link, guid: link.split("?")[0], published_at: pub ? new Date(pub).toISOString() : "" });
    }
    return out;
  } catch (e) { return []; }
}

/** 기사 HTML에서 본문 텍스트 추출(<p> 우선, 실패 시 태그 제거) */
function extractMainText(html, maxChars = 3000) {
  let h = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const ps = [...h.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 40);
  let text = ps.join(" ").trim();
  if (text.length < 120) text = h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxChars ? completeSentences(text.slice(0, maxChars)) : text;
}

/** 기사 URL에서 본문 텍스트 가져오기(타임아웃·실패 시 빈 문자열) */
async function fetchArticleText(url) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; UCCBrief/1.0)", "Accept-Language": "en,ko" } });
    clearTimeout(to);
    if (!r.ok) return "";
    return extractMainText(await r.text());
  } catch (e) { return ""; }
}

/** 영문(intl) 출처의 실제 기사 본문을 가져와 발췌를 보강(심층 분석 근거).
 *  본문 확보 실패(유료·차단) 시 기존 스니펫 발췌를 그대로 유지한다. */
async function enrichIntlSources(sources, limit = 8) {
  let done = 0;
  for (const s of sources || []) {
    if (!s.intl) continue;
    if (done >= limit) break;
    if (s.excerpt && s.excerpt.length >= 600) continue; // 이미 충분하면 스킵
    const txt = await fetchArticleText(s.url);
    if (txt && txt.length > (s.excerpt || "").length && txt.length >= 200) {
      s.excerpt = txt; // 전문(요약)이 스니펫보다 길면 교체
      done++;
    }
    await sleep(300);
  }
  return done;
}

/** 영문(intl) 출처의 발췌를 한국어로 번역·정리한다(완결 문장). 한 번의 Gemini 호출로 일괄 처리. */
async function translateSourcesToKorean(sources) {
  // 영문 알파벳이 40자 이상 포함된 발췌는 번역 대상으로 본다(제목이 영문이어도 포함)
  const hasEnglish = (t) => (String(t || "").match(/[A-Za-z]/g) || []).length >= 40;
  const targets = (sources || []).filter((s) => s.intl && (hasEnglish(s.excerpt) || hasEnglish(s.title)));
  if (!targets.length || !GEMINI_KEY()) return 0;
  const block = targets.map((s, i) => `[${i + 1}] TITLE: ${s.title}\nBODY: ${String(s.excerpt || "").slice(0, 2800)}`).join("\n\n");
  const prompt = [
    "다음은 해외 영문 기사들의 제목과 본문(또는 스니펫)이다.",
    "각 기사의 핵심 내용을 한국어로 자연스럽고 정확하게 번역·정리하라.",
    "- 각 항목 4~7문장, 사실 중심. 반드시 완결된 문장으로 끝맺을 것(중간에 끊거나 '…'로 생략 금지).",
    "- 원문에 없는 사실·수치·인과를 추가하지 말 것. 고유명사는 한글(원어) 병기.",
    '다음 JSON만 출력(설명 없이): { "items": [ { "i": 1, "ko": "한국어 정리" } ] }',
    "",
    block,
  ].join("\n");
  const j = await llm(prompt, { maxTokens: 4096, temperature: 0.3 });
  const arr = Array.isArray(j) ? j : (j && j.items);
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  arr.forEach((it, k) => {
    const idx = (parseInt(it && it.i, 10) || (k + 1)) - 1;
    const ko = completeSentences(String((it && it.ko) || "").trim());
    if (idx >= 0 && idx < targets.length && ko.length >= 40) { targets[idx].excerpt = ko; targets[idx].translated = true; n++; }
  });
  return n;
}

/** 최종 안전망: 완성된 보고서 절 문단 중 영문이 남은 것을 한국어로 재작성(완결 문장). */
async function koreanizeReport(report) {
  if (!GEMINI_KEY() || !report || !Array.isArray(report.sections)) return 0;
  const isEng = (t) => (String(t || "").match(/[A-Za-z]/g) || []).length >= 40;
  const items = [];
  for (const sec of report.sections) {
    const arr = sec.paragraphs || [];
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (typeof p === "string") { if (isEng(p)) items.push({ arr, i, key: "str", text: p }); }
      else if (p && typeof p === "object") {
        for (const key of ["lead", "text", "bullet"]) {
          if (isEng(p[key])) { items.push({ arr, i, key, text: p[key] }); break; }
        }
      }
    }
  }
  if (!items.length) return 0;
  const block = items.map((it, n) => `[${n + 1}] ${String(it.text).slice(0, 1500)}`).join("\n\n");
  const prompt = [
    "다음 문단들에는 영어가 섞여 있다. 각 문단을 자연스럽고 완결된 한국어 문장으로 다시 써라.",
    "- 사실은 그대로 유지하고 추가하지 말 것. 고유명사는 한글(원어) 병기. 중간에 끊지 말고 완결할 것.",
    '다음 JSON만 출력(설명 없이): { "items": [ { "i": 1, "ko": "..." } ] }',
    "",
    block,
  ].join("\n");
  const j = await llm(prompt, { maxTokens: 8192, temperature: 0.3 });
  const resArr = Array.isArray(j) ? j : (j && j.items);
  if (!Array.isArray(resArr)) return 0;
  let n = 0;
  resArr.forEach((r, k) => {
    const idx = (parseInt(r && r.i, 10) || (k + 1)) - 1;
    const ko = completeSentences(String((r && r.ko) || "").trim());
    if (idx < 0 || idx >= items.length || ko.length < 20) return;
    const it = items[idx];
    if (it.key === "str") it.arr[it.i] = ko;
    else it.arr[it.i] = { ...it.arr[it.i], [it.key]: ko };
    n++;
  });
  return n;
}

async function researchSources(theme, { maxSources = 12 } = {}) {
  const seen = new Set();
  const sources = [];
  const addCand = (it, intl) => {
    if (sources.length >= maxSources) return;
    if (!it.title || !it.url) return;
    const key = (it.guid || it.url).split("?")[0];
    if (seen.has(key)) return;
    const cand = {
      title: String(it.title).replace(/\s+/g, " ").trim(),
      source: it.source || "",
      url: it.url,
      date: fmtKst(it.published_at),
      excerpt: buildExcerpt(it),
      intl: !!intl,
    };
    // 국문 소스는 관련성+해외 필터 적용(국내 배제). 영문 소스는 해외 쿼리로 확보한 것이라 그대로 채택.
    if (!intl && !isRelevant(cand, theme)) return;
    seen.add(key);
    sources.push(cand);
  };

  // 1) 국문 해외 보도(본문 있음 — 심층 집필 근거): Daum
  for (const q of theme.queries || []) {
    if (sources.length >= maxSources) break;
    let items = [];
    try { items = await fromDaum(q); if (!items || !items.length) items = await fromGoogle(q); }
    catch (e) { console.error("[report] 리서치 실패:", q, e.message); continue; }
    for (const it of items || []) addCand(it, false);
    await sleep(300);
  }
  // 2) 국문 보강(관련성↑): Bing 뉴스 국문
  for (const q of theme.queries || []) {
    if (sources.length >= maxSources) break;
    let items = [];
    try { items = await fromBingNews(q, "ko"); } catch (e) { continue; }
    for (const it of items || []) addCand(it, false);
    await sleep(300);
  }
  // 3) 영문 해외 뉴스(실제 URL·스니펫 — 본문 심층 분석): Bing 뉴스 영문
  for (const q of QUERIES_EN[theme.key] || []) {
    if (sources.length >= maxSources) break;
    let items = [];
    try { items = await fromBingNews(q, "en"); } catch (e) { continue; }
    for (const it of items || []) addCand(it, true);
    await sleep(300);
  }
  return sources;
}

/* --------------------------------------------- 2) Gemini 집필 호출 */

// ── 모델 자동 선택(404 회피) + 저수준 호출/재시도(503·429 대응) ──
let _resolvedModel = null;

/** 이 키로 generateContent 가능한 모델 목록 */
async function listModels(key) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(`${GEMINI_BASE()}/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`, { signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => String(m.name || "").replace(/^models\//, ""));
  } catch (e) { return []; }
}

// 선호 순위(무료 할당량 유리한 lite 계열을 우선, 폐기 잦은 구버전은 뒤로)
const MODEL_PREF = [
  /^gemini-3\.1-flash-lite$/i, /^gemini-3\.\d+-flash-lite/i, /^gemini-3\.\d+-flash$/i,
  /^gemini-2\.5-flash-lite/i, /^gemini-2\.0-flash-lite/i,
  /^gemini-2\.5-flash$/i, /^gemini-2\.0-flash$/i, /flash-lite-latest$/i, /flash-latest$/i,
];

/** 사용할 모델명 결정: 환경변수 우선 → ListModels에서 '안정 flash' 우선 선택 → 기본값 */
async function resolveModel() {
  if (process.env.GEMINI_TEXT_MODEL) return process.env.GEMINI_TEXT_MODEL; // 사용자가 지정하면 신뢰
  if (_resolvedModel) return _resolvedModel;
  const avail = GEMINI_KEY() ? await listModels(GEMINI_KEY()) : [];
  const bad = /(vision|thinking|exp|image|tts|live|preview|audio)/i;
  let pick = null;
  for (const re of MODEL_PREF) { const m = avail.find((n) => re.test(n) && !bad.test(n)); if (m) { pick = m; break; } }
  if (!pick) pick = avail.find((n) => /flash/i.test(n) && !bad.test(n)) || avail.find((n) => /flash/i.test(n)) || avail.find((n) => /gemini/i.test(n)) || "gemini-3.1-flash-lite";
  _resolvedModel = pick;
  console.log(`[report] Gemini 모델 자동 선택: ${pick} (사용가능 ${avail.length}종)`);
  return pick;
}

/** 저수준 1회 호출(전역 직렬 큐·최소 간격 적용) → { ok, status, text, err } */
async function geminiCallRaw(model, body, ms) {
  const key = GEMINI_KEY();
  if (!key) return { status: 0, err: "NO_KEY" };
  return throttleGemini(async () => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(`${GEMINI_BASE()}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await r.text();
      return { ok: r.ok, status: r.status, text };
    } catch (e) { return { status: 0, err: e.message }; }
    finally { clearTimeout(to); }
  });
}

/** Gemini 사용 가능 여부 확인(모델 자동 선택 + 503 재시도). { ok, reason, detail, model } */
async function geminiPing() {
  if (!GEMINI_KEY()) return { ok: false, reason: "NO_KEY" };
  const model = await resolveModel();
  for (let a = 0; a < 2; a++) {
    const res = await geminiCallRaw(model, { contents: [{ parts: [{ text: "핑" }] }] }, 20000);
    if (res.ok) return { ok: true, model };
    if (res.status === 429 || res.status === 503) { await sleep(2000); continue; }
    return { ok: false, reason: `HTTP ${res.status || "NET"}`, detail: (res.text || res.err || "").slice(0, 160), model };
  }
  return { ok: false, reason: "HTTP 503(과부하) 재시도 실패", model };
}

async function geminiJson(prompt, { ms = 90000, maxTokens = 8192, temperature = 0.5 } = {}) {
  if (!GEMINI_KEY()) return null;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: "application/json" } };
  let model = await resolveModel();
  const MAX = 4; // 503(과부하) 회복은 노리되, 429(할당량)에서 과도한 재시도로 무료 할당량을 태우지 않도록 제한
  for (let attempt = 0; attempt < MAX; attempt++) {
    const res = await geminiCallRaw(model, body, ms);
    if (res.ok) {
      let data; try { data = JSON.parse(res.text); } catch { return null; }
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      const txt = (parts && parts.map((p) => p.text || "").join("")) || "";
      if (!txt) return null;
      try { return JSON.parse(txt); } catch {
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch {} }
        return null;
      }
    }
    // 404: 모델명 문제 → 캐시 무효화 후 재해결(환경변수 미지정 시 1회)
    if (res.status === 404 && !process.env.GEMINI_TEXT_MODEL && attempt === 0) { _resolvedModel = null; model = await resolveModel(); continue; }
    // 429/503/네트워크 타임아웃: 무료 분당 한도 초과일 가능성이 큼 → 분 단위 회복을 노려 길게 대기 후 재시도
    if (res.status === 429 || res.status === 503 || res.status === 0) {
      if (attempt < MAX - 1) {
        const backoff = Math.min(8000 * (attempt + 1), 45000); // 8s → 최대 45s
        console.warn(`[report] Gemini ${res.status || "NET"} 과부하 — ${Math.round(backoff / 1000)}초 후 재시도(${attempt + 1}/${MAX - 1})`);
        await sleep(backoff);
        continue;
      }
    }
    console.error("[report] Gemini HTTP", res.status || "NET", (res.text || res.err || "").slice(0, 160));
    return null;
  }
  console.error("[report] Gemini 재시도 실패(과부하/타임아웃) — 모델", model);
  return null;
}

/** 무료 Gemini 전용. 집필·번역·한국어화 모두 이 래퍼를 통해 호출한다. */
function llm(prompt, opts) { return geminiJson(prompt, opts); }

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
  "- ★이 보고서는 '해외 소식' 전용입니다. 반드시 해외(외국) 사례·제도·동향만 다루세요. 한국 국내의 사례·정책·통계·기관·지자체를 본문 주제로 삼지 마세요. (해외 사례의 함의를 설명하며 한국을 '비교 참조'로 1~2문장 언급하는 것만 허용)",
  "- ★작성 언어는 한국어입니다. 출처가 영문 기사여도 한국어로 서술하고, 고유명사는 '한글(원어)' 형태로 병기합니다(예: 몬드라곤(Mondragon)).",
  "- 제공된 [출처] 자료에 실제로 있는 사실만 사용합니다. 출처에 없는 수치·인명·기관명·연도·인과관계를 지어내지 마세요.",
  "- 분량을 채우려고 원문에 없는 원인이나 결과를 만들지 마세요. 근거가 없으면 해당 문장을 비웁니다(빈 문자열).",
  "- '때문이다'는 원인이 출처에서 확인될 때만, '이어졌다'는 결과가 확인될 때만 씁니다. 불확실하면 '~로 알려졌다/평가된다'로 신중히.",
  "- 당사자 주장·설명은 발언 주체를 남깁니다: '○○ 측은 ~라고 설명했다'.",
  "- 기사 발행일과 실제 사건 발생일을 구분하고, 여러 기사의 같은 사실은 하나로 묶습니다.",
  "- 한 문장에는 하나의 중심 주장, 한 문단에는 하나의 역할. 원문 표현을 바꿔 쓰기보다 사실을 구조에 맞게 새로 서술합니다.",
  "- 홍보성·평가성 수식을 피하고, 사실→의미의 순서로 담백하게 씁니다.",
  "- 영문 출처의 [발췌]도 반드시 활용해 그 내용을 심층 분석하세요(제목·매체만 나열하지 말 것). 발췌가 없는 항목은 검증된 배경지식 범위에서만 신중히 다룹니다.",
].join("\n");

/** 1단계: 보고서 설계안(제목·한줄요약·개요·핵심수치 + 심층 소개할 해외 사례 3~4개) */
function buildOutlinePrompt(theme, sources) {
  return [
    PERSONA_PROMPT,
    `주제: "${theme.title}" — ${theme.focus}`,
    "아래 [출처] 자료를 검토해, A4 약 10쪽 분량의 '심층 이슈 보고서' 설계안을 만드세요.",
    "본문에서 '자세히 소개할 해외 사례'를 국가/제도 단위로 3~4개 선정하세요.",
    "★사례의 국가 다양성을 반드시 확보하세요: 서로 다른 나라의 사례를 우선 선정하고, 한 나라에서 2개를 초과해 뽑지 마세요(예: 미국 3개 금지). 출처가 한 나라에 쏠려 있으면, 검증된 배경지식 범위에서 다른 나라(유럽·아시아·남미 등)의 대표 사례를 포함해 균형을 맞추세요.",
    RULES,
    "",
    "다음 JSON만 출력(설명·코드블록 없이):",
    "{",
    '  "title": "보고서 제목(25~40자, 핵심 주제+변화, 평가보다 정보)",',
    '  "oneLine": "가장 중요한 사실과 의미를 압축한 한 줄 요약(50~90자)",',
    '  "summary": "게시글용 개요 4~6문장(핵심 논지와 결론 요지, 완결된 문장)",',
    '  "keyPoints": ["보고서 전체를 관통하는 핵심 내용 4~5개. 각 항목은 하나의 완결된 문장(~다.)으로, 수치 나열이 아니라 무슨 일이 왜 중요한지 서술"],',
    '  "cases": [ { "country": "국가", "name": "제도/사례명", "angle": "특히 조명할 점 한 줄" } ]',
    "}",
    "",
    "=== 출처 자료 ===",
    sourceBlock(sources),
  ].join("\n");
}

/** 설계안 → 절(section) 집필 계획(약 10쪽 분량이 되도록 구성) */
function sectionPlan(outline) {
  // 국가 다양성 보정: 한 나라 사례가 2개를 넘지 않도록 걸러 균형을 맞춘다(미국 편중 방지).
  const rawCases = Array.isArray(outline.cases) ? outline.cases : [];
  const perCountry = new Map();
  const cases = [];
  for (const c of rawCases) {
    if (cases.length >= 4) break;
    const key = String((c && c.country) || "기타").trim().toLowerCase();
    const n = perCountry.get(key) || 0;
    if (n >= 2) continue; // 같은 나라 3번째부터 제외
    perCountry.set(key, n + 1);
    cases.push(c);
  }
  const plan = [
    { heading: "1. 개요", brief: "보고서 전체의 핵심 논지와 결론의 요지를 제시. 이번 호가 다루는 해외 동향이 무엇이고 왜 중요한지 설득력 있게(국내 사례는 다루지 않음)." },
    { heading: "2. 국제적 배경과 문제의식", brief: "해외에서 이 주제가 부상하는 구조적 배경(저성장·양극화·인구감소·돌봄공백 등)을 국제적 맥락에서 심층 분석(왜 지금 일어나는가). 한국 사례는 넣지 않는다." },
    { heading: "3. 국제 담론과 정책 동향", brief: "UN·ILO·OECD·EU 등 국제사회의 의제화와 각국(외국) 정부 정책 흐름을 검증된 사실 위주로 정리(어떤 논의가 어떻게 전개돼 왔는가)." },
  ];
  cases.forEach((c, i) => {
    plan.push({
      heading: `${4 + i}. 해외 사례 | ${c.country || "해외"} — ${c.name || "사례"}`,
      brief: `${c.country || ""}의 '${c.name || "사례"}'를 ①역사적 배경 ②제도·거버넌스 구조 ③실제 작동 방식과 재원 ④성과와 한계 ⑤국제적 함의 순으로 매우 구체적으로. 특히 조명할 점: ${c.angle || "지역경제·공동체에 준 효과"}.`,
      isCase: true,
    });
  });
  const base = 4 + cases.length;
  plan.push({ heading: `${base}. 해외 사례 비교와 공통 패턴`, brief: "앞서 다룬 해외 사례들을 서로 비교해 공통 성공요인·차이·한계를 도출(무엇이 같고 다른가). 국가 간 비교이며 한국은 포함하지 않는다." });
  plan.push({ heading: `${base + 1}. 시사점과 함의`, brief: "해외 사례들이 주는 교훈과 함의를 제도·금융(연대금융)·중간지원·인력양성 등 층위별로 정리(무엇을 배울 수 있나). 근거 있는 해석만. 한국 적용은 '참조' 수준의 한두 문장까지만." });
  plan.push({ heading: `${base + 2}. 결론과 향후 관전점`, brief: "핵심 논지를 응축하고, 해외에서 확정된 후속 과제와 앞으로 지켜볼 관전점(무엇을 확인해야 하나)을 제시." });
  return plan;
}

/** 2단계: 개별 절을 심층·완결 집필 */
function buildSectionPrompt(theme, sources, outline, spec, index, total) {
  return [
    PERSONA_PROMPT,
    `[보고서] ${outline.title} — ${outline.oneLine || outline.subtitle || ""}`,
    `[집필할 절] ${spec.heading}  (전체 ${total}개 절 중 ${index + 1}번째)`,
    `[이 절에서 다룰 내용] ${spec.brief}`,
    "",
    "요구 수준:",
    "- 박사급 연구자의 깊이로, '무슨 일이 있었나 → 왜 → 어떻게 작동하나 → 무엇이 달라지나' 흐름에 맞춰 구체적 사실·메커니즘·인과·비교를 서술합니다.",
    "- ★전부 한국어로만 작성합니다. 영어 문장·구절을 그대로 쓰지 말고, 영문 자료의 내용은 자연스러운 한국어로 옮겨 서술합니다(고유명사만 한글(원어) 병기).",
    "- 이 절 하나의 분량이 최소 1,500자, 가능하면 2,200자 이상이 되도록 충실히 씁니다. 분량 상한(페이지 제한)은 없으니 필요하면 더 길게 써도 됩니다.",
    "- 2~3개의 소제목(h3)으로 논리적으로 구조화하고, 핵심 항목은 불릿으로 정리합니다.",
    "- ★반드시 모든 문장을 완결해서 끝맺으세요. 문장·문단을 중간에 끊거나 '…', '등'으로 생략하지 마세요. 분량이 모자라면 근거 있는 설명을 더해 채우되, 출처에 없는 사실은 지어내지 마세요.",
    spec.isCase
      ? "- 이 절은 특정 해외 사례의 심층 분석입니다. 배경→제도→작동방식→성과와 한계→한국 함의가 모두 온전한 문단으로 드러나야 합니다."
      : "- 균형 잡힌 시각으로 반대 논거나 한계도 함께 다룹니다.",
    RULES,
    "",
    "다음 JSON만 출력(설명·코드블록 없이):",
    '{ "paragraphs": [ "완결된 문단", {"h3":"소제목"}, "완결된 문단", {"bullet":"항목"}, {"label":"핵심","text":"..."} ] }',
    "paragraphs 항목은 문자열 또는 {\"h3\":..},{\"bullet\":..},{\"lead\":..},{\"label\":..,\"text\":..} 중 하나입니다. 각 문단은 길고 밀도 있게, 완결된 문장으로 쓰세요.",
    "",
    "=== 출처 자료 ===",
    sourceBlock(sources),
  ].join("\n");
}

/** 설계안 + 절별 심층 집필 → A4 약 10쪽 보고서 객체. 실패 절은 재시도 후 건너뛴다. */
async function writeFullReport(theme, sources) {
  const outline = await llm(buildOutlinePrompt(theme, sources), { maxTokens: 2048, temperature: 0.5 });
  if (!outline || !outline.title) return null;

  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : (v ? [String(v).trim()] : []));
  // 핵심 내용: 보고서 전체를 관통하는 4~5개 완결 문장(구 keyFigures 대체)
  const keyPoints = arr(outline.keyPoints).slice(0, 5);
  const oneLine = String(outline.oneLine || "").trim();

  const plan = sectionPlan(outline);
  console.log(`[report]  · 개요 완료 → ${plan.length}개 절 순차 집필 시작`);
  // 무료 Gemini 과부하(503)·할당량(429) 방지를 위해 절을 1개씩 순차 집필(전역 스로틀이 호출 간격 보장).
  // 외부 재시도는 두지 않는다 — geminiJson 내부에서 이미 429/503 재시도를 하므로 중복 재시도로 할당량을 낭비하지 않음.
  const written = await mapLimit(plan, 1, async (spec, i) => {
    const r = await llm(buildSectionPrompt(theme, sources, outline, spec, i, plan.length), { maxTokens: 8192, temperature: 0.5, ms: 60000 });
    const paras = normParas(r && (r.paragraphs || (Array.isArray(r) ? r : null)));
    if (paras.length === 0) { console.warn(`[report]  · 절 집필 실패(건너뜀): ${spec.heading}`); return null; }
    console.log(`[report]  · 절 집필 완료: ${spec.heading} (${paras.length}문단)`);
    return { heading: spec.heading, paragraphs: paras };
  });
  const sections = written.filter(Boolean);
  if (!sections.length) return null;

  return {
    title: String(outline.title || theme.title).trim(),
    subtitle: oneLine || theme.focus,
    summary: String(outline.summary || oneLine || theme.focus).trim(),
    oneLine,
    keyPoints,
    sections,
  };
}

/* ---------------------------------------------- 3) 보고서 조립 */

/** 렌더 가능한 문단 형태로 정규화(LLM 출력 방어) + 문장 종결 보정(축약·미완결 문장 제거) */
function normParas(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => {
    if (typeof p === "string") return completeSentences(p);
    if (p && typeof p === "object") {
      if (p.lead != null) return { ...p, lead: completeSentences(p.lead) };
      if (p.text != null && p.label != null) return { ...p, text: completeSentences(p.text) };
      if (p.h3 != null || p.bullet != null || p.note != null) return p;
      if (p.text != null) return completeSentences(String(p.text));
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

function makeReportDocx(report, refs, dayKey) {
  const sections = [];
  // 한 줄 요약(있으면 맨 앞에)
  if (report.oneLine) sections.push({ heading: "한 줄 요약", paragraphs: [{ lead: String(report.oneLine) }] });
  // 핵심 내용(보고서 전체를 4~5개 핵심 문장으로 정리)
  if (Array.isArray(report.keyPoints) && report.keyPoints.length) {
    sections.push({ heading: "핵심 내용", paragraphs: report.keyPoints.map((f) => ({ bullet: String(f) })) });
  }
  // 본문 5문단(①~⑤)
  (report.sections || []).forEach((s) => sections.push({
    heading: String(s.heading || "").trim(),
    paragraphs: normParas(s.paragraphs),
  }));
  sections.push(referencesSection(refs));

  return buildDocx({
    title: report.title || "지구촌소식브리프",
    subtitle: report.oneLine || report.subtitle || "",
    publisher: AUTHOR,
    date: fmtDot(new Date().toISOString()),
    meta: [`${PERSONA} · 글로벌 일일 이슈 브리프`, `발행인 ${PUBLISHER_NAME} · ${dayKey}`],
    sections,
    colophon: COLOPHON,
  });
}

/** 보고서에서 '주요 시사점'을 뽑는다(시사점/제언 절의 불릿·문단 우선) */
function extractImplications(report, max = 5) {
  // 분석형 브리프: 의미·영향/향후 관전점을 시사점으로(본문과 분리)
  if (Array.isArray(report._implications) && report._implications.length) {
    return report._implications.slice(0, max).map((t) => {
      const s = String(t).replace(/\s+/g, " ").trim();
      return s.length > 220 ? completeSentences(s.slice(0, 220)) : s;
    });
  }
  const secs = report.sections || [];
  const pick = secs.find((s) => /시사점|제언|함의|의미|영향|관전|전망/.test(String(s.heading || "")))
    || secs.find((s) => /결론/.test(String(s.heading || "")));
  const out = [];
  const take = (arr) => {
    for (const p of arr || []) {
      if (out.length >= max) break;
      let t = "";
      if (typeof p === "string") t = p;
      else if (p && typeof p === "object") t = p.bullet || p.lead || p.text || "";
      t = String(t).replace(/\s+/g, " ").trim();
      if (t.length >= 12) out.push(t.length > 180 ? completeSentences(t.slice(0, 180)) : t);
    }
  };
  if (pick) take(pick.paragraphs);
  // 시사점 절이 비면 각 절 첫 문단에서 보완
  if (out.length === 0) for (const s of secs) { if (out.length >= max) break; take((s.paragraphs || []).slice(0, 1)); }
  return out;
}


/** 게시글 본문 — 순수 텍스트. 참고자료 URL 은 뷰에서 새 창 링크로 렌더된다.
 *  refs: [참고자료]에 넣을 상위 10건(중복 제거·랭킹 완료), dayKey: 'YYYY-Dddd' */
function makePostBody(report, sources, refs, dayKey, ai) {
  const lines = [];
  const dateDot = fmtDot(new Date().toISOString());
  const seq = daySeq(new Date());

  // 0) 머리글
  lines.push(`발행 ${AUTHOR} 발행일 ${dateDot}`);
  lines.push(`${PERSONA} · 글로벌 일일 이슈 브리프`);
  lines.push(`발행인 ${PUBLISHER_NAME} · ${dayKey}`);
  lines.push("");

  // 1) 주요내용 — "이번 호는 …" 정돈된 요약(중복 문구 정리)
  lines.push("[주요내용]");
  lines.push(buildHighlight(report, refs, ai));
  lines.push("");

  // 2) 시사점
  const imps = extractImplications(report);
  lines.push("[시사점]");
  if (imps.length) imps.forEach((t) => lines.push(`- ${t}`));
  else lines.push("- 자세한 내용은 첨부된 보고서를 확인해 주세요.");
  lines.push("");

  // 3) 참고자료 — 유사·중복 제거 후 임팩트 있는 10대 뉴스만 (URL은 뷰가 새 창 링크로 렌더)
  lines.push("[참고자료]");
  (refs || []).forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title} — ${s.source || "미상"}`);
    if (s.url) lines.push(`   ${s.url}`);
  });
  lines.push("");

  // 4) 오늘의 명언 — 주제(공동체·연대) 관련 검증된 격언 (한 줄: - 문구 (by 저자) -)
  const q = pickQuote(seq.dayOfYear);
  lines.push("[오늘의 명언]");
  lines.push(`- ${q.text} (by ${q.author}) -`);
  lines.push("");

  // 5) 고지
  lines.push(`※ 본 자료는 도시공동체본부가 공개자료를 바탕으로 매일 정리한 '${PERSONA}'입니다(${dayKey}). 인용 원문의 저작권은 각 매체에 있습니다.`);
  return lines.join("\n");
}

/** 주요내용: 서술 종결형('~다.')으로 끝나는 완결 문장만 5개 이내로 추출(카카오 발송용).
 *  단순히 마침표(.)로 자르지 않는다 → 약어(U. S.)·비종결 명사구('~ 배경.')를 문장으로 오인하지 않음. */
function kakaoSummary(report) {
  const raw = typeof report === "string" ? report : (report && (report.summary || report.oneLine));
  const base = String(raw || "").replace(/\s+/g, " ").trim();
  if (!base) return "오늘의 해외 사회연대경제·공동체경제 주요 흐름을 정리했습니다.";
  const CLOSE = "[”\"'’\\)\\]】》」』]*"; // 닫는 따옴표·괄호 허용
  // 종결어미 '다' + 마침표 경계마다 분할표시() 삽입 후 분리
  const marked = base.replace(new RegExp(`(다${CLOSE}[.。]${CLOSE})(\\s|$)`, "g"), "$1");
  const parts = marked.split("").map((s) => s.trim()).filter(Boolean);
  const isDeclarative = new RegExp(`다${CLOSE}[.。]${CLOSE}$`);
  const sents = parts.filter((s) => isDeclarative.test(s)).slice(0, 5);
  return sents.length ? sents.join(" ") : completeSentences(base);
}

/** 카카오톡 '나에게 보내기'용 요약 메시지
 *  형식: 'yyyy.mm.dd 도시공동체 지구촌소식 브리프' / [주요내용] 5줄 / [관련소식] 10건 / 명언 1줄 */
function buildKakaoMessage(report, refs, dayKey) {
  const seq = daySeq(new Date());
  const dateDot = fmtDot(new Date().toISOString()).replace(/\.\s*$/, ""); // yyyy.mm.dd
  const lines = [];
  lines.push(`${dateDot} 도시공동체 지구촌소식 브리프`);
  lines.push("");
  lines.push("[주요내용]");
  lines.push(kakaoSummary(report));
  lines.push("");
  lines.push("[관련소식]");
  (refs || []).slice(0, 10).forEach((s, i) => {
    lines.push(`${i + 1}. ${String(s.title).replace(/\s+/g, " ").trim()} - ${s.source || "미상"}`);
  });
  lines.push("");
  const q = pickQuote(seq.dayOfYear);
  lines.push(`- ${q.text} (by ${q.author}) -`);
  return lines.join("\n");
}

/** 저장된 지구촌소식브리프 게시물(content)에서 날짜·주요내용·관련소식·명언을 파싱 */
function parseGlobalPost(post) {
  const content = String((post && post.content) || "");
  const between = (label) => {
    const m = content.match(new RegExp(`\\[${label}\\]\\s*([\\s\\S]*?)(?:\\n\\s*\\[|\\n\\s*※|$)`));
    return m ? m[1].trim() : "";
  };
  let dateDot = "";
  const dm = content.match(/발행일\s*([0-9]{4}\.\s*[0-9]{1,2}\.\s*[0-9]{1,2})\.?/);
  if (dm) dateDot = dm[1].replace(/\s+/g, "");
  else if (post && post.created_at) dateDot = fmtDot(post.created_at).replace(/\.\s*$/, "");

  const highlight = between("주요내용");
  const summary = kakaoSummary({ summary: highlight });

  const refBlock = between("참고자료");
  const refs = [];
  for (const line of refBlock.split("\n")) {
    const m = line.match(/^\s*\d+\.\s*(.+)$/);
    if (!m) continue;
    const [title, source] = m[1].split(/\s+[—-]\s+/);
    refs.push(`${refs.length + 1}. ${(title || m[1]).trim()} - ${(source || "미상").trim()}`);
    if (refs.length >= 10) break;
  }

  const qBlock = between("오늘의 명언");
  let quoteLine = "";
  const one = qBlock.match(/-\s*(.+?)\s*\(by\s*(.+?)\)\s*-/);
  const two = qBlock.match(/-\s*(.+?)\s*-\s*\n-\s*by\s*(.+)/);
  if (one) quoteLine = `- ${one[1].trim()} (by ${one[2].trim()}) -`;
  else if (two) quoteLine = `- ${two[1].trim()} (by ${two[2].trim()}) -`;
  else if (qBlock) quoteLine = qBlock.split("\n")[0].trim();

  return { dateDot, summary, refs, quoteLine };
}

/** '~다.' 종결 문장 단위로 예산(글자수) 이내까지만 담는다 */
function trimToBudget(text, budget) {
  const sents = String(text || "").split(/(?<=다[.。])\s+/);
  let out = "";
  for (const s of sents) {
    const cand = out ? out + " " + s : s;
    if (cand.length > budget) break;
    out = cand;
  }
  if (!out) out = completeSentences(String(text || "").slice(0, budget));
  return out.trim();
}

/** 저장된 글 → 카카오 발송 메시지(전체판: 주요내용·관련소식10·명언). 200자 초과 시 분할됨. */
function buildKakaoMessageFromPost(post) {
  const { dateDot, summary, refs, quoteLine } = parseGlobalPost(post);
  const out = [];
  out.push(`${dateDot} 도시공동체 지구촌소식 브리프`);
  out.push("");
  out.push("[주요내용]");
  out.push(summary);
  out.push("");
  out.push("[관련소식]");
  refs.forEach((r) => out.push(r));
  if (quoteLine) { out.push(""); out.push(quoteLine); }
  return out.join("\n");
}

/** 저장된 글 → 카카오 '한 통(≤200자)' 메시지: 날짜 + 주요내용(압축) + 링크 안내.
 *  관련소식 10건·명언 전문은 게시물 링크(브리프 보기)로 연결한다. */
function buildKakaoShortFromPost(post) {
  const { dateDot, summary } = parseGlobalPost(post);
  const header = `${dateDot} 도시공동체 지구촌소식 브리프`;
  const label = "[주요내용]";
  const cta = "▶ 관련소식·명언·전문은 아래 링크에서";
  // 전체 ≤168자 목표('[테스트] ' 접두 6자를 더해도 카카오 200자·분할기준 182자 이내로 한 통 보장).
  // 줄바꿈 5개 포함 고정길이를 뺀 나머지를 주요내용 예산으로 사용.
  const budget = Math.max(50, 168 - header.length - label.length - cta.length - 5);
  const shortSummary = trimToBudget(summary, budget);
  return [header, "", label, shortSummary, "", cta].join("\n");
}

/* --------------------------------------------- 4) 발행(글+첨부) */

function publishReport(report, sources, dayKey, theme, ai, guidOverride) {
  const guid = guidOverride || `report:${dayKey}:${theme.key}`;
  const title = `[리포트] ${String(report.title || "사회연대경제 이슈리포트").replace(/\s+/g, " ").trim()}`.slice(0, 200);
  const now = new Date().toISOString();

  // [참고자료]·docx 모두 유사·중복 제거 후 임팩트 상위 10건만 사용
  const refs = topReferences(sources, theme, 10);

  const res = insertPost.run(BOARD, title, makePostBody(report, sources, refs, dayKey, ai), AUTHOR, now, now, guid);
  const postId = Number(res.lastInsertRowid);

  try {
    const buf = makeReportDocx(report, refs, dayKey);
    const stored = crypto.randomBytes(12).toString("hex") + ".docx";
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
    const original = safeFileName(`${report.title || "사회연대경제 이슈리포트"} (${dayKey})`) + ".docx";
    insertAttach.run(postId, stored, original, DOCX_MIME, buf.length);
    return { postId, title, attached: true };
  } catch (e) {
    console.error("[report] docx 첨부 실패(post " + postId + "):", e.message);
    return { postId, title, attached: false };
  }
}

/* -------------------------------------------------- 1회 발행 실행 */

/**
 * 오늘자 리포트를 만든다(일일 발행). 날짜(연중 일수)로 주제를 로테이션하며,
 * 같은 날·주제 글이 이미 있으면(수동/자동 중복 실행) 건너뛴다.
 * force:true 면 오늘 이미 발행돼도 다음 주제로 강제 발행(관리자 '지금 발행'용).
 */
let _collectRunning = false; // 발행 작업 동시 실행 방지(스케줄러+수동 '지금 발행' 중복 → 과부하/중복 충돌 차단)

async function collectOnce({ force = false } = {}) {
  if (_collectRunning) {
    console.log("[report] 이미 리포트 발행 작업이 진행 중 → 이번 요청은 건너뜀(중복 실행 방지)");
    return { published: false, reason: "busy" };
  }
  _collectRunning = true;
  try {
    return await _collectOnceInner({ force });
  } finally {
    _collectRunning = false;
  }
}

async function _collectOnceInner({ force = false } = {}) {
  const seq = daySeq(new Date());
  let idx = (seq.dayOfYear - 1) % THEMES.length;
  if (force) {
    // 오늘 이미 발행된 주제가 있으면 다음 주제로 밀어 새 리포트를 만든다
    for (let n = 0; n < THEMES.length; n++) {
      const t = THEMES[(idx + n) % THEMES.length];
      if (!existsGuid.get(`report:${seq.key}:${t.key}`)) { idx = (idx + n) % THEMES.length; break; }
    }
  }
  const theme = THEMES[idx];
  let guid = `report:${seq.key}:${theme.key}`;
  if (existsGuid.get(guid)) {
    if (!force) {
      console.log(`[report] 오늘자 리포트 이미 발행됨: ${guid}`);
      return { published: false, reason: "exists", dayKey: seq.key, theme: theme.key };
    }
    // 강제 발행: 오늘 모든 주제가 이미 발행된 경우 등 — 유니크 접미사로 중복 충돌 방지
    guid = `${guid}:${Date.now().toString(36)}`;
  }

  if (!GEMINI_KEY()) {
    console.error("[report] ⚠ GEMINI_API_KEY 없음 → 발행 건너뜀 (.env 확인 후 'pm2 restart ucc')");
    return { published: false, reason: "no-key", dayKey: seq.key, theme: theme.key };
  }

  // 하루 재시도 상한: 무료 Gemini 할당량(429)이 소진되면 매시간 캐치업이 계속 실패하며
  // 남은 할당량(챗봇 등 공유)까지 태운다. 하루 최대 N회만 시도하고 이후엔 건너뛴다(수동 '지금 발행'은 예외).
  const ATTEMPT_KEY = `report_attempts:${seq.key}`;
  const MAX_DAILY_ATTEMPTS = 6;
  if (!force) {
    const attempts = parseInt(getSetting(ATTEMPT_KEY, "0"), 10) || 0;
    if (attempts >= MAX_DAILY_ATTEMPTS) {
      console.warn(`[report] 오늘 자동 시도 상한(${MAX_DAILY_ATTEMPTS}회) 도달 → 캐치업 중단(무료 할당량 보호). 필요 시 관리자 '지금 발행'으로 강제 가능.`);
      return { published: false, reason: "attempt-cap", dayKey: seq.key, theme: theme.key };
    }
    setSetting(ATTEMPT_KEY, String(attempts + 1));
  }

  const t0 = Date.now();
  console.log(`[report] 리포트 작성 시작 — ${seq.key} / ${theme.title}`);

  const sources = await researchSources(theme, { maxSources: 12 });
  console.log(`[report] 관련 자료 ${sources.length}건 수집(관련성 필터 적용)`);
  // 영문 해외 기사 본문 확보 → 심층 분석 근거로 사용
  try { const n = await enrichIntlSources(sources); if (n) console.log(`[report] 영문 기사 본문 확보 ${n}건`); } catch (e) {}
  // 영문 발췌를 한국어로 번역·정리(완결 문장) → 이후 요약/참고자료가 모두 한국어
  try { const t = await translateSourcesToKorean(sources); if (t) console.log(`[report] 영문 기사 한국어 번역 ${t}건`); } catch (e) {}

  // 주제와 관련된 소스가 하나도 없으면 저품질 발행을 막기 위해 오늘 회차는 건너뜀
  if (!sources.length) {
    console.warn(`[report] 관련 자료 0건 → 발행 건너뜀 (${seq.key} / ${theme.title})`);
    return { published: false, reason: "no-relevant-sources", dayKey: seq.key, theme: theme.key };
  }

  const report = await writeFullReport(theme, sources);
  // LLM 집필이 전부 실패하면 국내·영문 fallback을 발행하지 않고 건너뜀(지침: 완결 한국어 심층 보고서만 발행)
  if (!report || !report.sections || !report.sections.length) {
    console.error(`[report] ⚠ Gemini 집필 실패 → 발행 건너뜀(저품질 fallback 미발행). 과부하면 캐치업이 재시도합니다.`);
    return { published: false, reason: "write-failed", dayKey: seq.key, theme: theme.key };
  }
  // 최종 안전망: 보고서에 남은 영문 문단을 한국어로 재작성
  try { const k = await koreanizeReport(report); if (k) console.log(`[report] 잔여 영문 문단 한국어화 ${k}건`); } catch (e) {}

  const out = publishReport(report, sources, seq.key, theme, true, guid);
  console.log(`[report] 발행 완료 — post ${out.postId} (AI집필/gemini, 첨부 ${out.attached}, ${Math.round((Date.now() - t0) / 1000)}초 소요)`);
  // 카카오톡 발송은 발행과 분리되어 매일 08:00 KST 스케줄러가 '오늘자 발행 글'을 읽어 전송한다(아래 startKakaoScheduler).
  return { published: true, ai: true, provider: "gemini", dayKey: seq.key, theme: theme.key, ...out };
}

/** 공개 사이트 절대 주소(카카오 링크·OG 등) */
function SITE_BASE_URL() {
  return (process.env.BASE_URL || "https://ucc.or.kr").replace(/\/+$/, "");
}

/* ------------------- 스케줄러: 매일 07:00 (KST 고정, 서버 타임존 무관) ------- */

// 서버 타임존과 무관하게 항상 KST(UTC+9) 기준으로 계산한다.
function kstTargetMs(hour, minute) {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  // 오늘(KST) hour:minute 의 UTC epoch = KST 자정(UTC 표현) - 9h + 시각
  return Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), hour, minute, 0) - 9 * 3600 * 1000;
}

function msUntilDaily(hour, minute) {
  const now = Date.now();
  let target = kstTargetMs(hour, minute);
  if (target <= now) target += 86400000; // 오늘(KST) 시각이 지났으면 내일
  return target - now;
}

// 오늘 KST hour:minute 이 지났는가
function kstPassedToday(hour, minute) {
  return Date.now() >= kstTargetMs(hour, minute);
}

function startScheduler() {
  const H = 7, M = 0; // 매일 07:00
  let running = false; // 정시/캐치업 동시 실행 방지

  const publishIfDue = async (reason) => {
    if (running) return;
    running = true;
    try {
      const r = await collectOnce();               // 일 단위 멱등: 오늘자 이미 발행됐으면 no-op
      if (r && r.published) console.log(`[report] 일일 발행 완료 (${reason})`);
    } catch (e) {
      console.error(`[report] 일일 발행 오류 (${reason}):`, e.message);
    } finally { running = false; }
  };

  // 1) 정시 실행: 매일 07:00
  const run = async () => {
    await publishIfDue("정시");
    setTimeout(run, msUntilDaily(H, M));
  };
  setTimeout(run, msUntilDaily(H, M));

  // 2) 안전망: 매시간 점검 — 재시작 등으로 정시를 놓쳤어도, 오늘 07:00이 지났는데
  //    오늘자 리포트가 없으면 즉시 캐치업 발행(멱등이라 중복 없음)
  const safety = () => {
    if (kstPassedToday(H, M)) publishIfDue("캐치업");
  };
  safety();                                  // 시작 즉시 1회(재시작 캐치업)
  setInterval(safety, 60 * 60 * 1000);       // 매시간 재점검

  const nextKst = new Date(Date.now() + msUntilDaily(H, M) + 9 * 3600 * 1000);
  console.log(`[report] 일일 스케줄러 시작 — 다음 정시 발행(KST): ${nextKst.toISOString().replace("T", " ").slice(0, 16)} · 안전망(매시간 캐치업) 활성`);
}

/** 최신 지구촌소식브리프 게시물 1건(카카오 미리보기/재발송용) */
function latestGlobalPost() {
  try { return db.prepare("SELECT * FROM posts WHERE board = ? ORDER BY id DESC LIMIT 1").get(BOARD) || null; }
  catch (e) { return null; }
}

/** 오늘자(KST) 발행 글 1건 — source_guid(report:YYYY-Dddd:*) 로 정확히 매칭 */
function todaysGlobalPost() {
  const seq = daySeq(new Date());
  try { return db.prepare("SELECT * FROM posts WHERE board = ? AND source_guid LIKE ? ORDER BY id DESC LIMIT 1").get(BOARD, `report:${seq.key}:%`) || null; }
  catch (e) { return null; }
}

/* ------------------- 카카오톡 자동발송: 매일 08:00 (KST 고정) -------------------
 * 발행(07:00)과 분리. 08:00에 '오늘자 발행 글'을 읽어 카카오로 보낸다(하루 1회 멱등).
 * 07:00 발행이 지연/실패해도 매시간 캐치업이 오늘 글이 준비되는 즉시 발송한다. */
const K_SENT_DAYKEY = "kakao_memo_last_sent_daykey";

/** 오늘자 브리프를 카카오로 발송(하루 1회). 반환 { sent, reason?, postId?, parts? } */
async function sendTodayKakao(reason = "manual") {
  const kakao = require("./kakao");
  const { getSetting, setSetting } = require("./db");
  const seq = daySeq(new Date());
  if (!kakao.isConnected()) return { sent: false, reason: "not-connected" };
  if (!kakao.autoSendOn()) return { sent: false, reason: "autosend-off" };
  if (getSetting(K_SENT_DAYKEY) === seq.key) return { sent: false, reason: "already-sent" };
  const post = todaysGlobalPost();
  if (!post) { console.log(`[kakao] 오늘자 브리프 글이 아직 없어 발송 보류 (${reason})`); return { sent: false, reason: "no-post" }; }
  const msg = buildKakaoShortFromPost(post); // 한 통(≤200자) + 링크
  const link = `${SITE_BASE_URL()}/board/global/${post.id}`;
  const n = await kakao.sendToMe(msg, link);
  setSetting(K_SENT_DAYKEY, seq.key); // 오늘 발송 완료 표시(중복 방지)
  console.log(`[kakao] 자동발송 완료 (${reason}) — post ${post.id}, ${n}통 · ${seq.key}`);
  return { sent: true, postId: post.id, parts: n };
}

function startKakaoScheduler() {
  const H = 8, M = 0; // 매일 08:00 KST 고정
  let running = false;

  const sendIfDue = async (reason) => {
    if (running) return;
    running = true;
    try { await sendTodayKakao(reason); }
    catch (e) { console.error(`[kakao] 자동발송 오류 (${reason}):`, e.message); }
    finally { running = false; }
  };

  // 1) 정시: 매일 08:00
  const run = async () => {
    await sendIfDue("정시");
    setTimeout(run, msUntilDaily(H, M));
  };
  setTimeout(run, msUntilDaily(H, M));

  // 2) 안전망: 매시간 — 08:00이 지났는데 오늘자 미발송이면(글 준비되는 대로) 발송(멱등)
  const safety = () => { if (kstPassedToday(H, M)) sendIfDue("캐치업"); };
  safety();                              // 시작 즉시 1회(재시작 캐치업)
  setInterval(safety, 60 * 60 * 1000);   // 매시간 재점검

  const nextKst = new Date(Date.now() + msUntilDaily(H, M) + 9 * 3600 * 1000);
  console.log(`[kakao] 자동발송 스케줄러 시작 — 다음 발송(KST): ${nextKst.toISOString().replace("T", " ").slice(0, 16)} · 매시간 캐치업 활성`);
}

module.exports = {
  collectOnce, startScheduler, startKakaoScheduler, sendTodayKakao,
  THEMES, AUTHOR, PERSONA, BOARD,
  buildKakaoMessage, buildKakaoMessageFromPost, buildKakaoShortFromPost,
  latestGlobalPost, todaysGlobalPost, SITE_BASE_URL,
};
