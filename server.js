/* 사단법인 도시공동체본부 — 홈페이지 + 게시판 서버 */
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");

const { db, DATA_DIR, UPLOAD_DIR } = require("./src/db");
const cfg = require("./src/config");
const boardRoutes = require("./src/routes/board");
const adminRoutes = require("./src/routes/admin");
const siteRoutes = require("./src/routes/site");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

// 리버스 프록시(로드밸런서·터널·PaaS) 뒤에서 HTTPS·쿠키 정상 동작
app.set("trust proxy", 1);
if (IS_PROD && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16)) {
  console.warn("⚠ 프로덕션에서는 SESSION_SECRET 환경변수(16자 이상)를 반드시 설정하세요.");
}

// ---- View engine ----
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ---- Body parsing ----
app.use(express.urlencoded({ extended: false }));

// ---- Sessions ----
app.use(
  session({
    name: "ucc.sid",
    secret: process.env.SESSION_SECRET || "ucc-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // "auto": HTTPS 연결이면 secure 쿠키, HTTP면 일반 쿠키 (trust proxy + X-Forwarded-Proto 기준)
      // → HTTPS 적용 전 IP/HTTP 테스트에서도 세션·CSRF 정상 동작
      secure: "auto",
      // maxAge 미설정 = "세션 쿠키": 브라우저 종료 시 쿠키가 삭제되어 로그인도 종료됨.
      // 로그인 후 1시간 절대 만료는 아래 loginAt 검사(SESSION_MAX_MS)로 서버측에서 강제.
    },
  })
);

// ---- 세션 절대 만료: 로그인(회원·관리자) 후 1시간 경과 시 자동 로그아웃 ----
const SESSION_MAX_MS = 1000 * 60 * 60; // 1시간
app.use((req, res, next) => {
  if (req.session) {
    const now = Date.now();
    if (req.session.member && now - (req.session.member.loginAt || 0) > SESSION_MAX_MS) {
      delete req.session.member;
    }
    if (req.session.admin && now - (req.session.admin.loginAt || 0) > SESSION_MAX_MS) {
      delete req.session.admin;
    }
  }
  next();
});

// ---- CSRF (세션 기반 토큰) ----
app.use((req, res, next) => {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(16).toString("hex");
  }
  res.locals.csrfToken = req.session.csrf;
  next();
});

function verifyCsrf(req, res, next) {
  const token = req.body && req.body._csrf;
  if (!token || token !== req.session.csrf) {
    return res.status(403).render("message", {
      ...baseLocals(req),
      title: "요청 오류",
      heading: "잘못된 요청입니다",
      body: "보안 토큰이 일치하지 않습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
      backUrl: "/",
    });
  }
  next();
}

// ---- 공용 view locals ----
function baseLocals(req) {
  return {
    boards: cfg.BOARDS,
    boardKeys: cfg.BOARD_KEYS,
    currentBoard: null,
    isAdmin: !!(req.session && req.session.admin),
    adminName: req.session && req.session.admin ? req.session.admin.username : null,
    isMember: !!(req.session && req.session.member),
    memberName: req.session && req.session.member ? req.session.member.name : null,
    esc: cfg.escapeHtml,
    nl2br: cfg.nl2br,
    nl2brLink: cfg.nl2brLink,
    fmtDate: cfg.formatDate,
    fmtDateTime: cfg.formatDateTime,
    csrfToken: req.session ? req.session.csrf : "",
    path: req.path,
    baseUrl: req.protocol + "://" + req.get("host"), // OG 절대 URL용
  };
}
app.use((req, res, next) => {
  res.locals = { ...res.locals, ...baseLocals(req) };
  next();
});

// ---- Static (홈은 아래 핸들러에서 OG 절대 URL 주입을 위해 index 자동서빙 비활성) ----
// dotfiles:"deny" — .env/.git 등 숨김파일 요청은 403 (실제로 public에는 없지만 이중 방어)
app.use(express.static(path.join(__dirname, "public"), { index: false, dotfiles: "deny" }));
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    maxAge: "7d",
    dotfiles: "deny",
    setHeaders(res) {
      // 업로드 파일은 인라인 표시(이미지)만 허용, 스크립트 실행 방지
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'");
    },
  })
);

// ---- 트래픽 집계 (순방문자 기준; 정적파일/관리자/API/봇 제외) ----
const insertVisit = db.prepare(
  "INSERT INTO visits (path, source, device, visitor, ip, day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
// 클라이언트 IP 추출 (trust proxy + X-Forwarded-For 기준), IPv6 매핑 IPv4 정규화
function clientIp(req) {
  let ip = req.ip || "";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7); // ::ffff:1.2.3.4 → 1.2.3.4
  if (ip === "::1") ip = "127.0.0.1";
  return ip.slice(0, 45);
}
function visitorId(req, res) {
  // 익명 랜덤 식별자 쿠키(uccv) — 개인정보 아님, 순방문자 집계용
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)uccv=([a-f0-9]{24,})/);
  if (m) return m[1];
  const id = crypto.randomBytes(16).toString("hex");
  res.cookie("uccv", id, { maxAge: 365 * 24 * 3600 * 1000, httpOnly: true, sameSite: "lax", secure: req.secure });
  return id;
}
app.use((req, res, next) => {
  try {
    if (req.method === "GET") {
      const p = req.path;
      const skip =
        p.startsWith("/admin") || p.startsWith("/api") ||
        p.startsWith("/css") || p.startsWith("/js") || p.startsWith("/img") ||
        p.startsWith("/uploads") || p.includes(".");
      const ua = req.get("user-agent") || "";
      const isBot = /(bot|crawl|spider|slurp|preview|facebookexternalhit|monitor|curl|wget|python-requests|headless)/i.test(ua);
      if (!skip && !isBot) {
        const host = (req.get("host") || "").replace(/^www\./, "").split(":")[0];
        const ref = req.get("referer") || "";
        let source = "직접";
        if (ref) {
          try {
            const rh = new URL(ref).hostname.replace(/^www\./, "");
            if (rh === host) source = "내부";
            else if (/(google|bing|yahoo|daum|naver|search|검색)/i.test(rh)) source = "검색";
            else if (/(facebook|instagram|twitter|x\.com|t\.co|youtube|kakao|band\.us|threads|linkedin)/i.test(rh)) source = "소셜";
            else source = "기타";
          } catch (e) { source = "기타"; }
        }
        const device = /mobile|android|iphone|ipad|ipod/i.test(ua) ? "모바일" : "데스크톱";
        const vid = visitorId(req, res);
        const kst = new Date(Date.now() + 9 * 3600 * 1000); // KST 기준 날짜
        insertVisit.run(p.slice(0, 200), source, device, vid, clientIp(req), kst.toISOString().slice(0, 10), new Date().toISOString());
      }
    }
  } catch (e) { /* 통계 실패는 서비스에 영향 주지 않음 */ }
  next();
});

// ---- 보안 모니터링: 알려진 공격/스캔 경로 요청 기록 (모든 메서드) ----
const THREAT_PATTERNS = [
  { re: /(wp-json|wp-login|wp-admin|wp-content|wp-includes|xmlrpc\.php|wlwmanifest|wp-config)/i, cat: "wordpress" },
  { re: /(\/\.env|\/\.git|\/\.aws|\/\.ssh|\/\.htaccess|\/\.htpasswd|\.sql(\?|$)|\.bak(\?|$))/i, cat: "secret" },
  { re: /(phpmyadmin|\/pma\b|adminer|dbadmin|\/administrator)/i, cat: "dbadmin" },
  { re: /(vendor\/phpunit|eval-stdin|\/cgi-bin|boaform|GponForm|\/shell|\/cmd\b|jndi:|\$\{)/i, cat: "rce" },
  { re: /(\.\.\/|\.\.%2f|%2e%2e|\/etc\/passwd)/i, cat: "traversal" },
  { re: /\.(php|asp|aspx|jsp)(\?|$|\/)/i, cat: "php" },
  { re: /(\/actuator|\/solr\b|\/struts|\/telescope|\/\.vscode)/i, cat: "appscan" },
];
const insertSecEvent = db.prepare(
  "INSERT INTO security_events (ip, method, path, ua, category, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);
const upsertBlock = db.prepare(
  "INSERT INTO blocked_ips (ip, reason, hits, until, created_at) VALUES (?, ?, 1, ?, ?) " +
  "ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, hits = blocked_ips.hits + 1, until = excluded.until"
);
// 차단 IP 캐시(메모리) — DB에서 로드
const blockedIps = new Map(); // ip -> untilMs (0 = 영구)
try {
  for (const r of db.prepare("SELECT ip, until FROM blocked_ips").all()) {
    blockedIps.set(r.ip, r.until ? (Date.parse(r.until) || 0) : 0);
  }
  console.log(`[security] 차단 IP ${blockedIps.size}건 로드`);
} catch (e) {}

// 자동 차단 정책
const BAN_TTL = 24 * 3600 * 1000;                 // 24시간 차단
const HIGH_SEVERITY = new Set(["rce", "secret", "traversal"]); // 즉시 차단
const SOFT_LIMIT = 5;                              // 그 외: 1시간 내 5회 초과 시 IP 차단
const threatWindow = new Map();                    // ip -> { count, first }
const IP_ALLOW = new Set(["127.0.0.1", "::1", ""]); // 루프백 등은 IP 전면 차단 제외(요청 차단은 유지)

function banIp(ip, reason) {
  const untilMs = Date.now() + BAN_TTL;
  blockedIps.set(ip, untilMs);
  try { upsertBlock.run(ip, reason, new Date(untilMs).toISOString(), new Date().toISOString()); } catch (e) {}
}
function forbid(res) { return res.status(403).type("text/plain").send("Forbidden"); }

// 보안 미들웨어: (1) 차단 IP 즉시 거부 (2) 공격 패턴 탐지 시 로깅·요청 차단·자동 IP 차단
app.use((req, res, next) => {
  let ip = "";
  try {
    ip = clientIp(req);
    // (1) 이미 차단된 IP
    const until = blockedIps.get(ip);
    if (until !== undefined) {
      if (until === 0 || until > Date.now()) return forbid(res);
      blockedIps.delete(ip); // 만료 → 해제
    }
    // (2) 공격 패턴 탐지 — 경로(쿼리 제외)만 검사해 정상 검색어 오탐 방지
    const rawPath = (req.originalUrl || "").split("?")[0].slice(0, 300);
    let decPath = rawPath; try { decPath = decodeURIComponent(rawPath); } catch (e) {}
    const hay = rawPath + " " + decPath;
    for (const t of THREAT_PATTERNS) {
      if (t.re.test(hay)) {
        insertSecEvent.run(ip, req.method, rawPath, (req.get("user-agent") || "").slice(0, 200), t.cat, new Date().toISOString());
        // 심각 유형은 즉시 IP 차단, 그 외는 1시간 내 누적 5회 초과 시 차단 (루프백 제외)
        if (!IP_ALLOW.has(ip)) {
          if (HIGH_SEVERITY.has(t.cat)) {
            banIp(ip, t.cat);
          } else {
            const now = Date.now();
            const w = threatWindow.get(ip) || { count: 0, first: now };
            if (now - w.first > 3600 * 1000) { w.count = 0; w.first = now; }
            w.count++; threatWindow.set(ip, w);
            if (w.count > SOFT_LIMIT) banIp(ip, t.cat);
          }
        }
        return forbid(res); // 해당 악성 요청 자체를 차단
      }
    }
  } catch (e) { /* 보안 처리 실패는 서비스에 영향 주지 않음 */ }
  next();
});
// 관리자에서 차단 목록 조회/해제할 수 있도록 캐시 공유
app.locals.blockedIps = blockedIps;

// ---- Routes ----
// 홈: 정적 index.html에 OG 절대 URL(__BASE__)을 요청 호스트 기준으로 주입해 서빙
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
const GUEST_NAV = '<li><a href="/login">로그인</a></li><li><a href="/signup" class="nav-cta">회원가입</a></li>';
const GUEST_NAV_M = '<a href="/login">로그인</a><a href="/signup">회원가입</a>';
app.get("/", (req, res) => {
  const base = req.protocol + "://" + req.get("host");
  const member = req.session && req.session.member;
  let nav = GUEST_NAV, navM = GUEST_NAV_M;
  if (member) {
    nav =
      '<li><a href="/mypage">마이페이지</a></li>' +
      '<li><a href="#" class="nav-cta" onclick="document.getElementById(\'mLogout\').submit();return false;">로그아웃</a></li>';
    navM =
      '<a href="/mypage">마이페이지</a>' +
      '<a href="#" onclick="document.getElementById(\'mLogout\').submit();return false;">로그아웃</a>';
  }
  // 관리자 세션(회원과 별개)에 따른 관리자 메뉴 — 서브페이지(header/footer.ejs)와 동일하게
  const isAdmin = !!(req.session && req.session.admin);
  const csrf = req.session.csrf || "";
  let adminNav = "", adminNavM = "";
  let adminFoot = '<a href="/admin/login">관리자</a>';
  if (isAdmin) {
    adminNav = '<li><a href="/admin" class="nav-admin">관리자</a></li>';
    adminNavM = '<a href="/admin">관리자</a>';
    adminFoot =
      '<a href="/admin">관리자</a>' +
      '<form action="/admin/logout" method="post" style="display:inline">' +
      '<input type="hidden" name="_csrf" value="' + csrf + '" />' +
      '<button type="submit" class="linkbtn">로그아웃</button></form>';
  }
  // 홈 응답은 로그인 여부(세션)에 따라 메뉴가 달라지므로 캐시 금지 —
  // 브라우저/프록시가 로그인 전 게스트 화면을 캐시해 로그인 후에도 재사용하는 것을 방지
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Vary", "Cookie");
  res.type("html").send(
    INDEX_HTML
      .replace(/__BASE__/g, base)
      .replace(/__CSRF__/g, csrf)
      .replace(/__MEMBERNAV__/g, nav)
      .replace(/__MEMBERNAV_M__/g, navM)
      .replace(/__ADMINNAV__/g, adminNav)
      .replace(/__ADMINNAV_M__/g, adminNavM)
      .replace(/__ADMINFOOT__/g, adminFoot)
  );
});

app.use("/admin", adminRoutes({ baseLocals, verifyCsrf }));
app.use("/board", boardRoutes({ baseLocals }));
app.use("/", siteRoutes({ verifyCsrf }));

// ---- 404 ----
app.use((req, res) => {
  res.status(404).render("message", {
    ...baseLocals(req),
    title: "페이지를 찾을 수 없습니다",
    heading: "404",
    body: "요청하신 페이지가 존재하지 않습니다.",
    backUrl: "/",
  });
});

// ---- 오류 처리 ----
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).render("message", {
    ...baseLocals(req),
    title: "오류",
    heading: status === 413 ? "파일이 너무 큽니다" : "오류가 발생했습니다",
    body: err.publicMessage || "잠시 후 다시 시도해 주세요.",
    backUrl: req.get("referer") || "/",
  });
});

app.listen(PORT, () => {
  console.log(`\n▶ 도시공동체본부 사이트 실행: http://localhost:${PORT}`);
  console.log(`  · 홈        http://localhost:${PORT}/`);
  console.log(`  · 공지사항  http://localhost:${PORT}/board/notice`);
  console.log(`  · 관리자    http://localhost:${PORT}/admin/login`);
  console.log(`  · 데이터    ${DATA_DIR}\n`);
  // 뉴스레터 자동 수집 스케줄러 (매일 08:00 / 18:00) — 수집 실패는 서비스에 영향 없음
  try { require("./src/newsletter").startScheduler(); } catch (e) { console.error("[newsletter] 스케줄러 시작 실패:", e.message); }
  // 지구촌소식브리프 주간 리포트 자동 발행 (매주 월요일 07:00)
  try { require("./src/globalnews").startScheduler(); } catch (e) { console.error("[globalnews] 스케줄러 시작 실패:", e.message); }
});
