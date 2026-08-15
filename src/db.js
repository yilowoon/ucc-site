/* SQLite (Node 내장 node:sqlite) 초기화 · 스키마 · 시드 */
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "ucc.db");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board      TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL DEFAULT '',
    author     TEXT    NOT NULL DEFAULT '관리자',
    views      INTEGER NOT NULL DEFAULT 0,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board, pinned DESC, id DESC);

  CREATE TABLE IF NOT EXISTS attachments (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id   INTEGER NOT NULL,
    filename  TEXT    NOT NULL,
    original  TEXT    NOT NULL,
    mimetype  TEXT    NOT NULL,
    size      INTEGER NOT NULL,
    sort      INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id, sort);

  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    phone         TEXT    NOT NULL DEFAULT '',
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS edu_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    event_date TEXT    NOT NULL,           -- YYYY-MM-DD
    category   TEXT    NOT NULL DEFAULT '기타',
    memo       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_edu_events_date ON edu_events(event_date);

  CREATE TABLE IF NOT EXISTS edu_applications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    phone      TEXT    NOT NULL DEFAULT '',
    course     TEXT    NOT NULL DEFAULT '',
    message    TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL
  );
`);

// members 컬럼 마이그레이션 (이미 있으면 무시)
try { db.exec("ALTER TABLE members ADD COLUMN member_type TEXT NOT NULL DEFAULT '개인회원'"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN org_name TEXT NOT NULL DEFAULT ''"); } catch (e) {}

/* ---- 최초 관리자 시드 ----
   관리자가 없으면 무작위 비밀번호로 생성하고
   data/INITIAL_ADMIN_PASSWORD.txt 에 1회 기록한다. */
function seedAdmin() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM admins").get();
  if (row.n > 0) return;

  const username = process.env.ADMIN_USERNAME || "admin";
  // 클라우드 배포 시 ADMIN_PASSWORD 환경변수로 최초 비밀번호 지정 (없으면 무작위 생성)
  const password =
    process.env.ADMIN_PASSWORD ||
    "ucc-" + crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "");
  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)"
  ).run(username, hash, now);

  const credPath = path.join(DATA_DIR, "INITIAL_ADMIN_PASSWORD.txt");
  fs.writeFileSync(
    credPath,
    [
      "사단법인 도시공동체본부 — 관리자 최초 계정",
      "==========================================",
      "관리자 페이지: /admin/login",
      "아이디: " + username,
      "비밀번호: " + password,
      "",
      "※ 로그인 후 [비밀번호 변경]에서 반드시 변경하세요.",
      "※ 이 파일은 안전한 곳에 보관하거나 삭제하세요.",
      "생성 시각: " + now,
      "",
    ].join("\n"),
    "utf8"
  );

  console.log("\n============================================================");
  console.log(" 최초 관리자 계정이 생성되었습니다.");
  console.log("   아이디  : " + username);
  console.log("   비밀번호: " + password);
  console.log("   (data/INITIAL_ADMIN_PASSWORD.txt 에도 기록됨)");
  console.log("   로그인 후 반드시 비밀번호를 변경하세요.");
  console.log("============================================================\n");
}
seedAdmin();

module.exports = { db, DATA_DIR, UPLOAD_DIR, DB_PATH };
