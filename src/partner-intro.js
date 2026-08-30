/* partner-intro.js — 임원사 '회사소개'를 입력값 기반으로 자동 생성.
 * Gemini(GEMINI_API_KEY) 사용 가능하면 AI로, 없으면 템플릿으로 생성.
 * 규칙: 200자 내외 + 반드시 완결된 문장으로 종결.
 */
"use strict";

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const GEMINI_TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || "gemini-2.0-flash";

const TARGET = 200;   // 목표 글자수
const HARD_MAX = 230; // 이보다 길면 마지막 완결 문장 기준으로 자름

// 마지막 문장 종결부호(…다. …요. .)를 기준으로 max 이내로 자르고, 완결을 보장
function trimToSentence(text, max = HARD_MAX) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  // 감싸는 따옴표 제거
  t = t.replace(/^["'「『]\s*/, "").replace(/\s*["'」』]$/, "");
  if (Array.from(t).length <= max) return ensureEnding(t);
  const arr = Array.from(t);
  const head = arr.slice(0, max).join("");
  // max 이내에서 마지막 종결(다./요./.) 위치까지 사용
  const m = head.match(/^[\s\S]*(?:다\.|요\.|\.)/);
  if (m && Array.from(m[0]).length >= 60) return m[0].trim();
  // 못 찾으면 max 근처에서 자르고 마침표 부여
  return ensureEnding(head.replace(/[\s,·]+$/, ""));
}

function ensureEnding(t) {
  t = t.trim();
  if (!t) return t;
  if (/[.!?。]$/.test(t)) return t;
  if (/(다|요)$/.test(t)) return t + ".";
  return t + ".";
}

// 입력값으로 프롬프트 구성
function buildPrompt(f) {
  const lines = [
    "다음 기업 정보를 바탕으로 한국어 '회사소개' 문단을 작성하라.",
    "",
    "[기업 정보]",
    `- 기업명: ${f.name || ""}`,
    f.ceo ? `- 대표이사: ${f.ceo}` : "",
    f.field ? `- 주요사업분야: ${f.field}` : "",
    f.url ? `- 홈페이지: ${f.url}` : "",
    f.memo ? `- 사업 개요/참고: ${f.memo}` : "",
    "",
    "[작성 규칙]",
    "1) 전체 200자 내외(180~210자)로 간결하게.",
    "2) 반드시 완결된 문장으로 끝낼 것(…입니다. / …합니다. 등). 문장 중간에 끊지 말 것.",
    "3) 입력 정보에 근거해 논리적·체계적으로 정리하고, 과장·허위·추측성 수치는 쓰지 말 것.",
    "4) 마지막 문장은 '사단법인 도시공동체본부'(지역공동체·도시재생·마을공동체·시민교육 사업)와의 협업 가능성으로 자연스럽게 마무리.",
    "5) 따옴표·머리기호·목록 없이 순수 본문만 출력.",
  ].filter(Boolean);
  return lines.join("\n");
}

async function geminiText(prompt, { ms = 30000 } = {}) {
  const key = GEMINI_KEY();
  if (!key) return null;
  const url = `${GEMINI_BASE()}/v1beta/models/${GEMINI_TEXT_MODEL()}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) { console.error("[partner-intro] Gemini HTTP", r.status, t.slice(0, 160)); return null; }
    let data; try { data = JSON.parse(t); } catch { return null; }
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const txt = (parts && parts.map((p) => p.text || "").join("")) || "";
    return txt || null;
  } catch (e) {
    console.error("[partner-intro] Gemini 호출 오류:", e.message);
    return null;
  } finally { clearTimeout(to); }
}

// 템플릿 폴백(Gemini 미사용 시)
function templateIntro(f) {
  const name = f.name || "본 기업";
  const parts = [];
  if (f.field) parts.push(`${name}는 ${f.field} 분야의 기업입니다.`);
  else parts.push(`${name}에 대한 소개입니다.`);
  if (f.memo) parts.push(ensureEnding(String(f.memo).replace(/\s+/g, " ").trim()));
  parts.push("사단법인 도시공동체본부의 지역공동체·시민교육 사업과 협력할 수 있습니다.");
  return trimToSentence(parts.join(" "));
}

// 회사소개 자동 생성 (Promise<string>)
async function generateIntro(fields) {
  const f = fields || {};
  try {
    const raw = await geminiText(buildPrompt(f));
    if (raw && raw.trim()) return trimToSentence(raw);
  } catch (e) { /* fall through */ }
  return templateIntro(f);
}

module.exports = { generateIntro, trimToSentence, ensureEnding, TARGET };
