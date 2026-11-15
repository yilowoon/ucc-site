/* translate.js — Gemini 기반 한국어 교정 + 한→영 번역 엔진
 *
 * 한국어 | ENGLISH 이원화의 변환 코어. 환경변수(globalnews 와 동일):
 *   GEMINI_API_KEY(필수) · GEMINI_TEXT_MODEL(선택) · GEMINI_BASE_URL(선택) · GEMINI_MIN_GAP_MS(선택)
 *
 * 설계 원칙:
 *  - 키 없음/호출 실패/빈 입력 → '원문 그대로' 반환(사이트 동작 보장, 절대 throw 하지 않음).
 *  - 무료 티어 보호: 전역 직렬 큐 + 최소 호출 간격 + 429/503 백오프 재시도(globalnews 패턴 재사용).
 *  - proofreadKo: '명백한 오타·맞춤법·띄어쓰기'만 교정(내용·문체 불변).
 *  - toEnglish/*: 자연스러운 영어. HTML 이면 태그 보존.
 */
"use strict";

const GEMINI_KEY = () => process.env.GEMINI_API_KEY || "";
const GEMINI_BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
const MODEL = () => process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite";
const MIN_GAP = Number(process.env.GEMINI_MIN_GAP_MS || 5000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasKorean = (s) => /[가-힣]/.test(String(s || ""));
const looksHtml = (s) => /<[a-z!/][\s\S]*>/i.test(String(s || ""));

// ── 전역 직렬 큐 + 최소 간격(무료 Gemini 분당 한도 보호) ──
let _chain = Promise.resolve();
let _last = 0;
function throttle(task) {
  const run = _chain.then(async () => {
    const wait = _last + MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await task(); } finally { _last = Date.now(); }
  });
  _chain = run.then(() => {}, () => {});
  return run;
}

/** 저수준 Gemini JSON 호출(429/503 백오프 재시도). 실패 시 null. */
async function callJson(prompt, { maxTokens = 8192, temperature = 0.2, ms = 90000 } = {}) {
  const key = GEMINI_KEY();
  if (!key) return null;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
  };
  const MAX = 4;
  for (let attempt = 0; attempt < MAX; attempt++) {
    const res = await throttle(async () => {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), ms);
      try {
        const r = await fetch(`${GEMINI_BASE()}/v1beta/models/${MODEL()}:generateContent?key=${encodeURIComponent(key)}`,
          { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { ok: r.ok, status: r.status, text: await r.text() };
      } catch (e) { return { status: 0, err: e.message }; }
      finally { clearTimeout(to); }
    });
    if (res.ok) {
      let data; try { data = JSON.parse(res.text); } catch { return null; }
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      const txt = (parts && parts.map((p) => p.text || "").join("")) || "";
      if (!txt) return null;
      try { return JSON.parse(txt); }
      catch { const m = txt.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } return null; }
    }
    if ((res.status === 429 || res.status === 503 || res.status === 0) && attempt < MAX - 1) {
      await sleep(Math.min(8000 * (attempt + 1), 45000));
      continue;
    }
    console.error("[translate] Gemini HTTP", res.status || "NET", (res.text || res.err || "").slice(0, 160));
    return null;
  }
  return null;
}

/** 한국어 오타/맞춤법/띄어쓰기만 교정. 반환 { text, changed }. */
async function proofreadKo(text) {
  const t = String(text == null ? "" : text);
  if (!t.trim() || !hasKorean(t) || !GEMINI_KEY()) return { text: t, changed: false };
  const prompt = [
    "다음 한국어 텍스트에서 '명백한 오타·맞춤법·띄어쓰기'만 교정하라.",
    "- 의미·문체·어조·내용을 바꾸지 말 것. 문장을 새로 쓰거나 요약·첨삭·윤문하지 말 것.",
    "- 문단 구분과 줄바꿈 구조를 그대로 유지할 것.",
    "- HTML 태그가 있으면 태그·속성은 그대로 두고 사람이 읽는 텍스트만 교정.",
    "- 교정할 것이 없으면 원문을 그대로 반환하고 changed=false.",
    '다음 JSON만 출력(설명 없이): { "corrected": "<교정문>", "changed": true|false }',
    "",
    "=== 원문 ===",
    t,
  ].join("\n");
  const j = await callJson(prompt, { temperature: 0.1 });
  const corrected = j && typeof j.corrected === "string" ? j.corrected : null;
  if (corrected == null) return { text: t, changed: false };
  return { text: corrected, changed: !!j.changed && corrected !== t };
}

/** 한국어 → 영어(단일 문자열). html:true 면 태그 보존. 실패 시 원문 반환. */
async function toEnglish(text, { html } = {}) {
  const t = String(text == null ? "" : text);
  if (!t.trim() || !GEMINI_KEY() || !hasKorean(t)) return t;
  const isHtml = html == null ? looksHtml(t) : html;
  const prompt = [
    "Translate the following Korean text into natural, professional English for a nonprofit organization's website.",
    "- Keep the meaning faithful; do not add, omit, or summarize.",
    "- Render 사단법인 도시공동체본부 as 'Urban Community Center (UCC)'. Keep phone numbers, emails, URLs, and dates as-is.",
    isHtml
      ? "- The text is HTML. Preserve ALL tags and attributes exactly; translate only the human-readable text between tags."
      : "- Return plain text and preserve line breaks exactly.",
    'Output JSON only: { "en": "<translation>" }',
    "",
    "=== SOURCE (Korean) ===",
    t,
  ].join("\n");
  const j = await callJson(prompt, { temperature: 0.2 });
  return j && typeof j.en === "string" && j.en.trim() ? j.en : t;
}

/** 여러 필드를 한 번의 호출로 번역. {key:text} → {key:en}. 한글 없는 필드는 원문 유지.
 *  호출 수 절감용(한 행 = 1콜). 실패/누락 필드는 원문으로 보존. */
async function toEnglishObject(fields) {
  const src = fields || {};
  const keys = Object.keys(src).filter((k) => String(src[k] == null ? "" : src[k]).trim() && hasKorean(src[k]));
  const out = { ...src };
  if (!keys.length || !GEMINI_KEY()) return out;
  const items = keys.map((k) => ({ key: k, html: looksHtml(src[k]), text: String(src[k]) }));
  const prompt = [
    "Translate each item's Korean text into natural, professional English for a nonprofit organization's website.",
    "- Keep meaning faithful; do not add/omit/summarize.",
    "- Render 사단법인 도시공동체본부 as 'Urban Community Center (UCC)'. Keep phones, emails, URLs, dates as-is.",
    "- For items with html:true, preserve ALL HTML tags/attributes and translate only visible text.",
    "- Preserve line breaks within each text.",
    'Output JSON only: { "items": [ { "key": "<key>", "en": "<translation>" } ] }',
    "",
    "=== ITEMS (JSON) ===",
    JSON.stringify(items),
  ].join("\n");
  const j = await callJson(prompt, { temperature: 0.2, maxTokens: 8192 });
  const arr = j && Array.isArray(j.items) ? j.items : null;
  if (!arr) return out;
  for (const it of arr) {
    if (it && typeof it.key === "string" && typeof it.en === "string" && it.en.trim() && keys.includes(it.key)) {
      out[it.key] = it.en;
    }
  }
  return out;
}

/** 긴 본문 번역: 출력 토큰 한도에 걸리지 않도록 문단(빈 줄) 경계로 쪼개 번역 후 재결합.
 *  짧으면 toEnglish 한 번. 실패한 청크는 원문 유지(부분 손실 최소화). */
async function toEnglishLong(text, { html, chunkChars = 3200 } = {}) {
  const t = String(text == null ? "" : text);
  if (!t.trim() || !GEMINI_KEY() || !hasKorean(t)) return t;
  if (t.length <= chunkChars) return toEnglish(t, { html });
  const paras = t.split(/\n{2,}/); // 문단 단위
  const chunks = [];
  let cur = "";
  for (const p of paras) {
    const cand = cur ? cur + "\n\n" + p : p;
    if (cand.length > chunkChars && cur) { chunks.push(cur); cur = p; }
    else cur = cand;
    // 단일 문단이 너무 길면 문장 단위로 추가 분할
    while (cur.length > chunkChars * 1.5) {
      const cut = cur.lastIndexOf(". ", chunkChars) + 1 || cur.lastIndexOf("다. ", chunkChars) + 2 || chunkChars;
      chunks.push(cur.slice(0, cut).trim());
      cur = cur.slice(cut);
    }
  }
  if (cur.trim()) chunks.push(cur);
  const out = [];
  for (const c of chunks) out.push(await toEnglish(c, { html }));
  return out.join("\n\n");
}

function hasGemini() { return !!GEMINI_KEY(); }

module.exports = { proofreadKo, toEnglish, toEnglishObject, toEnglishLong, hasGemini, hasKorean, looksHtml };
