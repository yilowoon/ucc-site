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

  -- 햇빛소득마을: 시·도별 추진 현황
  CREATE TABLE IF NOT EXISTS solar_regions (
    code       TEXT    PRIMARY KEY,          -- 'seoul', 'sejong' ...
    name       TEXT    NOT NULL,             -- '서울특별시'
    sort       INTEGER NOT NULL DEFAULT 0,
    status     TEXT    NOT NULL DEFAULT '준비중',  -- 준비중 / 추진중 / 운영중
    villages   INTEGER NOT NULL DEFAULT 0,   -- 조성 마을 수
    households INTEGER NOT NULL DEFAULT 0,   -- 참여 가구 수
    capacity   REAL    NOT NULL DEFAULT 0,   -- 발전용량(MW)
    summary    TEXT    NOT NULL DEFAULT '',  -- 한 줄 요약
    body       TEXT    NOT NULL DEFAULT '',  -- 상세(줄바꿈 텍스트)
    updated_at TEXT    NOT NULL DEFAULT ''
  );

  -- 문의하기(홈 컨택 폼) 접수 내역
  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL,
    phone      TEXT    NOT NULL DEFAULT '',
    topic      TEXT    NOT NULL DEFAULT '',
    message    TEXT    NOT NULL DEFAULT '',
    status     TEXT    NOT NULL DEFAULT '신규',   -- 신규 / 확인 / 완료
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_contacts_created ON contacts(id DESC);

  -- 트래픽 통계: 페이지뷰 집계 (개인정보 미저장 — 경로·유입원·기기유형·시각만)
  CREATE TABLE IF NOT EXISTS visits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    path       TEXT    NOT NULL,
    source     TEXT    NOT NULL DEFAULT '직접',   -- 직접/검색/소셜/기타/내부
    device     TEXT    NOT NULL DEFAULT '데스크톱', -- 데스크톱/모바일
    visitor    TEXT    NOT NULL DEFAULT '',        -- 익명 방문자 식별자(쿠키)
    day        TEXT    NOT NULL,                   -- YYYY-MM-DD (KST)
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_visits_day ON visits(day);
  CREATE INDEX IF NOT EXISTS idx_visits_source ON visits(source);
`);

// members 컬럼 마이그레이션 (이미 있으면 무시)
try { db.exec("ALTER TABLE members ADD COLUMN member_type TEXT NOT NULL DEFAULT '개인회원'"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN org_name TEXT NOT NULL DEFAULT ''"); } catch (e) {}
// 회원 등급 체계: 가입 시 준회원, 관리자가 회비 확인 후 정회원 승인
try { db.exec("ALTER TABLE members ADD COLUMN grade TEXT NOT NULL DEFAULT '준회원'"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN fee_paid INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN confirmed_at TEXT NOT NULL DEFAULT ''"); } catch (e) {}
// 마이페이지 추가 프로필: 주소·최종학력·최종전공·전문분야
try { db.exec("ALTER TABLE members ADD COLUMN address TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN education TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN major TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN specialty TEXT NOT NULL DEFAULT ''"); } catch (e) {}
// visits: 순방문자용 visitor 컬럼 (기존 DB 대비) — 컬럼 보장 후 인덱스 생성
try { db.exec("ALTER TABLE visits ADD COLUMN visitor TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(visitor)"); } catch (e) {}

/* ---- 햇빛소득마을: 시·도 시드 (없을 때만) ---- */
function seedSolarRegions() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM solar_regions").get();
  if (row.n > 0) return;
  // [code, name, status, villages, households, capacity(MW), summary]
  const REGIONS = [
    ["seoul",     "서울특별시",       "준비중", 0, 0, 0,   "도심형 옥상·유휴부지 태양광 모델을 검토하고 있습니다."],
    ["incheon",   "인천광역시",       "준비중", 0, 0, 0,   "도서·연안 지역 대상 사전 수요조사 단계입니다."],
    ["gyeonggi",  "경기도",           "추진중", 1, 18, 0.5, "경기 남부 농촌마을을 중심으로 시범단지를 협의 중입니다."],
    ["gangwon",   "강원특별자치도",   "준비중", 0, 0, 0,   "폐광·유휴지 활용형 모델 타당성을 검토하고 있습니다."],
    ["chungbuk",  "충청북도",         "준비중", 0, 0, 0,   "지자체·주민 협의체 구성을 준비하고 있습니다."],
    ["chungnam",  "충청남도",         "추진중", 1, 22, 0.6, "농촌 태양광 연계 주민참여형 발전소를 추진 중입니다."],
    ["sejong",    "세종특별자치시",   "운영중", 2, 46, 1.2, "본부 소재지로서 1호 햇빛소득마을을 조성·운영하고 있습니다."],
    ["daejeon",   "대전광역시",       "준비중", 0, 0, 0,   "도시형 협동조합 발전 모델을 설계하고 있습니다."],
    ["gwangju",   "광주광역시",       "준비중", 0, 0, 0,   "시민햇빛발전 협력 방안을 협의하고 있습니다."],
    ["jeonbuk",   "전북특별자치도",   "준비중", 0, 0, 0,   "새만금 연계 재생에너지 협력을 모색하고 있습니다."],
    ["jeonnam",   "전라남도",         "추진중", 1, 15, 0.4, "농·어촌 마을단위 발전 모델을 시범 추진 중입니다."],
    ["daegu",     "대구광역시",       "준비중", 0, 0, 0,   "도시 유휴부지 활용 방안을 검토하고 있습니다."],
    ["gyeongbuk", "경상북도",         "준비중", 0, 0, 0,   "농촌 소멸대응 연계 모델을 준비하고 있습니다."],
    ["ulsan",     "울산광역시",       "준비중", 0, 0, 0,   "산업단지 연계 재생에너지 협력을 검토하고 있습니다."],
    ["gyeongnam", "경상남도",         "준비중", 0, 0, 0,   "지역 협동조합과 파트너십을 협의하고 있습니다."],
    ["busan",     "부산광역시",       "준비중", 0, 0, 0,   "도시형 시민참여 발전 모델을 검토하고 있습니다."],
    ["jeju",      "제주특별자치도",   "준비중", 0, 0, 0,   "에너지 자립섬 정책과 연계 방안을 모색하고 있습니다."],
  ];
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO solar_regions (code, name, sort, status, villages, households, capacity, summary, body, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
  );
  REGIONS.forEach((r, i) => stmt.run(r[0], r[1], i, r[2], r[3], r[4], r[5], r[6], now));
}
seedSolarRegions();

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
