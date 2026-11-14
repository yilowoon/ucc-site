/* tools/build-ui-dict.js — 공개 뷰(EJS)의 '고정 한글 UI 문구'를 추출·번역 → src/i18n-generated.json
 *
 * 영어 사이트(/en)는 렌더 HTML에서 이 사전으로 한글을 영어로 치환한다(i18n.js translateHtml).
 * EJS 식(<% %>)이 섞인 조각은 건너뛰어(부분 깨짐 방지) '순수 리터럴 한글'만 번역한다.
 *   node tools/build-ui-dict.js            # 새 문구만
 *   node tools/build-ui-dict.js --force    # 전부 다시
 * 관리자 전용(admin-*.ejs)은 제외(영어 대상 아님).
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

const VIEWS = path.join(__dirname, "..", "views");
const OUT = path.join(__dirname, "..", "src", "i18n-generated.json");
const FORCE = process.argv.includes("--force");
const hasKorean = (s) => /[가-힣]/.test(String(s || ""));

// 대상 파일: views/*.ejs(관리자 제외) + views/partials/*.ejs(관리자 제외)
function listViews() {
  const files = [];
  for (const dir of [VIEWS, path.join(VIEWS, "partials")]) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".ejs")) continue;
      if (/^admin[-.]/.test(f)) continue;       // 관리자 화면 제외
      files.push(path.join(dir, f));
    }
  }
  return files;
}

// UI 라벨로 보기 어려운(코드·블록성) 조각 배제
function looksLikeCode(t) {
  if (t.length > 300) return true;                 // UI 라벨/짧은 문장만
  if (/[{};]/.test(t)) return true;                // CSS/JS 조각
  if (/\/\*|\*\/|=>|function\s|var\s|const\s|let\s/.test(t)) return true;
  if (/^[\s0-9.,%:\/\-]+$/.test(t)) return true;   // 숫자/기호만
  return false;
}

// 한 파일에서 '순수 리터럴 한글' 문구 추출(텍스트 노드 + 일부 속성)
function extract(htmlRaw, set) {
  // 번역 금지 영역 제거: <script>·<style>·주석 (CSS/JS 가 텍스트로 섞이는 것 방지)
  const html = String(htmlRaw)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // 텍스트 노드: >...< 사이. EJS 식(<%) 이 들어간 조각은 제외.
  const reText = />([^<>]+)</g;
  let m;
  while ((m = reText.exec(html))) {
    const raw = m[1];
    if (raw.indexOf("<%") >= 0 || raw.indexOf("%>") >= 0) continue;
    const t = raw.replace(/\s+/g, " ").trim();
    if (t.length >= 2 && hasKorean(t) && !looksLikeCode(t)) set.add(t);
  }
  // 속성값: placeholder/alt/title/aria-label
  const reAttr = /\b(?:placeholder|alt|title|aria-label)="([^"]*)"/gi;
  while ((m = reAttr.exec(html))) {
    const v = m[1];
    if (v.indexOf("<%") >= 0) continue;
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length >= 2 && hasKorean(t) && !looksLikeCode(t)) set.add(t);
  }
}

async function run() {
  if (!translate.hasGemini()) { console.error("⚠ GEMINI_API_KEY 없음 — 중단."); process.exit(1); }
  let dict = {};
  try { dict = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) { dict = {}; }

  const set = new Set();
  for (const file of listViews()) extract(fs.readFileSync(file, "utf8"), set);
  let kos = [...set];
  if (!FORCE) kos = kos.filter((k) => !dict[k]); // 이미 번역된 건 건너뜀
  console.log(`추출 고유 한글 문구 ${set.size}개 · 번역 대상 ${kos.length}개`);

  const CHUNK = 20;
  let done = 0;
  for (let i = 0; i < kos.length; i += CHUNK) {
    const slice = kos.slice(i, i + CHUNK);
    const obj = {}; slice.forEach((ko, j) => { obj["k" + j] = ko; });
    const en = await translate.toEnglishObject(obj);
    slice.forEach((ko, j) => { const v = en["k" + j]; if (v && v !== ko) { dict[ko] = v; done++; } });
    fs.writeFileSync(OUT, JSON.stringify(dict, null, 2), "utf8"); // 중간 저장
    console.log(`  · ${Math.min(i + CHUNK, kos.length)}/${kos.length}`);
  }
  console.log(`\n✅ ${done}개 번역 반영 → ${OUT} (총 ${Object.keys(dict).length}개)`);
  process.exit(0);
}
run().catch((e) => { console.error("오류:", e); process.exit(1); });
