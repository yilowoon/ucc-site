/* 뉴스레터 자동 수집: 사회적경제 등 키워드 뉴스 큐레이션
 * - 기본: Google 뉴스 RSS(키 불필요) — 제목·출처·링크·날짜
 * - 선택: NAVER_CLIENT_ID/SECRET 환경변수가 있으면 네이버 뉴스 API 사용
 *   (실제 요약 스니펫 + 원문 og:image 확보)
 * - 이미지: 원문 og:image(가능 시) + 부족분은 브랜드 주제 이미지로 보완해 항상 2컷
 * - 저작권: 원문 전문을 저장하지 않고 제목+요약 발췌+출처 링크만 저장(큐레이션)
 */
"use strict";

const { db } = require("./db");

const KEYWORDS = [
  "사회적경제", "사회연대경제", "마을기업", "협동조합",
  "자활기업", "사회적기업", "소셜벤처", "혁신생태계",
];

const THEME_POOL = Array.from({ length: 8 }, (_, i) => `/img/newsletter/nl-${String(i + 1).padStart(2, "0")}.jpg`);

const insertRow = db.prepare(
  "INSERT OR IGNORE INTO newsletter (title, summary, source, url, keyword, image1, image2, guid, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);
const existsGuid = db.prepare("SELECT 1 FROM newsletter WHERE guid = ?");

// ---------- 유틸 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function decodeEntities(s) {
  let x = String(s || "");
  const once = (v) => v
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch (e) { return m; } })
    .replace(/&amp;/g, "&");
  x = once(x); x = once(x); // 이중 인코딩(&amp;#39; 등) 대응
  return x;
}
function hashInt(s) { let h = 0; const str = String(s); for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; } return Math.abs(h); }
function themePair(seed) {
  const h = hashInt(seed);
  const a = h % THEME_POOL.length;
  let b = (h >> 3) % THEME_POOL.length;
  if (b === a) b = (a + 1) % THEME_POOL.length;
  return [THEME_POOL[a], THEME_POOL[b]];
}
async function fetchText(url, ms = 10000, headers = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; UCCNewsletter/1.0)", ...headers } });
    return { status: r.status, text: await r.text(), url: r.url };
  } finally { clearTimeout(to); }
}
async function ogImage(url) {
  try {
    const { text: h } = await fetchText(url, 8000, { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    const m =
      h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) ||
      h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      h.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i);
    // Google 뉴스 로고/추적 이미지는 실제 기사 이미지가 아니므로 제외
    if (m && /^https?:\/\//.test(m[1]) && !/googleusercontent\.com|news\.google\.com|gstatic|\/rss\//.test(m[1])) {
      return m[1].slice(0, 500);
    }
  } catch (e) { /* 무시 */ }
  return "";
}

// ---------- 소스: 네이버 뉴스 API (키 있을 때) ----------
async function fromNaver(keyword) {
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;
  const url = "https://openapi.naver.com/v1/search/news.json?display=5&sort=date&query=" + encodeURIComponent(keyword);
  const { text } = await fetchText(url, 10000, { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret });
  let data; try { data = JSON.parse(text); } catch (e) { return []; }
  return (data.items || []).map((it) => ({
    title: decodeEntities(stripTags(it.title)),
    summary: decodeEntities(stripTags(it.description)),
    source: (() => { try { return new URL(it.originallink || it.link).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })(),
    url: it.originallink || it.link,
    link: it.originallink || it.link,          // og:image 추출용
    guid: (it.originallink || it.link || "").split("?")[0],
    published_at: it.pubDate ? new Date(it.pubDate).toISOString() : "",
  }));
}

// ---------- 소스: Google 뉴스 RSS (기본) ----------
async function fromGoogle(keyword) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(keyword) + "&hl=ko&gl=KR&ceid=KR:ko";
  const { text } = await fetchText(url, 10000);
  const items = text.split("<item>").slice(1);
  const out = [];
  for (const it of items.slice(0, 5)) {
    const g = (re) => { const m = it.match(re); return m ? m[1] : ""; };
    let title = decodeEntities(stripTags(g(/<title>([\s\S]*?)<\/title>/)));
    const source = decodeEntities(stripTags(g(/<source[^>]*>([\s\S]*?)<\/source>/)));
    const link = decodeEntities(g(/<link>([\s\S]*?)<\/link>/).trim());
    const pub = g(/<pubDate>([\s\S]*?)<\/pubDate>/);
    // "제목 - 언론사" 형태에서 언론사 접미어 제거
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)).trim();
    const token = (link.split("/articles/")[1] || link).split("?")[0];
    out.push({
      title, summary: "", source, url: link, link,
      guid: token || link,
      published_at: pub ? new Date(pub).toISOString() : "",
    });
  }
  return out;
}

// ---------- 1회 수집 ----------
async function collectOnce() {
  const useNaver = !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
  let inserted = 0, scanned = 0;
  const MAX_PER_KEYWORD = 3, MAX_TOTAL = 24;
  for (const kw of KEYWORDS) {
    if (inserted >= MAX_TOTAL) break;
    let items = [];
    try { items = (useNaver ? await fromNaver(kw) : await fromGoogle(kw)) || []; }
    catch (e) { console.error("[newsletter] fetch 실패:", kw, e.message); continue; }
    let perKw = 0;
    for (const it of items) {
      if (perKw >= MAX_PER_KEYWORD || inserted >= MAX_TOTAL) break;
      scanned++;
      if (!it.title || !it.guid) continue;
      if (existsGuid.get(it.guid)) continue;
      // 이미지: 실제 기사(네이버 원문 등)면 og:image 추출, Google 링크는 로고만 나오므로 생략.
      // 부족분은 브랜드 주제 이미지로 보완 → 항상 2컷 보장.
      const [t1, t2] = themePair(it.guid);
      let image1 = "", image2 = t2;      // 두 번째는 항상 주제 이미지
      const realArticle = it.link && !/news\.google\.com/.test(it.link);
      if (realArticle) { try { image1 = await ogImage(it.link); } catch (e) {} }
      image1 = image1 || t1;             // 대표 이미지(있으면 원문, 없으면 주제)
      if (image2 === image1) image2 = t1;
      const summary = it.summary || `‘${kw}’ 관련 최신 보도입니다. 원문에서 자세한 내용을 확인하실 수 있습니다.${it.source ? " (출처: " + it.source + ")" : ""}`;
      try {
        const res = insertRow.run(
          it.title.slice(0, 300), summary.slice(0, 1000), it.source.slice(0, 100),
          it.url.slice(0, 500), kw, image1, image2, it.guid.slice(0, 400),
          it.published_at || new Date().toISOString(), new Date().toISOString()
        );
        if (res.changes > 0) { inserted++; perKw++; }
      } catch (e) { /* 중복 등 무시 */ }
      await sleep(200); // 예의상 간격
    }
    await sleep(300);
  }
  console.log(`[newsletter] 수집 완료: 신규 ${inserted}건 (검토 ${scanned}건, 소스 ${useNaver ? "Naver" : "Google"})`);
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
  // 최초 실행: DB가 비어 있으면 1분 뒤 1회 수집(서버 기동 직후 부하 회피)
  const count = db.prepare("SELECT COUNT(*) AS n FROM newsletter").get().n;
  if (count === 0) setTimeout(() => { collectOnce().catch(() => {}); }, 60 * 1000);
  setTimeout(run, msUntilNext([8, 18]));
  const next = new Date(Date.now() + msUntilNext([8, 18]));
  console.log(`[newsletter] 스케줄러 시작 — 다음 수집: ${next.toLocaleString()}`);
}

module.exports = { collectOnce, startScheduler, KEYWORDS };
