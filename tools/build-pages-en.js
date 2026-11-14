/* tools/build-pages-en.js — 정적 소개/프로젝트/배움터 페이지(src/pages.js)의 영어 번역 생성
 * → src/pages-en.json  ({ slug: { title, html } })
 * renderPage(site.js)가 lang=en 일 때 이 파일을 덮어쓴다. pages.js 수정 시 다시 실행.
 *   node tools/build-pages-en.js            # 비어있는 것만
 *   node tools/build-pages-en.js --force    # 전부 다시
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
const { PAGES } = require("../src/pages");

const OUT = path.join(__dirname, "..", "src", "pages-en.json");
const FORCE = process.argv.includes("--force");
const hasKorean = (s) => /[가-힣]/.test(String(s || ""));

async function run() {
  if (!translate.hasGemini()) { console.error("⚠ GEMINI_API_KEY 없음 — 중단."); process.exit(1); }
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { existing = {}; }

  const slugs = Object.keys(PAGES);
  let done = 0;
  for (const slug of slugs) {
    const p = PAGES[slug];
    if (!p || !p.html) continue;
    if (!FORCE && existing[slug] && existing[slug].html) continue; // 이미 번역됨
    const out = { ...(existing[slug] || {}) };
    if (hasKorean(p.title)) out.title = await translate.toEnglish(p.title, { html: false });
    if (hasKorean(p.html)) out.html = await translate.toEnglish(p.html, { html: true });
    existing[slug] = out;
    fs.writeFileSync(OUT, JSON.stringify(existing, null, 2), "utf8"); // 중간 저장(중단 대비)
    done++;
    console.log(`  · ${slug} (${(out.html || "").length} chars)`);
  }
  console.log(`\n✅ ${done}개 페이지 번역 → ${OUT}`);
  process.exit(0);
}
run().catch((e) => { console.error("오류:", e); process.exit(1); });
