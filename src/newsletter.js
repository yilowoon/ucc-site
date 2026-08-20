/* 뉴스레터 자동 수집: 사회적경제 등 키워드 뉴스 큐레이션
 * - 기본: Daum 뉴스 검색 → 실제 기사(제목·본문요약·대표사진·출처) 크롤링
 * - 선택: NAVER_CLIENT_ID/SECRET 있으면 네이버 뉴스 API 병용
 * - 폴백: Google 뉴스 RSS (제목·출처·링크만)
 * - 이미지: 기사에서 발췌(og:image + 본문 사진). 1장뿐이면 기사 키워드·제목
 *   기반 이미지를 생성(SVG)해 2컷을 보장.
 * - 저작권: 원문 전문을 저장하지 않고 제목 + 요약 발췌 + 출처 링크만 저장.
 */
"use strict";

const { db } = require("./db");

const KEYWORDS = [
  "사회적경제", "사회연대경제", "마을기업", "협동조합",
  "자활기업", "사회적기업", "소셜벤처", "혁신생태계",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const insertRow = db.prepare(
  "INSERT OR IGNORE INTO newsletter (title, summary, source, url, keyword, image1, image2, guid, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
async function parseDaumArticle(link) {
  const { text: h } = await fetchText(link, 10000);
  const title = metaTag(h, "og:title");
  if (!title) return null;
  let summary = metaTag(h, "og:description");
  const source = metaTag(h, "og:article:author") || metaTag(h, "author") || "다음뉴스";
  const pub = metaTag(h, "article:published_time");
  const id = (link.match(/\/v\/([0-9]+)/) || [])[1] || link;
  return {
    title, summary, source, url: link, guid: "daum:" + id,
    published_at: pub ? new Date(pub).toISOString() : "",
    images: daumPhotos(h),
  };
}
async function fromDaum(keyword) {
  let links = [];
  try { links = await daumArticleLinks(keyword); } catch (e) { return []; }
  const out = [];
  for (const link of links.slice(0, 4)) {
    try {
      const a = await parseDaumArticle(link);
      if (a && a.title) out.push(a);
    } catch (e) { /* 개별 기사 실패 무시 */ }
    await sleep(250);
    if (out.length >= 3) break;
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

// ---------- 생성 이미지(SVG): 기사 키워드·제목 기반 ----------
function xmlEsc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function wrapLines(s, per, max) {
  const t = String(s || "").trim(); const lines = [];
  for (let i = 0; i < t.length && lines.length < max; i += per) lines.push(t.slice(i, i + per));
  if (lines.length === max && t.length > per * max) lines[max - 1] = lines[max - 1].slice(0, per - 1) + "…";
  return lines;
}
function buildGenSvg(keyword, title) {
  const pals = [["#123a2e", "#2f8f63"], ["#102a22", "#cd9b4c"], ["#164a3a", "#3b7fb0"], ["#14382c", "#ec9226"]];
  const h = Math.abs([...String(keyword || "x")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7));
  const [c0, c1] = pals[h % pals.length];
  const lines = wrapLines(title, 15, 3);
  const tspans = lines.map((l, i) => `<text x="48" y="${232 + i * 40}" font-family="'Pretendard','Malgun Gothic',sans-serif" font-size="30" font-weight="800" fill="#ffffff">${xmlEsc(l)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>
<rect width="600" height="400" fill="url(#g)"/>
<circle cx="500" cy="70" r="150" fill="#ffffff" opacity="0.06"/>
<circle cx="540" cy="120" r="90" fill="#ffffff" opacity="0.05"/>
<text x="48" y="70" font-family="sans-serif" font-size="15" letter-spacing="3" fill="#e9d9b4" opacity="0.9">UCC NEWSLETTER</text>
<rect x="46" y="96" rx="14" ry="14" width="${Math.min(360, 34 + (keyword || "").length * 26)}" height="34" fill="#ffffff" opacity="0.16"/>
<text x="62" y="119" font-family="'Pretendard','Malgun Gothic',sans-serif" font-size="18" font-weight="700" fill="#ffffff">#${xmlEsc(keyword)}</text>
${tspans}
<text x="48" y="372" font-family="'Pretendard','Malgun Gothic',sans-serif" font-size="14" fill="#ffffff" opacity="0.7">사단법인 도시공동체본부</text>
</svg>`;
}

// ---------- 1회 수집 ----------
async function collectOnce() {
  const useNaver = !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
  let inserted = 0, scanned = 0;
  const MAX_PER_KEYWORD = 2, MAX_TOTAL = 16;
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
      // 이미지 2컷: 기사 사진 우선, 부족분은 생성 이미지("gen" 표식 → SVG 라우트)
      const imgs = (it.images || []).filter(Boolean);
      const image1 = imgs[0] || "gen";
      const image2 = imgs[1] || "gen";
      const summary = (it.summary && it.summary.length >= 20)
        ? it.summary
        : `‘${kw}’ 관련 최신 보도입니다. 원문에서 자세한 내용을 확인하실 수 있습니다.${it.source ? " (출처: " + it.source + ")" : ""}`;
      try {
        const res = insertRow.run(
          it.title.slice(0, 300), summary.slice(0, 1000), it.source.slice(0, 100),
          it.url.slice(0, 500), kw, image1, image2, it.guid.slice(0, 400),
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
