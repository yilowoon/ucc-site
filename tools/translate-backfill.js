/* tools/translate-backfill.js — 기존 DB 콘텐츠의 영어 번역본(_en) 일괄 생성
 *
 * 한국어 | ENGLISH 이원화 최초 1회(및 누락분) 백필. 기존 한글 원문은 '건드리지 않고'
 * 영문 컬럼(_en)만 채운다(오타 교정은 신규 작성분에만 적용 — 기존 게시물 보존).
 *
 * 사용(서버 루트에서):
 *   node tools/translate-backfill.js            # _en 비어있는 행만 번역
 *   node tools/translate-backfill.js --force    # 이미 번역된 것도 다시 번역
 *   node tools/translate-backfill.js --only posts,newsletter
 *
 * 필요: .env 의 GEMINI_API_KEY. (느림 — 무료 Gemini 보호용 호출 간격 때문에 행당 수 초)
 */
"use strict";

const fs = require("fs");
const path = require("path");

// .env 로드(server.js 와 동일 방식; 이미 설정된 환경변수 우선)
try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) { /* .env 없으면 환경변수로 */ }

const { db } = require("../src/db");       // _en 컬럼 보장(마이그레이션 포함)
const translate = require("../src/translate");

const FORCE = process.argv.includes("--force");
const onlyArg = (() => { const i = process.argv.indexOf("--only"); return i >= 0 ? (process.argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean) : null; })();

// 긴 본문 필드(출력 토큰 한도에 걸리므로 쪼개 번역)
const LONG_FIELDS = new Set(["content", "body"]);
// 테이블별 (한글필드 → 영문필드) 매핑
const JOBS = {
  posts:      { id: "id", map: { title: "title_en", content: "content_en" } },
  newsletter: { id: "id", map: { title: "title_en", summary: "summary_en", content: "content_en" } },
  columns:    { id: "id", map: { title: "title_en", subtitle: "subtitle_en", lede: "lede_en", body: "body_en", author_title: "author_title_en" } },
  partners:   { id: "id", map: { name: "name_en", field: "field_en", intro: "intro_en" } },
};

async function run() {
  if (!translate.hasGemini()) {
    console.error("⚠ GEMINI_API_KEY 없음 — 번역 불가. .env 확인 후 다시 실행하세요.");
    process.exit(1);
  }
  const tables = onlyArg || Object.keys(JOBS);
  let totalRows = 0, totalDone = 0;

  for (const tbl of tables) {
    const job = JOBS[tbl];
    if (!job) { console.warn(`(건너뜀) 알 수 없는 테이블: ${tbl}`); continue; }
    const srcFields = Object.keys(job.map);
    const cols = [job.id, ...srcFields, ...Object.values(job.map)].join(", ");
    let rows;
    try { rows = db.prepare(`SELECT ${cols} FROM ${tbl} ORDER BY ${job.id}`).all(); }
    catch (e) { console.error(`(건너뜀) ${tbl} 조회 실패:`, e.message); continue; }

    // 대상 선별: force 면 전부, 아니면 영문이 하나라도 비었고 한글 원문이 있는 행
    const targets = rows.filter((r) => {
      const needsAny = srcFields.some((f) => {
        const enCol = job.map[f];
        const hasKo = translate.hasKorean(r[f]);
        const hasEn = String(r[enCol] || "").trim().length > 0;
        return hasKo && (FORCE || !hasEn);
      });
      return needsAny;
    });
    console.log(`\n[${tbl}] 전체 ${rows.length}행 · 번역 대상 ${targets.length}행`);
    totalRows += targets.length;

    for (const r of targets) {
      const sets = [], vals = [], shortT = {};
      for (const f of srcFields) {
        const enCol = job.map[f];
        if (!(translate.hasKorean(r[f]) && (FORCE || !String(r[enCol] || "").trim()))) continue;
        if (LONG_FIELDS.has(f)) {
          const en = await translate.toEnglishLong(r[f]); // 긴 본문은 쪼개 번역(토큰 한도 회피)
          if (en && en !== r[f]) { sets.push(`${enCol} = ?`); vals.push(en); }
        } else {
          shortT[f] = r[f];
        }
      }
      if (Object.keys(shortT).length) {
        const en = await translate.toEnglishObject(shortT);
        for (const f of Object.keys(shortT)) if (en[f] && en[f] !== r[f]) { sets.push(`${job.map[f]} = ?`); vals.push(en[f]); }
      }
      if (sets.length) {
        vals.push(r[job.id]);
        db.prepare(`UPDATE ${tbl} SET ${sets.join(", ")} WHERE ${job.id} = ?`).run(...vals);
        totalDone++;
        console.log(`  · ${tbl}#${r[job.id]} ← ${sets.length}개 필드`);
      }
    }
  }
  console.log(`\n✅ 완료 — 대상 ${totalRows}행 중 ${totalDone}행 번역 반영.`);
  process.exit(0);
}

run().catch((e) => { console.error("백필 오류:", e); process.exit(1); });
