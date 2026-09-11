/*
 * 지구촌소식브리프(board=global) 옛 '저품질 다이제스트' 글 정리 도구 (1회성 유지보수)
 *
 * 사용법(서버 ~/ucc-site 에서):
 *   node scripts/cleanup-global-digests.js            # 미리보기(삭제 안 함) — 대상 확인
 *   node scripts/cleanup-global-digests.js --delete   # 다이제스트로 탐지된 글 실제 삭제
 *   node scripts/cleanup-global-digests.js --ids 25,26,27   # 지정한 ID만 삭제(수동)
 *
 * 안전장치:
 *  - 기본은 미리보기(dry-run)입니다. --delete 를 줘야 실제로 지웁니다.
 *  - 'AI집필' 정상 리포트는 다이제스트 마커가 없어 자동 대상에서 제외됩니다.
 *  - 첨부 파일(data/uploads)도 함께 삭제하고, posts 행은 CASCADE로 attachments 행을 정리합니다.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "ucc.db");

// 저품질 다이제스트(fallbackReport)에서만 나오던 문구 — 정상 AI 리포트에는 없음
const DIGEST_MARKERS = /자동 요약본|자동 다이제스트|기본 다이제스트/;

const args = process.argv.slice(2);
const doDelete = args.includes("--delete");
const idsArg = (() => {
  const i = args.indexOf("--ids");
  if (i === -1) return null;
  const raw = args[i + 1] || "";
  const ids = raw.split(/[,\s]+/).map((s) => parseInt(s, 10)).filter(Boolean);
  return ids.length ? ids : null;
})();

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

const rows = db
  .prepare("SELECT id, title, content, source_guid, created_at FROM posts WHERE board = 'global' ORDER BY id")
  .all();

function isDigest(r) {
  return DIGEST_MARKERS.test(String(r.content || "")) || DIGEST_MARKERS.test(String(r.title || ""));
}

let targets;
if (idsArg) {
  const set = new Set(idsArg);
  targets = rows.filter((r) => set.has(r.id));
} else {
  targets = rows.filter(isDigest);
}

console.log(`\n[cleanup] board=global 전체 ${rows.length}건`);
console.log("─".repeat(72));
for (const r of rows) {
  const flag = idsArg ? (targets.includes(r) ? "삭제대상" : "유지") : (isDigest(r) ? "다이제스트→삭제" : "AI집필→유지");
  console.log(`#${String(r.id).padEnd(4)} [${flag.padEnd(12)}] ${r.created_at.slice(0, 10)}  ${String(r.title).slice(0, 46)}`);
}
console.log("─".repeat(72));

if (!targets.length) {
  console.log("[cleanup] 삭제 대상이 없습니다.\n");
  process.exit(0);
}

console.log(`[cleanup] 삭제 대상 ${targets.length}건: ${targets.map((t) => "#" + t.id).join(", ")}`);

if (!doDelete && !idsArg) {
  console.log("[cleanup] 지금은 미리보기입니다. 실제로 지우려면 다시 실행:  node scripts/cleanup-global-digests.js --delete\n");
  process.exit(0);
}
if (idsArg && !doDelete) {
  console.log("[cleanup] --ids 는 --delete 와 함께 써야 실제 삭제됩니다.  예: node scripts/cleanup-global-digests.js --ids " + idsArg.join(",") + " --delete\n");
  process.exit(0);
}

let removedPosts = 0;
let removedFiles = 0;
const delPost = db.prepare("DELETE FROM posts WHERE id = ?");
const getAtts = db.prepare("SELECT filename FROM attachments WHERE post_id = ?");
for (const r of targets) {
  const atts = getAtts.all(r.id);
  delPost.run(r.id); // CASCADE 로 attachments 행 삭제
  for (const a of atts) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(a.filename))); removedFiles++; } catch (e) {}
  }
  removedPosts++;
  console.log(`[cleanup] 삭제 완료 — #${r.id} (${r.title.slice(0, 40)})`);
}
console.log(`\n[cleanup] 완료: 글 ${removedPosts}건, 첨부파일 ${removedFiles}개 삭제.\n`);
