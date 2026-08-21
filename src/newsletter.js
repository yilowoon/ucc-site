/* 뉴스레터 자동 수집: 사회적경제 등 키워드 뉴스 큐레이션
 * - 기본: Daum 뉴스 검색 → 실제 기사(제목·본문요약·대표사진·출처) 크롤링
 * - 선택: NAVER_CLIENT_ID/SECRET 있으면 네이버 뉴스 API 병용
 * - 폴백: Google 뉴스 RSS (제목·출처·링크만)
 * - 이미지: 기사에서 발췌(og:image + 본문 사진). 1장뿐이면 기사 키워드·제목
 *   기반 이미지를 생성(SVG)해 2컷을 보장.
 * - 저작권: 원문 전문을 저장하지 않고 제목 + 요약 발췌 + 출처 링크만 저장.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { db, UPLOAD_DIR } = require("./db");

const KEYWORDS = [
  "사회적경제", "사회연대경제", "마을기업", "협동조합",
  "자활기업", "사회적기업", "소셜벤처", "혁신생태계",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const insertRow = db.prepare(
  "INSERT OR IGNORE INTO newsletter (title, summary, content, source, url, keyword, image1, image2, guid, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
const existsGuid = db.prepare("SELECT 1 FROM newsletter WHERE guid = ?");

// ---------- 유틸 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function decodeEntities(s) {
  const once = (v) => v
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch (e) { return m; } })
    .replace(/&amp;/g, "&");
  let x = String(s || ""); x = once(x); x = once(x); return x;
}
async function fetchText(url, ms = 10000, headers = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": UA, "Accept-Language": "ko", ...headers } });
    return { status: r.status, text: await r.text(), url: r.url };
  } finally { clearTimeout(to); }
}
function metaTag(h, prop) {
  const m =
    h.match(new RegExp('<meta[^>]+property=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)', "i")) ||
    h.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']' + prop + '["\']', "i")) ||
    h.match(new RegExp('<meta[^>]+name=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)', "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}

// ---------- 소스: Daum 뉴스 검색 → 기사 크롤링 ----------
async function daumArticleLinks(keyword) {
  const url = "https://search.daum.net/search?w=news&sort=recency&q=" + encodeURIComponent(keyword);
  const { text } = await fetchText(url, 10000);
  return [...new Set([...text.matchAll(/https?:\/\/v\.daum\.net\/v\/[0-9]+/g)].map((m) => m[0]))];
}
function daumPhotos(h) {
  const map = new Map();
  const push = (u) => {
    if (!u) return;
    const fn = (u.match(/fname=([^&"']+)/) || [])[1] || u;
    if (!map.has(fn)) map.set(fn, u.replace(/&amp;/g, "&"));
  };
  const og = metaTag(h, "og:image");
  if (og && /daumcdn\.net\/thumb\//.test(og) && !/\/meta\/|news\.png|default/i.test(og)) push(og);
  for (const m of h.matchAll(/<img[^>]+(?:data-src|src)=["'](https?:\/\/img[0-9]?\.daumcdn\.net\/thumb\/[^"']+?fname=[^"']+?)["']/gi)) push(m[1]);
  return [...map.values()];
}
// 기사 본문(문단) 추출 — Daum dmcf 일반 문단
function daumBody(h) {
  const paras = [...h.matchAll(/<p[^>]*dmcf-ptype=["']general["'][^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(stripTags(m[1])))
    .filter((t) => t.length > 1);
  return paras.join("\n\n").slice(0, 8000);
}
async function parseDaumArticle(link) {
  const { text: h } = await fetchText(link, 10000);
  const title = metaTag(h, "og:title");
  if (!title) return null;
  let summary = metaTag(h, "og:description");
  const content = daumBody(h);
  const source = metaTag(h, "og:article:author") || metaTag(h, "author") || "다음뉴스";
  const pub = metaTag(h, "article:published_time");
  const id = (link.match(/\/v\/([0-9]+)/) || [])[1] || link;
  return {
    title, summary, content, source, url: link, guid: "daum:" + id,
    published_at: pub ? new Date(pub).toISOString() : "",
    images: daumPhotos(h),
  };
}
async function fromDaum(keyword) {
  let links = [];
  try { links = await daumArticleLinks(keyword); } catch (e) { return []; }
  const out = [];
  for (const link of links.slice(0, 8)) {
    try {
      const a = await parseDaumArticle(link);
      if (a && a.title) out.push(a);
    } catch (e) { /* 개별 기사 실패 무시 */ }
    await sleep(220);
    if (out.length >= 6) break;
  }
  return out;
}

// ---------- 소스: 네이버 뉴스 API (키 있을 때) ----------
async function ogImage(url) {
  try {
    const { text: h } = await fetchText(url, 8000);
    const og = metaTag(h, "og:image");
    if (og && /^https?:\/\//.test(og) && !/googleusercontent\.com|news\.google\.com|gstatic/.test(og)) return og;
  } catch (e) {}
  return "";
}
async function fromNaver(keyword) {
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;
  const url = "https://openapi.naver.com/v1/search/news.json?display=5&sort=date&query=" + encodeURIComponent(keyword);
  const { text } = await fetchText(url, 10000, { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret });
  let data; try { data = JSON.parse(text); } catch (e) { return []; }
  const out = [];
  for (const it of (data.items || []).slice(0, 3)) {
    const link = it.originallink || it.link;
    const img = await ogImage(link);
    out.push({
      title: decodeEntities(stripTags(it.title)),
      summary: decodeEntities(stripTags(it.description)),
      source: (() => { try { return new URL(link).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })(),
      url: link, guid: (link || "").split("?")[0],
      published_at: it.pubDate ? new Date(it.pubDate).toISOString() : "",
      images: img ? [img] : [],
    });
    await sleep(200);
  }
  return out;
}

// ---------- 소스: Google 뉴스 RSS (최후 폴백) ----------
async function fromGoogle(keyword) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(keyword) + "&hl=ko&gl=KR&ceid=KR:ko";
  const { text } = await fetchText(url, 10000);
  const out = [];
  for (const it of text.split("<item>").slice(1, 4)) {
    const g = (re) => { const m = it.match(re); return m ? m[1] : ""; };
    let title = decodeEntities(stripTags(g(/<title>([\s\S]*?)<\/title>/)));
    const source = decodeEntities(stripTags(g(/<source[^>]*>([\s\S]*?)<\/source>/)));
    const link = decodeEntities(g(/<link>([\s\S]*?)<\/link>/).trim());
    const pub = g(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)).trim();
    const token = (link.split("/articles/")[1] || link).split("?")[0];
    out.push({ title, summary: "", source, url: link, guid: token || link, published_at: pub ? new Date(pub).toISOString() : "", images: [] });
  }
  return out;
}

// ---------- AI 이미지 생성: Gemini(Generative Language API) ----------
// 환경변수: GEMINI_API_KEY(필수), GEMINI_IMAGE_MODEL(선택), GEMINI_BASE_URL(선택)
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const GEMINI_MODEL = () => process.env.GEMINI_IMAGE_MODEL || "imagen-3.0-generate-002";
async function postJson(url, body, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) { console.error("[newsletter] Gemini HTTP", r.status, t.slice(0, 200)); return null; }
    try { return JSON.parse(t); } catch (e) { return null; }
  } finally { clearTimeout(to); }
}
async function geminiImage(title, keyword) {
  const key = GEMINI_KEY(); if (!key) return "";
  const model = GEMINI_MODEL(), base = GEMINI_BASE();
  const prompt = `사회적경제 분야 '${keyword}' 주제를 상징하는 사실적인 편집용 대표 이미지. 맥락: ${String(title).slice(0, 120)}. 특정 실존 인물이 아닌 일반적인 한국인 인물이 등장하는 자연스럽고 전문적인 장면, 협력과 공동체의 따뜻하고 희망적인 분위기, 고품질 사진 스타일(photorealistic), 가로 구도. 글자·로고·워터마크 없음.`;
  try {
    let b64 = "";
    if (/^imagen/i.test(model)) {
      const r = await postJson(`${base}/v1beta/models/${model}:predict?key=${encodeURIComponent(key)}`,
        { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: "16:9" } }, 40000);
      b64 = r && r.predictions && r.predictions[0] && r.predictions[0].bytesBase64Encoded || "";
    } else {
      const r = await postJson(`${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }, 40000);
      const parts = (r && r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts) || [];
      const p = parts.find((x) => x.inlineData || x.inline_data);
      b64 = (p && (p.inlineData || p.inline_data) && (p.inlineData || p.inline_data).data) || "";
    }
    if (!b64) return "";
    const fname = `nl-gen-${Date.now().toString(36)}-${Math.abs(hashInt(title)).toString(36)}.png`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), Buffer.from(b64, "base64"));
    console.log("[newsletter] Gemini 이미지 생성:", fname);
    return "/uploads/" + fname;
  } catch (e) { console.error("[newsletter] Gemini 이미지 생성 실패:", e.message); return ""; }
}

// ---------- 생성 이미지(SVG): 흰 배경 + 관련 무늬 + 캐릭터 + 고정 레이아웃 ----------
function xmlEsc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function wrapLines(s, per, max) {
  const t = String(s || "").trim(); const lines = [];
  for (let i = 0; i < t.length && lines.length < max; i += per) lines.push(t.slice(i, i + per));
  if (lines.length === max && t.length > per * max) lines[max - 1] = lines[max - 1].slice(0, per - 1) + "…";
  return lines;
}
// 기사 제목에서 핵심 주제어(타이틀)와 서브주제를 분리
function deriveTitleSub(title, keyword) {
  let t = String(title || "").replace(/^\s*[\[\(【][^\]\)】]*[\]\)】]\s*/, "").replace(/\s*[\[\(【][^\]\)】]*[\]\)】]\s*$/, "").trim();
  const parts = t.split(/\s*(?:\.\.\.|…|·|—|–|-|\||~|:|,)\s*/).filter(Boolean);
  let core = (parts[0] || t).trim();
  let sub = parts.slice(1).join(" ").trim();
  if (core.length > 30) { sub = core.slice(30).trim() + (sub ? " " + sub : ""); core = core.slice(0, 30).trim(); }
  if (!sub) sub = keyword + " 관련 동향";
  return { core, sub };
}
function buildGenSvg(keyword, title, dateStr) {
  const accents = ["#2f8f63", "#3b7fb0", "#cd9b4c", "#ec9226", "#2f9e8f", "#7b61b0"];
  const h = Math.abs([...String(keyword || "x")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
  const accent = accents[h % accents.length];
  const jacket = accent, hair = "#3a2e26", skin = "#f0c9a8";
  const { core, sub } = deriveTitleSub(title, keyword);
  const catText = xmlEsc(keyword);
  const titleLines = wrapLines(core, 13, 2);
  const subText = xmlEsc(sub.length > 22 ? sub.slice(0, 21) + "…" : sub);
  const dateFmt = "-'" + xmlEsc(dateStr || "") + "'-";
  const titleTspans = titleLines.map((l, i) => `<text x="44" y="${248 + i * 34}" font-family="'Pretendard','Malgun Gothic',sans-serif" font-size="27" font-weight="800" fill="#16241d">${xmlEsc(l)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
<rect width="600" height="400" fill="#ffffff"/>
<!-- 관련 무늬: 우상단 링·점 패턴 -->
<g opacity="0.14" stroke="${accent}" fill="none" stroke-width="10">
  <circle cx="520" cy="60" r="120"/><circle cx="560" cy="120" r="70"/>
</g>
<g opacity="0.18" fill="${accent}">
  <circle cx="360" cy="40" r="5"/><circle cx="400" cy="70" r="4"/><circle cx="440" cy="30" r="4"/>
  <circle cx="330" cy="90" r="4"/><circle cx="470" cy="90" r="5"/>
</g>
<line x1="44" y1="150" x2="120" y2="150" stroke="${accent}" stroke-width="4"/>
<!-- 캐릭터(가상 인물 일러스트) -->
<g transform="translate(452,196)">
  <ellipse cx="0" cy="150" rx="120" ry="26" fill="${accent}" opacity="0.10"/>
  <path d="M-78,155 C-78,78 -44,52 0,52 C44,52 78,78 78,155 Z" fill="${jacket}"/>
  <path d="M-20,62 L0,86 L20,62" stroke="#ffffff" stroke-width="9" fill="none" stroke-linejoin="round"/>
  <rect x="-16" y="18" width="32" height="46" rx="14" fill="${skin}"/>
  <circle cx="0" cy="-12" r="46" fill="${skin}"/>
  <path d="M-47,-14 C-47,-46 -22,-58 0,-58 C22,-58 47,-46 47,-14 C40,-30 26,-40 0,-38 C-26,-40 -40,-30 -47,-14 Z" fill="${hair}"/>
  <circle cx="-16" cy="-14" r="3.4" fill="#33403a"/><circle cx="16" cy="-14" r="3.4" fill="#33403a"/>
  <path d="M-13,4 Q0,15 13,4" stroke="#c07a5e" stroke-width="3" fill="none" stroke-linecap="round"/>
</g>
<!-- 상단: UCC NEWSLETTER + 카테고리 -->
<text x="44" y="52" font-family="sans-serif" font-size="15" letter-spacing="3" font-weight="700" fill="#16241d">UCC NEWSLETTER</text>
<rect x="44" y="70" rx="13" ry="13" width="${Math.min(300, 30 + catText.length * 20)}" height="30" fill="${accent}"/>
<text x="60" y="90" font-family="'Pretendard','Malgun Gothic',sans-serif" font-size="16" font-weight="700" fill="#ffffff">${catText}</text>
<!-- 핵심 주제어(타이틀) -->
${titleTspans}
<!-- 서브주제 -->
<text x="44" y="${248 + titleLines.length * 34 + 8}" font-family="'Pretendard','Malgun Gothic',sans-serif" font-size="16" font-weight="600" fill="#5a6b62">${subText}</text>
<!-- 날짜 -->
<text x="44" y="${248 + titleLines.length * 34 + 34}" font-family="'Pretendard','Malgun Gothic',sans-serif" font-size="15" font-weight="700" fill="${accent}">${dateFmt}</text>
<!-- 하단 -->
<text x="44" y="378" font-family="'Pretendard','Malgun Gothic',sans-serif" font-size="14" fill="#8a968f">사단법인 도시공동체본부</text>
</svg>`;
}

// ---------- 1회 수집 ----------
async function collectOnce() {
  const useNaver = !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
  let inserted = 0, scanned = 0;
  // 1회 수집 규칙: 총 2건만 저장, 키워드당 1건, '실제 기사 이미지 2개 이상'인 기사만 채택
  const MAX_PER_KEYWORD = 1, MAX_TOTAL = 2, MIN_IMAGES = 2;
  for (const kw of KEYWORDS) {
    if (inserted >= MAX_TOTAL) break;
    let items = [];
    try {
      items = await fromDaum(kw);
      if ((!items || !items.length) && useNaver) items = await fromNaver(kw);
      if (!items || !items.length) items = await fromGoogle(kw);
    } catch (e) { console.error("[newsletter] fetch 실패:", kw, e.message); continue; }
    let perKw = 0;
    for (const it of items || []) {
      if (perKw >= MAX_PER_KEYWORD || inserted >= MAX_TOTAL) break;
      scanned++;
      if (!it.title || !it.guid) continue;
      if (existsGuid.get(it.guid)) continue;
      // 실제 기사 이미지가 2개 이상인 기사만 채택 (두 컷 모두 원문 사진 사용)
      const imgs = (it.images || []).filter(Boolean);
      if (imgs.length < MIN_IMAGES) continue;
      const image1 = imgs[0];
      const image2 = imgs[1];
      const summary = (it.summary && it.summary.length >= 20)
        ? it.summary
        : `‘${kw}’ 관련 최신 보도입니다. 원문에서 자세한 내용을 확인하실 수 있습니다.${it.source ? " (출처: " + it.source + ")" : ""}`;
      try {
        const res = insertRow.run(
          it.title.slice(0, 300), summary.slice(0, 1000), (it.content || "").slice(0, 8000),
          it.source.slice(0, 100), it.url.slice(0, 500), kw, image1, image2, it.guid.slice(0, 400),
          it.published_at || new Date().toISOString(), new Date().toISOString()
        );
        if (res.changes > 0) { inserted++; perKw++; }
      } catch (e) { /* 중복 등 무시 */ }
      await sleep(150);
    }
    await sleep(300);
  }
  console.log(`[newsletter] 수집 완료: 신규 ${inserted}건 (검토 ${scanned}건)`);
  return { inserted, scanned };
}

// ---------- 스케줄러: 매일 08:00 / 18:00 (서버 로컬 시간) ----------
function msUntilNext(hoursList) {
  const now = new Date();
  let best = Infinity;
  for (const h of hoursList) {
    const t = new Date(now); t.setHours(h, 0, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    best = Math.min(best, t.getTime() - now.getTime());
  }
  return best;
}
function startScheduler() {
  const run = async () => {
    try { await collectOnce(); } catch (e) { console.error("[newsletter] 스케줄 수집 오류:", e.message); }
    setTimeout(run, msUntilNext([8, 18]));
  };
  const count = db.prepare("SELECT COUNT(*) AS n FROM newsletter").get().n;
  if (count === 0) setTimeout(() => { collectOnce().catch(() => {}); }, 60 * 1000);
  setTimeout(run, msUntilNext([8, 18]));
  const next = new Date(Date.now() + msUntilNext([8, 18]));
  console.log(`[newsletter] 스케줄러 시작 — 다음 수집: ${next.toLocaleString()}`);
}

module.exports = { collectOnce, startScheduler, buildGenSvg, KEYWORDS };
