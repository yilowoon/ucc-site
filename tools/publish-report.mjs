#!/usr/bin/env node
/**
 * ucc.or.kr — 보고서 자동 게시 도구
 * =====================================================================
 * 문서 파일(docx/pdf/hwp 등)을 게시판에 글로 등록하고 첨부파일로 붙인다.
 * 메인페이지 '주요 전달 소식'은 notice/press/business 게시판의 최신 글
 * 1건씩을 자동으로 읽어가므로(src/routes/site.js → GET /api/home),
 * 글만 제대로 등록하면 요약본 노출은 자동으로 따라온다.
 *
 * 두 가지 동작 모드
 *   http (기본) : 관리자 계정으로 로그인해 HTTP로 등록. 원격에서 실행 가능.
 *   db          : data/ucc.db 에 직접 INSERT. 서버 안에서 실행할 때만 사용.
 *
 * 사용 예
 *   node tools/publish-report.mjs --file ./report.docx --meta ./report.meta.json
 *   node tools/publish-report.mjs --file ./report.docx --title "..." --summary-file ./s.txt
 *   node tools/publish-report.mjs --file ./report.docx --meta ./m.json --mode db
 *   node tools/publish-report.mjs --file ./report.docx --meta ./m.json --dry-run
 *
 * 환경변수 (.env 대신 셸에서 export 하거나 스케줄러에 등록)
 *   UCC_BASE_URL    기본 https://ucc.or.kr
 *   UCC_ADMIN_USER  관리자 아이디
 *   UCC_ADMIN_PASS  관리자 비밀번호
 * =====================================================================
 */
"use strict";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

/* ---------------------------------------------------------------- 상수 */

// src/routes/admin.js 의 ALLOWED_EXT 와 반드시 일치시킬 것
const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ".pdf", ".hwp", ".hwpx", ".doc", ".docx", ".xls", ".xlsx",
  ".ppt", ".pptx", ".zip", ".txt",
]);
const MAX_FILE = 12 * 1024 * 1024; // 12MB — admin.js 와 동일

// src/config.js 의 BOARDS 와 일치
const BOARDS = ["notice", "press", "business", "news", "global"];
// 메인 '주요 전달 소식' 3박스에 노출되는 게시판
const HOME_BOARDS = ["notice", "press", "business"];

const MIME = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pdf": "application/pdf",
  ".hwp": "application/x-hwp",
  ".hwpx": "application/hwp+zip",
  ".zip": "application/zip",
  ".txt": "text/plain",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
};

/* ------------------------------------------------------------ 유틸리티 */

function die(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}
function log(msg) {
  console.log("  " + msg);
}

/** 붙여넣기 과정에서 남은 따옴표 제거 */
function unquote(v) {
  if (typeof v !== "string") return v;
  let s = v.trim();
  while (s.length > 1 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * 인자 파싱. 아래를 모두 받아들인다.
 *   --key value     --key=value     -key value
 * 값 없이 온 키는 true (플래그).
 */
function parseArgs(argv) {
  const out = { _: [] };
  // 주의: "/key" 형태는 지원하지 않는다. 유닉스 절대경로(/home/...)와 충돌한다.
  const isKey = (a) => /^--?[A-Za-z]/.test(a);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!isKey(a)) { out._.push(unquote(a)); continue; }
    let key = a.replace(/^--?/, "");
    // --key=value 형태
    const eq = key.indexOf("=");
    if (eq > 0) { out[key.slice(0, eq)] = unquote(key.slice(eq + 1)); continue; }
    const nextArg = argv[i + 1];
    if (nextArg === undefined || isKey(nextArg)) out[key] = true;
    else { out[key] = unquote(nextArg); i++; }
  }
  return out;
}

const USAGE = [
  "",
  "사용법",
  "  node tools/publish-report.mjs --file <문서경로> [옵션]",
  "",
  "예시 (경로에 공백이나 한글이 있으면 반드시 큰따옴표로 감쌀 것)",
  '  node tools/publish-report.mjs --file "C:\\Users\\USER\\Desktop\\보고서.docx" --dry-run',
  "",
  "주요 옵션",
  "  --file <경로>        올릴 문서 (필수)",
  "  --dry-run            전송하지 않고 결과만 확인",
  "  --board <키>         notice / press / business / news / global  (기본 press)",
  "  --title <제목>       meta.json 에 있으면 생략 가능",
  "  --summary-file <경로> 요약본 텍스트 파일",
  "  --mode <http|db>     기본 http",
  "",
].join("\n");

// 인식 가능한 옵션 전체 목록 (오타 감지용)
const KNOWN_OPTS = [
  "file", "meta", "board", "title", "summary", "summary-file", "author",
  "pinned", "mode", "base-url", "user", "pass", "dry-run", "help", "check",
];

/** 두 문자열의 편집 거리 (오타 제안용) */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * 알 수 없는 옵션을 찾아 "혹시 이것?" 을 제안한다.
 * --flie 처럼 한 글자 틀린 오타가 조용히 무시되는 것을 막는다.
 */
function checkUnknownOpts(args) {
  const unknown = Object.keys(args).filter((k) => k !== "_" && !KNOWN_OPTS.includes(k));
  if (!unknown.length) return;
  console.error("");
  for (const k of unknown) {
    const best = KNOWN_OPTS
      .map((o) => ({ o, d: editDistance(k.toLowerCase(), o) }))
      .sort((x, y) => x.d - y.d)[0];
    if (best && best.d <= 3) {
      console.error(`✗ 알 수 없는 옵션 --${k} — 혹시 --${best.o} 를 의도하셨나요?`);
    } else {
      console.error(`✗ 알 수 없는 옵션 --${k}`);
    }
  }
  console.error(USAGE);
  process.exit(1);
}

/** 인자를 못 받았을 때 무엇이 들어왔는지 함께 보여준다 */
function dieWithUsage(msg, argv) {
  console.error("✗ " + msg);
  console.error(USAGE);
  console.error("이번에 스크립트가 받은 인자: " +
    (argv.length ? argv.map((a) => JSON.stringify(a)).join(" ") : "(없음 — 인자가 하나도 전달되지 않았습니다)"));
  console.error("");
  if (!argv.length) {
    console.error("힌트: 배치파일을 더블클릭했거나 옵션 없이 실행하면 이 메시지가 나옵니다.");
    console.error("      PowerShell 에서는 줄바꿈에 ^ 대신 ` (백틱)을 쓰거나 한 줄로 입력하세요.");
    console.error("");
  }
  process.exit(1);
}

/**
 * 게시글 본문은 board-post.ejs 에서 nl2br(escapeHtml(content)) 로 렌더된다.
 * 즉 HTML 태그는 화면에 글자 그대로 노출되므로, 태그를 제거하고
 * 줄바꿈만 살린 순수 텍스트로 정리한다.
 */
function toPlainText(s) {
  return String(s == null ? "" : s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function kstStamp() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().slice(0, 10);
}

/* ----------------------------------------------------------- 설정 조립 */

function buildConfig(args) {
  // 0) 오타 옵션 조기 차단 (--flie 처럼 조용히 무시되는 것을 막는다)
  checkUnknownOpts(args);

  // 1) 첨부할 파일
  const file = args.file || args.f || args._[0];
  if (!file || file === true) {
    dieWithUsage("올릴 파일을 지정하세요 (--file).", process.argv.slice(2));
  }
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) die("파일이 없습니다: " + filePath);

  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    die(`허용되지 않는 확장자입니다: ${ext}\n  허용: ${[...ALLOWED_EXT].join(" ")}`);
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE) {
    die(`파일이 12MB를 넘습니다 (${(stat.size / 1048576).toFixed(1)}MB). 서버가 거부합니다.`);
  }

  // 2) meta.json — 없으면 "<파일명>.meta.json" 을 자동 탐색
  let meta = {};
  const metaPath = args.meta
    ? path.resolve(args.meta)
    : filePath.replace(/\.[^.]+$/, "") + ".meta.json";
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      log(`메타 파일 사용: ${path.basename(metaPath)}`);
    } catch (e) {
      die("meta.json 파싱 실패: " + e.message);
    }
  }

  // 3) 요약본 — --summary-file > --summary > meta.summary
  let summary = "";
  if (args["summary-file"]) {
    const sp = path.resolve(args["summary-file"]);
    if (!fs.existsSync(sp)) die("요약 파일이 없습니다: " + sp);
    summary = fs.readFileSync(sp, "utf8");
  } else if (typeof args.summary === "string") {
    summary = args.summary;
  } else if (meta.summary) {
    summary = Array.isArray(meta.summary) ? meta.summary.join("\n") : meta.summary;
  }
  summary = toPlainText(summary);

  // 4) 나머지 필드
  const board = args.board || meta.board || "press";
  if (!BOARDS.includes(board)) {
    die(`게시판 키가 잘못되었습니다: ${board}\n  사용 가능: ${BOARDS.join(", ")}`);
  }

  const title = (args.title || meta.title || "").trim();
  const checkOnly = args.check === true;
  if (!checkOnly) {
    if (!title) die("--title 또는 meta.json 의 title 이 필요합니다.");
    if (title.length > 200) die("제목이 200자를 넘습니다 (DB 입력 폼 제한).");
    if (!summary) die("요약본이 비어 있습니다. --summary-file 또는 meta.json 의 summary 를 채우세요.");
  }

  return {
    filePath,
    fileName: path.basename(filePath),
    fileSize: stat.size,
    mimetype: MIME[ext] || "application/octet-stream",
    board,
    title,
    content: summary,
    author: (args.author || meta.author || "도시공동체본부").trim(),
    pinned: args.pinned === true || args.pinned === "1" || meta.pinned === true,
    mode: args.mode || "http",
    dryRun: args["dry-run"] === true,
    baseUrl: (args["base-url"] || process.env.UCC_BASE_URL || "https://ucc.or.kr").replace(/\/+$/, ""),
    user: args.user || process.env.UCC_ADMIN_USER || "",
    pass: args.pass || process.env.UCC_ADMIN_PASS || "",
  };
}

/* ------------------------------------------------- HTTP 모드 (원격 게시) */

/** Set-Cookie 헤더에서 쿠키 값만 뽑아 "a=1; b=2" 형태로 누적 */
function mergeCookies(jar, res) {
  const list = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")] : []);
  for (const line of list) {
    const [pair] = line.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return jar;
}
const cookieHeader = (jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/** HTML 에서 _csrf hidden 값 추출 */
function extractCsrf(html) {
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!m) die("CSRF 토큰을 찾지 못했습니다. 사이트 구조가 바뀌었는지 확인하세요.");
  return m[1];
}

/**
 * --check : 실제 게시 없이 접속·로그인·권한만 점검한다.
 * 어느 단계에서 막히는지 한눈에 보여주는 것이 목적.
 */
async function runCheck(cfg) {
  const base = cfg.baseUrl;
  const ok = (m) => console.log("  ✓ " + m);
  const ng = (m) => { console.log("  ✗ " + m); return false; };

  console.log("");
  console.log("─".repeat(64));
  console.log("  연결 진단");
  console.log("─".repeat(64));
  console.log("  대상 : " + base);
  console.log("  계정 : " + (cfg.user ? cfg.user : "(없음)"));
  console.log("  비번 : " + (cfg.pass ? "설정됨 (" + cfg.pass.length + "자)" : "(없음)"));
  console.log("");

  if (!cfg.user || !cfg.pass) {
    ng("환경변수가 설정되지 않았습니다.");
    console.log("");
    console.log("    아래를 실행한 뒤 '명령 프롬프트를 새로 열어야' 반영됩니다:");
    console.log('      setx UCC_ADMIN_USER "관리자아이디"');
    console.log('      setx UCC_ADMIN_PASS "관리자비밀번호"');
    console.log("");
    console.log("    또는 이번 한 번만 인자로 넘길 수도 있습니다:");
    console.log('      node tools/publish-report.mjs --check --user admin --pass "비밀번호"');
    console.log("");
    process.exit(1);
  }

  const jar = new Map();
  let res;
  try {
    res = await fetch(base + "/admin/login", { redirect: "manual" });
  } catch (e) {
    ng("사이트에 연결할 수 없습니다: " + e.message);
    process.exit(1);
  }
  if (!res.ok) { ng(`로그인 페이지 응답 HTTP ${res.status}`); process.exit(1); }
  ok("사이트 접속 (HTTP " + res.status + ")");
  mergeCookies(jar, res);
  const html = await res.text();
  const m = html.match(/name="_csrf"\s+value="([^"]+)"/);
  if (!m) { ng("CSRF 토큰을 찾지 못했습니다 (사이트 구조 변경 의심)"); process.exit(1); }
  ok("CSRF 토큰 확보");

  const loginRes = await fetch(base + "/admin/login", {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: m[1], next: "/admin", username: cfg.user, password: cfg.pass }),
  });
  if (loginRes.status === 401) { ng("로그인 실패 — 아이디 또는 비밀번호가 틀립니다"); process.exit(1); }
  if (loginRes.status !== 302) { ng(`로그인 응답이 이상합니다: HTTP ${loginRes.status}`); process.exit(1); }
  ok("관리자 로그인 성공");
  mergeCookies(jar, loginRes);

  const formRes = await fetch(`${base}/admin/write?board=${cfg.board}`, {
    redirect: "manual", headers: { cookie: cookieHeader(jar) },
  });
  if (formRes.status !== 200) { ng(`글쓰기 폼 접근 실패: HTTP ${formRes.status} (세션 유지 안 됨)`); process.exit(1); }
  ok(`글쓰기 권한 확인 (${cfg.board} 게시판)`);

  console.log("");
  console.log("  모두 정상입니다. 아래 명령으로 실제 게시하세요:");
  console.log(`    node tools/publish-report.mjs --file "${cfg.filePath}"`);
  console.log("");
}

async function publishHttp(cfg) {
  if (!cfg.user || !cfg.pass) {
    console.error("");
    console.error("✗ 관리자 계정 정보가 없습니다. 아직 아무것도 올라가지 않았습니다.");
    console.error("");
    console.error("  해결 방법 (둘 중 하나)");
    console.error("");
    console.error("  [A] 한 번만 등록해 두고 계속 쓰기 — 권장");
    console.error('      setx UCC_ADMIN_USER "관리자아이디"');
    console.error('      setx UCC_ADMIN_PASS "관리자비밀번호"');
    console.error("      ※ 등록 후 '명령 프롬프트를 새로 열어야' 반영됩니다.");
    console.error("");
    console.error("  [B] 이번 한 번만 인자로 넘기기");
    console.error('      node tools/publish-report.mjs --file "<문서경로>" --user admin --pass "비밀번호"');
    console.error("");
    console.error("  먼저 로그인만 확인하려면 --check 를 붙이세요.");
    console.error("");
    process.exit(1);
  }
  const jar = new Map();
  const base = cfg.baseUrl;

  // 1) 로그인 폼에서 CSRF + 세션 쿠키 확보
  log("① 로그인 페이지 요청");
  const loginPage = await fetch(base + "/admin/login", { redirect: "manual" });
  if (!loginPage.ok) die(`로그인 페이지 응답 오류: HTTP ${loginPage.status}`);
  mergeCookies(jar, loginPage);
  const csrf1 = extractCsrf(await loginPage.text());

  // 2) 로그인 (성공 시 302, 세션이 regenerate 되므로 쿠키를 다시 받는다)
  log("② 관리자 로그인");
  const loginBody = new URLSearchParams({
    _csrf: csrf1, next: "/admin", username: cfg.user, password: cfg.pass,
  });
  const loginRes = await fetch(base + "/admin/login", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(jar),
    },
    body: loginBody,
  });
  if (loginRes.status !== 302) {
    die(loginRes.status === 401
      ? "아이디 또는 비밀번호가 올바르지 않습니다."
      : `로그인 실패: HTTP ${loginRes.status}`);
  }
  mergeCookies(jar, loginRes);

  // 3) 글쓰기 폼에서 새 CSRF 토큰 확보 (세션 재생성으로 토큰이 바뀌었다)
  log("③ 글쓰기 폼에서 CSRF 재발급");
  const formRes = await fetch(`${base}/admin/write?board=${cfg.board}`, {
    redirect: "manual",
    headers: { cookie: cookieHeader(jar) },
  });
  if (formRes.status !== 200) die(`글쓰기 폼 접근 실패: HTTP ${formRes.status} (세션이 유지되지 않았습니다)`);
  mergeCookies(jar, formRes);
  const csrf2 = extractCsrf(await formRes.text());

  // 4) 글 등록 + 파일 첨부 (multipart/form-data)
  log("④ 글 등록 및 파일 첨부");
  const buf = fs.readFileSync(cfg.filePath);
  const fd = new FormData();
  fd.set("_csrf", csrf2);
  fd.set("board", cfg.board);
  fd.set("author", cfg.author);
  if (cfg.pinned) fd.set("pinned", "1");
  fd.set("title", cfg.title);
  fd.set("content", cfg.content);
  fd.append("files", new File([buf], cfg.fileName, { type: cfg.mimetype }));

  const writeRes = await fetch(base + "/admin/write", {
    method: "POST",
    redirect: "manual",
    headers: { cookie: cookieHeader(jar) },
    body: fd,
  });
  if (writeRes.status !== 302) {
    const body = await writeRes.text().catch(() => "");
    die(`글 등록 실패: HTTP ${writeRes.status}\n${body.slice(0, 400)}`);
  }
  const location = writeRes.headers.get("location") || "";
  const postId = (location.match(/\/(\d+)$/) || [])[1] || "?";

  // 5) 로그아웃 (세션 정리)
  await fetch(base + "/admin/logout", {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ _csrf: csrf2 }),
  }).catch(() => {});

  return { postId, url: base + location };
}

/* --------------------------------------------- DB 모드 (서버 내부 실행) */

async function publishDb(cfg) {
  const { DatabaseSync } = await import("node:sqlite");
  const DATA_DIR = path.join(PROJECT_ROOT, "data");
  const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
  const DB_PATH = path.join(DATA_DIR, "ucc.db");

  if (!fs.existsSync(DB_PATH)) {
    die(`DB를 찾을 수 없습니다: ${DB_PATH}\n  db 모드는 서버(또는 data/ 가 있는 환경)에서만 동작합니다.`);
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");

  // admin.js 의 multer diskStorage 와 동일한 파일명 규칙
  const ext = path.extname(cfg.fileName).toLowerCase();
  const storedName = crypto.randomBytes(12).toString("hex") + ext;
  fs.copyFileSync(cfg.filePath, path.join(UPLOAD_DIR, storedName));

  const now = new Date().toISOString();
  let postId;
  try {
    const info = db.prepare(
      `INSERT INTO posts (board, title, content, author, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(cfg.board, cfg.title, cfg.content, cfg.author, cfg.pinned ? 1 : 0, now, now);
    postId = info.lastInsertRowid;

    db.prepare(
      `INSERT INTO attachments (post_id, filename, original, mimetype, size, sort)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).run(postId, storedName, cfg.fileName, cfg.mimetype, cfg.fileSize);
  } catch (e) {
    // 글 등록에 실패하면 복사해 둔 파일도 되돌린다
    try { fs.unlinkSync(path.join(UPLOAD_DIR, storedName)); } catch {}
    die("DB 입력 실패: " + e.message);
  } finally {
    db.close();
  }

  return { postId, url: `${cfg.baseUrl}/board/${cfg.board}/${postId}` };
}

/* -------------------------------------------------------------- 메인 */

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("*/")[0].replace(/^\/\*\*?|^\s*\*ic?/gm, "").replace(/^\s*\* ?/gm, ""));
    return;
  }

  const cfg = buildConfig(args);

  if (args.check === true) { await runCheck(cfg); return; }

  console.log("");
  console.log("─".repeat(64));
  console.log(cfg.dryRun
    ? "  ucc.or.kr 보고서 게시  ★ 미리보기 모드 — 전송하지 않습니다 ★"
    : "  ucc.or.kr 보고서 게시  [실제 전송]");
  console.log("─".repeat(64));
  log(`게시판   : ${cfg.board}${HOME_BOARDS.includes(cfg.board) ? "  (메인페이지 노출됨)" : "  (메인 3박스에는 노출 안 됨)"}`);
  log(`제목     : ${cfg.title}`);
  log(`작성자   : ${cfg.author}${cfg.pinned ? "  [상단 고정]" : ""}`);
  log(`첨부     : ${cfg.fileName} (${(cfg.fileSize / 1024).toFixed(0)} KB)`);
  log(`요약본   : ${cfg.content.length}자, ${cfg.content.split("\n").length}줄`);
  log(`대상     : ${cfg.baseUrl}  [${cfg.mode} 모드]`);
  console.log("─".repeat(64));

  if (cfg.dryRun) {
    console.log("\n[미리보기] 실제 게시되면 본문이 아래와 같이 보입니다:\n");
    console.log(cfg.content.split("\n").map((l) => "  │ " + l).join("\n"));
    console.log("");
    console.log("═".repeat(64));
    console.log("  아직 아무것도 올라가지 않았습니다. (--dry-run)");
    console.log("  실제로 게시하려면 위 명령에서 --dry-run 만 빼고 다시 실행하세요.");
    console.log("  성공하면 마지막에 '✓ 게시 완료' 와 글 주소가 출력됩니다.");
    console.log("═".repeat(64));
    console.log("");
    return;
  }

  const result = cfg.mode === "db" ? await publishDb(cfg) : await publishHttp(cfg);

  console.log("");
  console.log("✓ 게시 완료");
  log(`글 번호  : ${result.postId}`);
  log(`주소     : ${result.url}`);
  if (HOME_BOARDS.includes(cfg.board)) {
    log(`메인노출 : ${cfg.baseUrl} '주요 전달 소식' 에 자동 반영`);
  }
  console.log("");
}

main().catch((e) => die(e.stack || e.message));
