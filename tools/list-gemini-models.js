/*
 * 현재 GEMINI_API_KEY 로 사용 가능한 모델 목록을 조회한다(generateContent 지원 모델 우선).
 * 무료 할당량이 큰 모델을 골라 .env 의 GEMINI_TEXT_MODEL 에 지정하는 데 사용.
 *
 * 사용법(서버 ~/ucc-site 에서):
 *   node tools/list-gemini-models.js
 *
 * 키는 화면에 출력하지 않는다(보안).
 */
"use strict";

const fs = require("fs");
const path = require("path");

// .env 최소 파서(따옴표 제거) — 앱 로더와 동일 취지
function loadEnv() {
  const p = path.join(__dirname, "..", ".env");
  try {
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch (e) {}
}

(async () => {
  loadEnv();
  const key = process.env.GEMINI_API_KEY || "";
  const base = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  if (!key) { console.error("GEMINI_API_KEY 가 .env 에 없습니다."); process.exit(1); }

  const r = await fetch(`${base}/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`);
  if (!r.ok) { console.error("모델 조회 실패:", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
  const d = await r.json();
  const models = (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => ({
      name: String(m.name || "").replace(/^models\//, ""),
      inTok: m.inputTokenLimit || 0,
      outTok: m.outputTokenLimit || 0,
    }));

  // flash/lite 계열(무료 할당량 큰 편)을 위로 정렬
  const score = (n) => (/lite/i.test(n) ? 0 : /flash/i.test(n) ? 1 : /pro/i.test(n) ? 3 : 2);
  models.sort((a, b) => score(a.name) - score(b.name) || a.name.localeCompare(b.name));

  console.log(`\n생성(generateContent) 가능 모델 ${models.length}종:\n` + "─".repeat(64));
  for (const m of models) {
    const tag = /lite/i.test(m.name) ? " ← 무료 할당량 큰 편(추천)" : (/flash/i.test(m.name) ? " ← 품질/속도 균형" : "");
    console.log(`${m.name.padEnd(34)} in:${m.inTok} out:${m.outTok}${tag}`);
  }
  console.log("─".repeat(64));
  console.log("고정하려면 .env 에 아래처럼 추가 후 'pm2 restart ucc':");
  console.log("  GEMINI_TEXT_MODEL=<위 목록에서 선택>");
  console.log("무료 할당량이 부족하면 'lite' 계열을, 품질을 우선하면 일반 'flash' 계열을 권장합니다.\n");
})();
