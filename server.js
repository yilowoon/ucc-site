/* 사단법인 도시공동체본부 — 홈페이지 + 게시판 서버 */
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");

const { DATA_DIR, UPLOAD_DIR } = require("./src/db");
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
      secure: IS_PROD, // 프로덕션(HTTPS)에서 자동 활성화
      maxAge: 1000 * 60 * 60 * 8, // 8시간
    },
  })
);

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
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    maxAge: "7d",
    setHeaders(res) {
      // 업로드 파일은 인라인 표시(이미지)만 허용, 스크립트 실행 방지
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'");
    },
  })
);

// ---- Routes ----
// 홈: 정적 index.html에 OG 절대 URL(__BASE__)을 요청 호스트 기준으로 주입해 서빙
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
app.get("/", (req, res) => {
  const base = req.protocol + "://" + req.get("host");
  res.type("html").send(
    INDEX_HTML.replace(/__BASE__/g, base).replace(/__CSRF__/g, req.session.csrf || "")
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
});
