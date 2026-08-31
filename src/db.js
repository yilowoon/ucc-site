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

  -- 보안 모니터링: 알려진 공격/스캔 경로 요청 기록
  CREATE TABLE IF NOT EXISTS security_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip         TEXT    NOT NULL DEFAULT '',
    method     TEXT    NOT NULL DEFAULT 'GET',
    path       TEXT    NOT NULL DEFAULT '',
    ua         TEXT    NOT NULL DEFAULT '',
    category   TEXT    NOT NULL DEFAULT '',   -- wordpress/secret/dbadmin/php/rce/traversal/appscan
    created_at TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_secev_created ON security_events(id DESC);
  CREATE INDEX IF NOT EXISTS idx_secev_ip ON security_events(ip);

  -- 자동 차단된 IP (공격/스캔 시도)
  CREATE TABLE IF NOT EXISTS blocked_ips (
    ip         TEXT PRIMARY KEY,
    reason     TEXT NOT NULL DEFAULT '',
    hits       INTEGER NOT NULL DEFAULT 1,
    until      TEXT NOT NULL DEFAULT '',   -- 차단 해제 시각(ISO), 빈값=영구
    created_at TEXT NOT NULL
  );

  -- 뉴스레터: 사회적경제 등 키워드 뉴스 큐레이션(제목·요약·출처·링크·이미지 2컷)
  CREATE TABLE IF NOT EXISTS newsletter (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT '',   -- 언론사명
    url          TEXT NOT NULL DEFAULT '',    -- 원문 링크
    keyword      TEXT NOT NULL DEFAULT '',    -- 매칭 키워드
    image1       TEXT NOT NULL DEFAULT '',
    image2       TEXT NOT NULL DEFAULT '',
    guid         TEXT NOT NULL DEFAULT '',    -- 중복 방지 키
    published_at TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_guid ON newsletter(guid);
  CREATE INDEX IF NOT EXISTS idx_newsletter_id ON newsletter(id DESC);

  -- 기업회원 임원사(EXECUTIVE PARTNERS): 관리자 등록, 기업회원 페이지에 자동 출력
  CREATE TABLE IF NOT EXISTS partners (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    logo          TEXT NOT NULL DEFAULT '',   -- 로고(CI) 파일명(=/uploads/…)
    ceo           TEXT NOT NULL DEFAULT '',   -- 대표이사
    field         TEXT NOT NULL DEFAULT '',   -- 주요사업분야
    intro         TEXT NOT NULL DEFAULT '',   -- 회사소개(입력값 기반 자동 생성, 200자 내외)
    address       TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    url           TEXT NOT NULL DEFAULT '',   -- 홈페이지
    region        TEXT NOT NULL DEFAULT '',
    profile_file  TEXT NOT NULL DEFAULT '',   -- 기업소개자료 파일명
    profile_name  TEXT NOT NULL DEFAULT '',   -- 기업소개자료 원본파일명
    featured      INTEGER NOT NULL DEFAULT 1, -- 상단 박스 노출
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_partners_sort ON partners(sort_order, id);
`);

// posts: 자동 수집 글의 원문 식별자 — 같은 기사를 두 번 올리지 않기 위함
try { db.exec("ALTER TABLE posts ADD COLUMN source_guid TEXT NOT NULL DEFAULT ''"); } catch (e) {}
// 수동 작성 글은 source_guid 가 빈 값이므로 부분 인덱스로 충돌을 피한다
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_source_guid ON posts(source_guid) WHERE source_guid <> ''"); } catch (e) {}

// members 컬럼 마이그레이션 (이미 있으면 무시)
try { db.exec("ALTER TABLE members ADD COLUMN member_type TEXT NOT NULL DEFAULT '개인회원'"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN org_name TEXT NOT NULL DEFAULT ''"); } catch (e) {}
// 회원 등급 체계: 가입 시 준회원, 관리자가 회비 확인 후 정회원 승인
try { db.exec("ALTER TABLE members ADD COLUMN grade TEXT NOT NULL DEFAULT '준회원'"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN fee_paid INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN confirmed_at TEXT NOT NULL DEFAULT ''"); } catch (e) {}
// 마이페이지 추가 프로필: 주소(도로명)·상세주소·학교·학위·전공·전문분야
try { db.exec("ALTER TABLE members ADD COLUMN address TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN address_detail TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN education TEXT NOT NULL DEFAULT ''"); } catch (e) {} // 학교명
try { db.exec("ALTER TABLE members ADD COLUMN edu_level TEXT NOT NULL DEFAULT ''"); } catch (e) {} // 학위(고교/전문학사/학사/석사/박사/기타)
try { db.exec("ALTER TABLE members ADD COLUMN major TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN specialty TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("ALTER TABLE members ADD COLUMN position TEXT NOT NULL DEFAULT ''"); } catch (e) {}   // 직급
try { db.exec("ALTER TABLE members ADD COLUMN job TEXT NOT NULL DEFAULT ''"); } catch (e) {}        // 하시는일
try { db.exec("ALTER TABLE members ADD COLUMN interest TEXT NOT NULL DEFAULT ''"); } catch (e) {}   // 관심분야
try { db.exec("ALTER TABLE members ADD COLUMN fee_paid_at TEXT NOT NULL DEFAULT ''"); } catch (e) {} // 회비납부일
// 기업·단체(기관)회원 전용 추가 정보
try { db.exec("ALTER TABLE members ADD COLUMN biz_ceo TEXT NOT NULL DEFAULT ''"); } catch (e) {}      // 대표자 이름
try { db.exec("ALTER TABLE members ADD COLUMN biz_sector TEXT NOT NULL DEFAULT ''"); } catch (e) {}   // 주요업종
try { db.exec("ALTER TABLE members ADD COLUMN biz_website TEXT NOT NULL DEFAULT ''"); } catch (e) {}  // 누리집 주소
try { db.exec("ALTER TABLE members ADD COLUMN biz_logo TEXT NOT NULL DEFAULT ''"); } catch (e) {}     // 로고(CI) 파일
try { db.exec("ALTER TABLE members ADD COLUMN biz_profile TEXT NOT NULL DEFAULT ''"); } catch (e) {}  // 기업소개자료 파일
try { db.exec("ALTER TABLE members ADD COLUMN biz_profile_name TEXT NOT NULL DEFAULT ''"); } catch (e) {} // 소개자료 원본파일명
// SNS 간편로그인 연동(카카오/네이버/구글)
try { db.exec("ALTER TABLE members ADD COLUMN provider TEXT NOT NULL DEFAULT ''"); } catch (e) {}    // '' | kakao | naver | google
try { db.exec("ALTER TABLE members ADD COLUMN provider_id TEXT NOT NULL DEFAULT ''"); } catch (e) {} // 제공사 고유 사용자 ID
try { db.exec("CREATE INDEX IF NOT EXISTS idx_members_provider ON members(provider, provider_id)"); } catch (e) {}
// contacts: 문의 확인용 4자리 PIN 해시 · 회원 연동 · 관리자 답변
try { db.exec("ALTER TABLE contacts ADD COLUMN pw_hash TEXT NOT NULL DEFAULT ''"); } catch (e) {}     // 4자리 PIN(bcrypt)
try { db.exec("ALTER TABLE contacts ADD COLUMN member_id INTEGER NOT NULL DEFAULT 0"); } catch (e) {} // 회원이 작성한 경우
try { db.exec("ALTER TABLE contacts ADD COLUMN reply TEXT NOT NULL DEFAULT ''"); } catch (e) {}        // 관리자 답변
try { db.exec("ALTER TABLE contacts ADD COLUMN replied_at TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)"); } catch (e) {}
// visits: 순방문자용 visitor 컬럼 (기존 DB 대비) — 컬럼 보장 후 인덱스 생성
try { db.exec("ALTER TABLE visits ADD COLUMN visitor TEXT NOT NULL DEFAULT ''"); } catch (e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(visitor)"); } catch (e) {}
// visits: 접속 IP 기록 컬럼(관리자 접속기록용) — 개인정보처리방침 고지·보관기간 준수 필요
try { db.exec("ALTER TABLE visits ADD COLUMN ip TEXT NOT NULL DEFAULT ''"); } catch (e) {}
// newsletter: 기사 본문 전체 컬럼
try { db.exec("ALTER TABLE newsletter ADD COLUMN content TEXT NOT NULL DEFAULT ''"); } catch (e) {}
// newsletter: 조회수
try { db.exec("ALTER TABLE newsletter ADD COLUMN views INTEGER NOT NULL DEFAULT 0"); } catch (e) {}

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

/* ---- 임원사(partners): 최초 1회 partners.js 데이터로 시드 ---- */
function seedPartners() {
  const row = db.prepare("SELECT COUNT(*) AS n FROM partners").get();
  if (row.n > 0) return;
  let PARTNERS = [];
  try { PARTNERS = require("./partners").PARTNERS || []; } catch (e) {}
  if (!PARTNERS.length) return;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO partners (name, logo, ceo, field, intro, address, phone, url, region, featured, sort_order, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  PARTNERS.forEach((p, i) => {
    stmt.run(
      p.name || "", p.logo || "", p.ceo || "", p.field || "", p.intro || "",
      p.address || "", p.phone || "", p.url || "", p.region || "",
      p.featured ? 1 : 0, i, now
    );
  });
  console.log("[partners] partners.js → DB 시드 완료:", PARTNERS.length + "건");
}
seedPartners();

module.exports = { db, DATA_DIR, UPLOAD_DIR, DB_PATH };
