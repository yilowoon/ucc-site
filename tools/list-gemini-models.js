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
  let models = (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => String(m.name || "").replace(/^models\//, ""));

  // 프리뷰/특수 목적 모델은 집필용으로 부적합 → 제외
  const bad = /(vision|thinking|exp|image|tts|live|audio|embedding|aqa|learnlm)/i;
  models = models.filter((n) => !bad.test(n));

  // flash/lite(무료 할당량 큰 편) 우선 정렬
  const score = (n) => (/lite/i.test(n) ? 0 : /flash/i.test(n) ? 1 : /pro/i.test(n) ? 3 : 2);
  models.sort((a, b) => score(a.name || a) - score(b.name || b) || String(a).localeCompare(String(b)));

  // 실제 호출로 사용 가능 여부 확인(1토큰) — 목록에 있어도 404(폐기)일 수 있으므로 직접 확인
  console.log(`\n생성 가능 모델 ${models.length}종 — 실제 호출로 확인 중...\n` + "─".repeat(72));
  const usable = [];
  for (const name of models) {
    let status = 0, note = "";
    try {
      const rr = await fetch(`${base}/v1beta/models/${name}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }], generationConfig: { maxOutputTokens: 1 } }),
      });
      status = rr.status;
      if (!rr.ok) { const t = await rr.text(); note = (JSON.parse(t).error?.message || t).slice(0, 80); }
    } catch (e) { note = e.message; }
    const mark = status === 200 ? "✅ 사용가능"
      : status === 429 ? "⏳ 429(할당량/속도 — 모델은 유효)"
      : status === 404 ? "❌ 404(폐기/미제공)"
      : `⚠ ${status || "NET"}`;
    if (status === 200 || status === 429) usable.push(name);
    console.log(`${String(name).padEnd(32)} ${mark}${note ? " — " + note : ""}`);
    await new Promise((r) => setTimeout(r, 400)); // 과도한 호출 방지
  }
  console.log("─".repeat(72));
  if (usable.length) {
    const rec = usable.find((n) => /lite/i.test(n)) || usable.find((n) => /flash/i.test(n)) || usable[0];
    console.log(`추천(사용가능 + 무료 할당량 유리): ${rec}`);
    console.log("고정: .env 에 아래 추가 후 'pm2 restart ucc'");
    console.log(`  GEMINI_TEXT_MODEL=${rec}`);
  } else {
    console.log("사용 가능한(200/429) 모델이 없습니다. 키/프로젝트 설정을 확인하세요.");
  }
  console.log("");
})();
