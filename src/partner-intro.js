/* partner-intro.js — 임원사 '회사소개'를 입력값 + 인터넷 검색 정보 기반으로 자동 생성.
 * 수집: 기업 홈페이지 본문 + 네이버 검색(webkr/encyc/blog) + Gemini 구글검색 그라운딩.
 * 규칙: 200자 내외(180~220자) + 반드시 완결된 문장으로 종결.
 */
"use strict";

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const GEMINI_TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || "gemini-2.0-flash";
const UA = "Mozilla/5.0 (compatible; UCCBot/1.0)";

const TARGET = 200;
const HARD_MAX = 230;

/* ---------------- 유틸 ---------------- */
function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => { try { return String.fromCodePoint(+n); } catch { return m; } })
    .replace(/&amp;/g, "&");
}
function stripTags(h) {
  return String(h || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}
function metaTag(h, prop) {
  const m =
    h.match(new RegExp('<meta[^>]+property=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)', "i")) ||
    h.match(new RegExp('<meta[^>]+name=["\']' + prop + '["\'][^>]+content=["\']([^"\']*)', "i"));
  return m ? decodeEntities(m[1]).trim() : "";
}
async function fetchText(url, ms = 8000, headers = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": UA, "Accept-Language": "ko", ...headers } });
    return { status: r.status, text: await r.text() };
  } finally { clearTimeout(to); }
}

function trimToSentence(text, max = HARD_MAX) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^["'「『]\s*/, "").replace(/\s*["'」』]$/, "");
  if (Array.from(t).length <= max) return ensureEnding(t);
  const head = Array.from(t).slice(0, max).join("");
  const m = head.match(/^[\s\S]*(?:다\.|요\.|\.)/);
  if (m && Array.from(m[0]).length >= 120) return m[0].trim();
  return ensureEnding(head.replace(/[\s,·]+$/, ""));
}
function ensureEnding(t) {
  t = String(t || "").trim();
  if (!t) return t;
  if (/[.!?。]$/.test(t)) return t;
  return t + ".";
}

/* ---------------- 인터넷 정보 수집 ---------------- */
async function naverSearch(query) {
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return [];
  const out = [];
  for (const ep of ["webkr", "encyc", "blog"]) {
    try {
      const url = `https://openapi.naver.com/v1/search/${ep}.json?display=5&query=` + encodeURIComponent(query);
      const { text } = await fetchText(url, 8000, { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret });
      const data = JSON.parse(text);
      (data.items || []).forEach((it) => {
        const line = (stripTags(decodeEntities(it.title || "")) + " — " + stripTags(decodeEntities(it.description || ""))).trim();
        if (line.length > 5) out.push(line);
      });
    } catch (e) { /* skip */ }
  }
  return out;
}
async function siteText(url) {
  if (!url) return "";
  let u = url.trim();
  if (!/^https?:/i.test(u)) u = "https://" + u;
  try {
    const { text: h } = await fetchText(u, 8000);
    const title = metaTag(h, "og:title");
    const desc = metaTag(h, "og:description") || metaTag(h, "description");
    const body = stripTags(h).slice(0, 1500);
    return [title, desc, body].filter(Boolean).join(" ").slice(0, 1800);
  } catch (e) { return ""; }
}
async function gatherWebContext(f) {
  const q = [f.name, f.field].filter(Boolean).join(" ");
  const [site, nav] = await Promise.all([siteText(f.url), naverSearch(q || f.name)]);
  const blocks = [];
  if (site) blocks.push("[기업 홈페이지]\n" + site);
  if (nav.length) blocks.push("[웹 검색 결과]\n" + nav.slice(0, 10).join("\n"));
  return blocks.join("\n\n").slice(0, 4000);
}

/* ---------------- 프롬프트 ---------------- */
function buildPrompt(f, webctx) {
  return [
    "너는 기업 소개문을 작성하는 홍보 담당자다. 아래 정보를 종합해 한국어 '회사소개' 한 문단을 작성하라.",
    "",
    "[기업 정보]",
    `- 기업명: ${f.name || ""}`,
    f.ceo ? `- 대표이사: ${f.ceo}` : "",
    f.field ? `- 주요사업분야: ${f.field}` : "",
    f.url ? `- 홈페이지: ${f.url}` : "",
    f.memo ? `- 참고 메모: ${f.memo}` : "",
    "",
    "[수집 정보(인터넷)]",
    webctx || "(수집된 외부 정보가 부족하다. 기업명·사업분야에 근거해 신중히 작성하고, 확인되지 않은 사실은 쓰지 마라.)",
    "",
    "[작성 규칙]",
    "1) 분량은 공백 포함 한국어 180~220자(약 200자). 너무 짧게 쓰지 말고 이 분량을 반드시 지킬 것.",
    "2) 반드시 완결된 문장으로 끝낼 것(…입니다. / …합니다.). 문장 중간에서 끊지 말 것.",
    "3) 수집 정보에서 사업내용·주요 제품/서비스·강점을 뽑아 논리적·체계적으로 정리할 것. 확인되지 않은 수치·수상·거래처는 단정하지 말 것.",
    "4) 마지막 문장은 '사단법인 도시공동체본부'(지역공동체·도시재생·마을공동체·시민교육 사업)와의 협업 가능성으로 자연스럽게 마무리할 것.",
    "5) 따옴표·머리기호·목록·제목 없이 순수 본문만 출력할 것.",
  ].filter((x) => x !== "").join("\n");
}

async function geminiText(prompt, { ms = 45000, useSearch = true } = {}) {
  const key = GEMINI_KEY();
  if (!key) return null;
  const url = `${GEMINI_BASE()}/v1beta/models/${GEMINI_TEXT_MODEL()}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.45, maxOutputTokens: 800 },
  };
  if (useSearch) body.tools = [{ google_search: {} }]; // 인터넷 검색 그라운딩
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) {
      console.error("[partner-intro] Gemini HTTP", r.status, t.slice(0, 160));
      if (useSearch) return geminiText(prompt, { ms, useSearch: false }); // 그라운딩 미지원 시 재시도
      return null;
    }
    let data; try { data = JSON.parse(t); } catch { return null; }
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const txt = (parts && parts.map((p) => p.text || "").join("")) || "";
    return txt || null;
  } catch (e) {
    console.error("[partner-intro] Gemini 호출 오류:", e.message);
    if (useSearch) { try { return await geminiText(prompt, { ms, useSearch: false }); } catch { return null; } }
    return null;
  } finally { clearTimeout(to); }
}

/* ---------------- 템플릿 폴백 ---------------- */
function templateIntro(f, webctx) {
  const name = f.name || "본 기업";
  const parts = [];
  if (f.field) parts.push(`${name}는 ${f.field} 분야의 기업입니다.`);
  else parts.push(`${name}에 대한 소개입니다.`);
  if (f.memo) parts.push(ensureEnding(String(f.memo).replace(/\s+/g, " ").trim()));
  else if (webctx) parts.push(ensureEnding(webctx.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90)));
  parts.push("사단법인 도시공동체본부의 지역공동체·도시재생·시민교육 사업과 협력할 수 있습니다.");
  return trimToSentence(parts.join(" "));
}

/* ---------------- 공개 API ---------------- */
async function generateIntro(fields) {
  const f = fields || {};
  let webctx = "";
  try { webctx = await gatherWebContext(f); } catch (e) { /* ignore */ }
  try {
    const raw = await geminiText(buildPrompt(f, webctx));
    if (raw && raw.trim()) return trimToSentence(raw);
  } catch (e) { /* fall through */ }
  return templateIntro(f, webctx);
}

module.exports = { generateIntro, trimToSentence, ensureEnding, gatherWebContext, TARGET };
