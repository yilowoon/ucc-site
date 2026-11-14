/* i18n-backfill.js — DB의 미번역 영문(_en)을 백그라운드로 자동 채움
 *
 * 목적: cafe24 평소 배포(git pull + pm2 restart)만으로 영어 콘텐츠가 채워지도록,
 *   서버 부팅 시 '아직 영문이 없는 행'만 Gemini 로 번역해 _en 컬럼에 저장한다.
 *   - 이미 번역된 행은 건너뜀 → 재시작마다 반복 비용 없음(최초 1회만 실제 작업).
 *   - 무키/실패 시 아무 것도 하지 않음(한국어 폴백 유지).
 *   - 전역 스로틀(translate.js)로 무료 Gemini 분당 한도 보호.
 *   - 지구촌소식브리프(global)는 '게시글 텍스트'만 번역한다(첨부 docx 는 애초에 대상 아님).
 */
"use strict";

const { db } = require("./db");
const translate = require("./translate");

// 테이블별 (한글필드 → 영문필드)
const JOBS = {
  posts:      { id: "id", map: { title: "title_en", content: "content_en" } },
  newsletter: { id: "id", map: { title: "title_en", summary: "summary_en", content: "content_en" } },
  columns:    { id: "id", map: { title: "title_en", subtitle: "subtitle_en", lede: "lede_en", body: "body_en", author_title: "author_title_en" } },
  partners:   { id: "id", map: { name: "name_en", field: "field_en", intro: "intro_en" } },
};

let _running = false;

/** 미번역 _en 을 채운다(한글 있고 영문 비어있는 필드만). 반환 { done } 또는 { skipped }. */
async function backfillMissing() {
  if (_running) return { skipped: "already-running" };
  if (!translate.hasGemini()) return { skipped: "no-key" };
  _running = true;
  let total = 0;
  try {
    for (const [tbl, job] of Object.entries(JOBS)) {
      const srcFields = Object.keys(job.map);
      const cols = [job.id, ...srcFields, ...Object.values(job.map)].join(", ");
      let rows;
      try { rows = db.prepare(`SELECT ${cols} FROM ${tbl}`).all(); } catch (e) { continue; }
      for (const r of rows) {
        const toT = {};
        for (const f of srcFields) {
          const enCol = job.map[f];
          if (translate.hasKorean(r[f]) && !String(r[enCol] || "").trim()) toT[f] = r[f];
        }
        if (!Object.keys(toT).length) continue;
        const en = await translate.toEnglishObject(toT);
        const sets = [], vals = [];
        for (const f of Object.keys(toT)) if (en[f] && en[f] !== r[f]) { sets.push(`${job.map[f]} = ?`); vals.push(en[f]); }
        if (sets.length) {
          vals.push(r[job.id]);
          try { db.prepare(`UPDATE ${tbl} SET ${sets.join(", ")} WHERE ${job.id} = ?`).run(...vals); total++; }
          catch (e) { /* 개별 실패 무시 */ }
        }
      }
    }
  } finally { _running = false; }
  if (total) console.log(`[i18n] 자동 백필 — ${total}행 영문(_en) 생성 완료`);
  return { done: total };
}

/** 부팅 후 일정 지연을 두고 1회 백필 시작(서버 기동과 충돌 방지). */
function startBackfill(delayMs = 30000) {
  if (!translate.hasGemini()) { console.log("[i18n] GEMINI_API_KEY 없음 — 자동 백필 비활성"); return; }
  setTimeout(() => {
    backfillMissing().catch((e) => console.error("[i18n] 자동 백필 오류:", e.message));
  }, delayMs);
  console.log("[i18n] 자동 백필 예약 — 미번역 콘텐츠를 백그라운드로 영문화합니다");
}

module.exports = { backfillMissing, startBackfill, JOBS };
