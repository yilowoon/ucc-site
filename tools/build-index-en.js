/* tools/build-index-en.js — 정적 홈(public/index.html)의 영어판 생성 → public/index.en.html
 *
 * 한국어 | ENGLISH 이원화에서 홈 본문(마케팅 카피)을 Gemini로 번역한다.
 * 안전장치: <script>·<style>·<!--주석-->·플레이스홀더(__X__)는 번역하지 않고,
 *   '태그 사이 텍스트 노드'와 일부 속성(alt/title/aria-label/placeholder/content)만 번역.
 * 홈 수정 시 다시 실행: node tools/build-index-en.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {}

const translate = require("../src/translate");

const SRC = path.join(__dirname, "..", "public", "index.html");
const OUT = path.join(__dirname, "..", "public", "index.en.html");
const hasKorean = (s) => /[가-힣]/.test(String(s || ""));

async function run() {
  if (!translate.hasGemini()) { console.error("⚠ GEMINI_API_KEY 없음 — 중단."); process.exit(1); }
  let html = fs.readFileSync(SRC, "utf8");

  // 1) 번역 금지 영역(스크립트/스타일/주석)을 플레이스홀더로 치환해 보호
  const vault = [];
  const stash = (re) => { html = html.replace(re, (m) => { vault.push(m); return `\u0000${vault.length - 1}\u0000`; }); };
  stash(/<script[\s\S]*?<\/script>/gi);
  stash(/<style[\s\S]*?<\/style>/gi);
  stash(/<!--[\s\S]*?-->/g);

  // 2) 번역 대상 문자열 수집(한글 포함). 중복 제거 → 키 부여.
  const uniq = new Map(); // ko -> key
  const keyOf = (ko) => { if (!uniq.has(ko)) uniq.set(ko, "s" + uniq.size); return uniq.get(ko); };

  // 2a) 태그 사이 텍스트 노드
  html = html.replace(/>([^<>]+)</g, (m, txt) => {
    if (!hasKorean(txt)) return m;
    const lead = txt.match(/^\s*/)[0], trail = txt.match(/\s*$/)[0], core = txt.trim();
    return ">" + lead + "\u0001" + keyOf(core) + "\u0001" + trail + "<";
  });
  // 2b) 선택 속성 값
  html = html.replace(/\b(alt|title|aria-label|placeholder|content)="([^"]*)"/gi, (m, attr, val) => {
    if (!hasKorean(val)) return m;
    return `${attr}="\u0001${keyOf(val.trim())}\u0001"`;
  });

  const kos = [...uniq.keys()];
  console.log(`번역 대상 고유 문자열 ${kos.length}개 — 배치 번역 시작…`);

  // 3) 배치 번역(한 호출에 ~25개)
  const enMap = {};
  const CHUNK = 25;
  for (let i = 0; i < kos.length; i += CHUNK) {
    const slice = kos.slice(i, i + CHUNK);
    const obj = {};
    slice.forEach((ko) => { obj[uniq.get(ko)] = ko; });
    const res = await translate.toEnglishObject(obj);
    slice.forEach((ko) => { const k = uniq.get(ko); enMap[k] = res[k] && res[k] !== ko ? res[k] : ko; });
    console.log(`  · ${Math.min(i + CHUNK, kos.length)}/${kos.length}`);
  }

  // 4) 치환 복원: 키 → 영어
  html = html.replace(/\u0001(s\d+)\u0001/g, (m, k) => enMap[k] != null ? enMap[k] : m);
  // 5) 보호 영역 복원
  html = html.replace(/\u0000(\d+)\u0000/g, (m, n) => vault[Number(n)]);
  // 6) lang 속성
  html = html.replace(/<html[^>]*lang="[^"]*"/i, '<html lang="en"');

  fs.writeFileSync(OUT, html, "utf8");
  console.log(`✅ 생성: ${OUT} (${html.length} bytes)`);
  process.exit(0);
}
run().catch((e) => { console.error("오류:", e); process.exit(1); });
