/*
 * 지구촌소식브리프(board=global) 기존 글의 [오늘의 명언] 형식 정리 (1회성)
 *   변경 전:  - 문구 -            (줄1)
 *             - by 저자           (줄2)
 *   변경 후:  - 문구 (by 저자) -  (한 줄)
 *
 * 사용법(서버 ~/ucc-site 에서):
 *   node tools/fix-quote-format.js           # 미리보기(변경 안 함)
 *   node tools/fix-quote-format.js --apply   # 실제 반영
 */
"use strict";

const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "..", "data", "ucc.db");
const apply = process.argv.includes("--apply");

const db = new DatabaseSync(DB_PATH);
const rows = db.prepare("SELECT id, title, content FROM posts WHERE board = 'global' ORDER BY id").all();

// [오늘의 명언] 뒤의 두 줄(- 문구 - / - by 저자)을 한 줄로 합친다.
// 저자 줄은 같은 줄([^\n]+)만 소비하고, 뒤의 빈 줄은 그대로 보존한다.
const RE = /(\[오늘의 명언\]\s*\n)-\s*([\s\S]*?)\s*-[ \t]*\n-[ \t]*by[ \t]*([^\n]+?)[ \t]*(\n|$)/;

function fix(content) {
  const s = String(content || "");
  const m = s.match(RE);
  if (!m) return null; // 이미 한 줄이거나 명언 블록 없음
  const text = m[2].replace(/\s+/g, " ").trim();
  const author = m[3].trim();
  return s.replace(RE, `${m[1]}- ${text} (by ${author}) -${m[4]}`);
}

let changed = 0;
const upd = db.prepare("UPDATE posts SET content = ?, updated_at = ? WHERE id = ?");
for (const r of rows) {
  const next = fix(r.content);
  if (!next || next === r.content) {
    console.log(`#${String(r.id).padEnd(4)} [변경없음]   ${String(r.title).slice(0, 46)}`);
    continue;
  }
  changed++;
  console.log(`#${String(r.id).padEnd(4)} [수정대상]   ${String(r.title).slice(0, 46)}`);
  if (apply) upd.run(next, new Date().toISOString(), r.id);
}

console.log("─".repeat(60));
if (!changed) console.log("[fix-quote] 대상 글이 없습니다.");
else if (apply) console.log(`[fix-quote] 완료: ${changed}건 수정.`);
else console.log(`[fix-quote] 미리보기: ${changed}건이 대상입니다. 반영하려면:  node tools/fix-quote-format.js --apply`);
