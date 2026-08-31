/* 사이트 라우트: 소개/약관 페이지 · 홈 API · 회원(가입/로그인) */
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { db, UPLOAD_DIR } = require("../db");
const cfg = require("../config");
const { PAGES } = require("../pages");
const chatkb = require("../chatkb"); // 소개 챗봇: 지식베이스 + Gemini 응답
const mailer = require("../mailer"); // 이메일 인증 코드 발송
const IS_PROD = process.env.NODE_ENV === "production";
const KOREA_SIDO = require("../korea-sido.json"); // 전국 시·도 경계 지오메트리

// 챗봇 rate limit(IP당 5분 25건) — 남용·비용 방지
const chatHits = new Map();
function chatClientIp(req) {
  const xf = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.ip || (req.socket && req.socket.remoteAddress) || "";
}
function chatAllowed(ip) {
  const now = Date.now(), win = 5 * 60 * 1000, max = 25;
  const arr = (chatHits.get(ip) || []).filter((t) => now - t < win);
  if (arr.length >= max) { chatHits.set(ip, arr); return false; }
  arr.push(now); chatHits.set(ip, arr);
  return true;
}

// 메인 '데일리뉴스' 리드: 본문에서 완결된 문장(2문장 이상, 5줄가량) 추출
function homeLead(content, summary) {
  let text = String(content || "").trim();
  if (text) {
    const paras = text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
      // 바이라인/기호성 짧은 문단 제거
      .filter((p) => !/^[\[【(◇▲■□●※@=\-]/.test(p) && !/[가-힣]{2,4}\s*기자\s*[\]】]?$/.test(p) && !/무단전재|재배포|저작권|편집자|ⓒ|Copyright/i.test(p) && p.length >= 15);
    text = paras.join(" ");
  }
  if (!text) text = String(summary || "").trim();
  text = text.replace(/\s+/g, " ").trim();
  const parts = text.match(/[^.!?。]+[.!?。]+/g) || (text ? [text] : []);
  const out = []; let len = 0;
  for (const s of parts) {
    out.push(s.trim()); len += s.length;
    if (out.length >= 2 && len >= 180) break; // 2문장 이상 + 충분한 분량(약 5줄)
    if (out.length >= 6) break;
  }
  return out.join(" ").trim() || text.slice(0, 240);
}

// 기업·단체회원 파일 업로드(로고/소개자료) — data/uploads 에 저장(=/uploads 로 서빙)
const MEMBER_ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg",
  ".pdf", ".hwp", ".hwpx", ".doc", ".docx", ".ppt", ".pptx", ".zip",
]);
const memberUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, crypto.randomBytes(12).toString("hex") + ext);
    },
  }),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "biz_logo" && !/^image\//.test(file.mimetype)) {
      const e = new Error("로고는 이미지 파일만 업로드할 수 있습니다."); e.publicMessage = e.message; return cb(e);
    }
    if (MEMBER_ALLOWED_EXT.has(ext)) return cb(null, true);
    const e = new Error("허용되지 않는 파일 형식입니다."); e.publicMessage = "이미지 또는 문서 파일만 업로드할 수 있습니다."; cb(e);
  },
  limits: { fileSize: 12 * 1024 * 1024, files: 2 },
});
// multer 오류를 폼으로 되돌려 표시
function memberUploadMw(req, res, next) {
  memberUpload.fields([{ name: "biz_logo", maxCount: 1 }, { name: "biz_profile", maxCount: 1 }])(req, res, (err) => {
    if (err) {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "파일 크기는 최대 12MB까지 가능합니다." : (err.publicMessage || "파일 업로드 중 오류가 발생했습니다.");
      return res.status(400).render("signup-form", {
        ...res.locals, title: "회원가입 신청", error: msg, form: req.body || {},
        types: ["개인회원", "기업회원", "단체회원"], fees: { "개인회원": 10000, "기업회원": 300000, "단체회원": 0 },
        verifiedEmail: req.session.emailVerified || "",
      });
    }
    next();
  });
}
// 업로드된 파일 원본명 UTF-8 복원
function fixName(name) { try { return Buffer.from(name, "latin1").toString("utf8"); } catch { return name; } }

module.exports = function siteRoutes({ verifyCsrf }) {
  const router = express.Router();

  // ---------- 소개 챗봇 API ----------
  router.get("/api/chat/config", (req, res) => {
    res.json({ greeting: chatkb.GREETING, suggestions: chatkb.SUGGESTIONS });
  });
  router.post("/api/chat", async (req, res) => {
    try {
      const message = String(req.body.message || "").trim().slice(0, 1000);
      if (!message) return res.status(400).json({ error: "메시지를 입력해 주세요." });
      if (!chatAllowed(chatClientIp(req))) {
        return res.status(429).json({ reply: "요청이 많아 잠시 후 다시 시도해 주세요." });
      }
      let history = [];
      try { const h = JSON.parse(req.body.history || "[]"); if (Array.isArray(h)) history = h; } catch (e) {}
      const { reply } = await chatkb.answer(message, history);
      res.json({ reply });
    } catch (e) {
      res.json({ reply: "죄송합니다. 지금은 답변이 어렵습니다. 1670-9678 또는 contact@ucc.or.kr 로 문의해 주세요." });
    }
  });

  // ---------- 소개/약관 콘텐츠 페이지 ----------
  function renderPage(group) {
    return (req, res, next) => {
      const page = PAGES[req.params.slug];
      if (!page || page.group !== group) return next();
      res.render("page", { ...res.locals, title: page.title, page });
    };
  }
  // 비전과 목표 · 프로젝트(사업) 전용 뷰
  router.get("/about/vision", (req, res) => res.render("vision", { ...res.locals, title: "비전과 목표" }));
  router.get("/about/org", (req, res) => res.render("org", { ...res.locals, title: "조직도" }));
  router.get("/business", (req, res) => res.render("biz", { ...res.locals, title: "프로젝트" }));
  router.get("/projects/forum", (req, res) => res.render("forum", { ...res.locals, title: "두잉새롬마당" }));
  router.get("/projects/community", (req, res) => res.render("community", { ...res.locals, title: "커뮤니티모임" }));
  router.get("/projects/convergence", (req, res) => res.render("convergence", { ...res.locals, title: "문화예술과학융합" }));
  // 엑스시그마 플랫폼 — 독립 레이아웃(자체 head·스타일) 페이지
  router.get("/projects/xsigma", (req, res) => res.render("xsigma", { ...res.locals, title: "엑스시그마 플랫폼" }));

  // ---------- 알림마당: 뉴스레터 (사회적경제 등 키워드 뉴스 큐레이션) ----------
  router.get("/newsletter", (req, res) => {
    const PER = 12;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const total = db.prepare("SELECT COUNT(*) AS n FROM newsletter").get().n;
    const pages = Math.max(1, Math.ceil(total / PER));
    const cur = Math.min(page, pages);
    const items = db.prepare("SELECT * FROM newsletter ORDER BY id DESC LIMIT ? OFFSET ?").all(PER, (cur - 1) * PER);
    res.render("newsletter", { ...res.locals, title: "뉴스레터", items, page: cur, pages, total, per: PER });
  });
  // 생성 이미지(SVG): 기사 사진이 1장뿐일 때 키워드·제목 기반 이미지를 즉석 생성
  router.get("/newsletter/gen/:id.svg", (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return next();
    const n = db.prepare("SELECT keyword, title, created_at FROM newsletter WHERE id = ?").get(id);
    if (!n) return next();
    // 날짜: 수집일(KST) yyyy-mm-dd
    const kst = new Date(new Date(n.created_at).getTime() + 9 * 3600 * 1000);
    const dateStr = kst.toISOString().slice(0, 10);
    res.type("image/svg+xml");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(require("../newsletter").buildGenSvg(n.keyword, n.title, dateStr));
  });
  const nlImg = (v, id) => (v === "gen" ? "/newsletter/gen/" + id + ".svg" : v);
  router.get("/newsletter/:id", (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return next();
    const n = db.prepare("SELECT * FROM newsletter WHERE id = ?").get(id);
    if (!n) return next();
    try { db.prepare("UPDATE newsletter SET views = views + 1 WHERE id = ?").run(id); n.views = (n.views || 0) + 1; } catch (e) {}
    n.image1 = nlImg(n.image1, n.id);
    n.image2 = nlImg(n.image2, n.id);
    const prev = db.prepare("SELECT id, title FROM newsletter WHERE id < ? ORDER BY id DESC LIMIT 1").get(id); // 더 오래된 글
    const nextRow = db.prepare("SELECT id, title FROM newsletter WHERE id > ? ORDER BY id ASC LIMIT 1").get(id); // 더 최신 글
    const backPage = Math.max(1, parseInt(req.query.page, 10) || 1);
    res.render("newsletter-post", { ...res.locals, title: n.title, n, prev, next: nextRow, backPage });
  });

  // ---------- 햇빛소득마을 (프로젝트) ----------
  const SOLAR_STATUS_CLASS = { "준비중": "prep", "추진중": "active", "운영중": "live" };
  router.get("/projects/solar", (req, res) => {
    const rows = db.prepare(
      "SELECT code, name, status, villages, households, capacity, summary FROM solar_regions ORDER BY sort, code"
    ).all();
    const byCode = {};
    rows.forEach((r) => { r.cls = SOLAR_STATUS_CLASS[r.status] || "prep"; byCode[r.code] = r; });
    const totals = {
      regions: rows.filter((r) => r.status !== "준비중").length,
      villages: rows.reduce((s, r) => s + r.villages, 0),
      households: rows.reduce((s, r) => s + r.households, 0),
      capacity: Math.round(rows.reduce((s, r) => s + r.capacity, 0) * 10) / 10,
    };
    res.render("solar", { ...res.locals, title: "햇빛소득마을", regions: rows, byCode, totals, sido: KOREA_SIDO });
  });
  router.get("/projects/solar/:code", (req, res, next) => {
    const r = db.prepare("SELECT * FROM solar_regions WHERE code = ?").get(req.params.code);
    if (!r) return next();
    r.cls = SOLAR_STATUS_CLASS[r.status] || "prep";
    res.render("solar-region", { ...res.locals, title: "햇빛소득마을 · " + r.name, r, nl2br: cfg.nl2br });
  });

  router.get("/about/:slug", renderPage("about"));
  router.get("/policy/:slug", renderPage("policy"));

  // ---------- 배움터: 연간교육일정 (월간 캘린더) ----------
  router.get("/learn/calendar", (req, res) => {
    const now = new Date();
    let year, month; // month 1~12
    if (/^\d{4}-\d{2}$/.test(req.query.ym || "")) {
      year = +req.query.ym.slice(0, 4); month = +req.query.ym.slice(5, 7);
    } else { year = now.getFullYear(); month = now.getMonth() + 1; }
    if (month < 1) month = 1; if (month > 12) month = 12;

    const prefix = year + "-" + String(month).padStart(2, "0");
    const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=일
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const rows = db.prepare("SELECT * FROM edu_events WHERE event_date LIKE ? ORDER BY event_date, id").all(prefix + "-%");
    const byDay = {};
    rows.forEach((r) => { const d = parseInt(r.event_date.slice(8, 10), 10); (byDay[d] = byDay[d] || []).push(r); });

    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, events: byDay[d] || [] });
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    const prevYm = month === 1 ? (year - 1) + "-12" : year + "-" + String(month - 1).padStart(2, "0");
    const nextYm = month === 12 ? (year + 1) + "-01" : year + "-" + String(month + 1).padStart(2, "0");
    const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");

    res.render("calendar", { ...res.locals, title: "연간교육일정", year, month, weeks, prevYm, nextYm, ym: prefix, today });
  });

  // ---------- 배움터: 주요과정소개 · ESG전문가과정 (전용 뷰) ----------
  router.get("/learn/courses", (req, res) => res.render("courses", { ...res.locals, title: "주요과정소개" }));
  router.get("/learn/esg", (req, res) => res.render("esg", { ...res.locals, title: "ESG전문가과정" }));

  // ---------- 배움터: 교육신청하기 ----------
  router.get("/learn/apply", (req, res) => {
    res.render("edu-apply", { ...res.locals, title: "교육신청하기", error: null, done: false, form: { course: req.query.course || "" } });
  });
  router.post("/learn/apply", verifyCsrf, (req, res) => {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim();
    const phone = (req.body.phone || "").trim();
    const course = (req.body.course || "").trim();
    const message = (req.body.message || "").trim();
    const form = { name, email, phone, course, message };
    const fail = (m) => res.status(400).render("edu-apply", { ...res.locals, title: "교육신청하기", error: m, done: false, form });
    if (!name) return fail("이름을 입력해 주세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("유효한 이메일을 입력해 주세요.");
    db.prepare("INSERT INTO edu_applications (name, email, phone, course, message, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(name, email, phone, course, message, new Date().toISOString());
    res.render("edu-apply", { ...res.locals, title: "교육신청하기", error: null, done: true, form: {} });
  });

  // 함께하는 사람들: 임원진(Board Member) 전용 뷰
  router.get("/members/board", (req, res) => res.render("people", { ...res.locals, title: "함께하는 사람들" }));
  // 정회원/준회원 페이지 — 통일 구조: 설명 + 개인/기업/단체 구분 + 명단(회원유형 열 포함)
  function renderGrade(grade, en, lead) {
    return (req, res) => {
      const members = db.prepare(
        "SELECT member_type, name, org_name, position, interest, created_at FROM members WHERE grade = ? ORDER BY created_at DESC, id DESC"
      ).all(grade);
      res.render("members-grade", { ...res.locals, title: grade, grade, en, lead, members });
    };
  }
  router.get("/members/regular", renderGrade(
    "정회원", "REGULAR MEMBER",
    "정회원은 도시공동체본부의 활동에 직접 참여하고 의사결정에 함께하는 핵심 구성원입니다."
  ));
  router.get("/members/associate", renderGrade(
    "준회원", "ASSOCIATE MEMBER",
    "준회원은 본부의 활동에 관심을 갖고 참여하는 회원으로, 의결권을 제외한 대부분의 혜택을 누립니다."
  ));

  // 회원유형별 명단 조회(회비납부일 제외, 링크 없음) — 정회원/준회원 분리
  const MEMBER_LIST_COLS = "member_type, name, org_name, position, interest, grade, created_at";
  function typeMembers(memberType) {
    const rows = db.prepare(
      "SELECT " + MEMBER_LIST_COLS + " FROM members WHERE member_type = ? ORDER BY created_at DESC, id DESC"
    ).all(memberType);
    return { full: rows.filter((m) => m.grade === "정회원"), assoc: rows.filter((m) => m.grade !== "정회원") };
  }

  // 개인회원 — 안내 + 정회원/준회원 명단 탭
  router.get("/members/individual", (req, res) => {
    const page = PAGES.individual;
    const { full, assoc } = typeMembers("개인회원");
    res.render("members-individual", { ...res.locals, title: page.title, page, full, assoc });
  });

  // 기업회원 — 임원사 소개(박스) + 전체보기 + 정회원/준회원 명단 탭
  router.get("/members/corporate", (req, res) => {
    const partners = db.prepare("SELECT * FROM partners ORDER BY sort_order, id").all();
    const { full, assoc } = typeMembers("기업회원");
    res.render("members-corporate", { ...res.locals, title: "기업회원", partners, full, assoc });
  });

  // 단체회원 — 안내 + 정회원 명단(준회원 구분 없음)
  router.get("/members/group", (req, res) => {
    const page = PAGES.group;
    const full = db.prepare(
      "SELECT " + MEMBER_LIST_COLS + " FROM members WHERE member_type = '단체회원' AND grade = '정회원' ORDER BY created_at DESC, id DESC"
    ).all();
    res.render("members-group", { ...res.locals, title: page.title, page, full });
  });

  // 배움터/회원 콘텐츠 페이지 (위 특정 라우트 뒤에 배치)
  router.get("/learn/:slug", renderPage("learn"));
  router.get("/members/:slug", renderPage("members"));

  // ---------- 홈 API (최신 게시물) ----------
  router.get("/api/home", (req, res) => {
    const notices = cfg.NOTICE_BOARDS.map((b) => {
      const row = db
        .prepare("SELECT id, title, created_at FROM posts WHERE board = ? ORDER BY pinned DESC, id DESC LIMIT 1")
        .get(b);
      const meta = cfg.BOARDS[b];
      return {
        board: b, name: meta.name, en: meta.en,
        post: row ? { id: row.id, title: row.title, date: cfg.formatDate(row.created_at) } : null,
      };
    });

    const newsRows = db
      .prepare(
        `SELECT p.id, p.title, p.created_at,
                (SELECT filename FROM attachments a WHERE a.post_id = p.id AND a.mimetype LIKE 'image/%' ORDER BY sort, id LIMIT 1) AS thumb
           FROM posts p WHERE p.board = 'news' ORDER BY p.pinned DESC, p.id DESC LIMIT 8`
      )
      .all();
    const news = newsRows.map((r) => ({
      id: r.id, title: r.title, date: cfg.formatDate(r.created_at),
      thumb: r.thumb ? "/uploads/" + r.thumb : null,
    }));

    // 최신 뉴스레터 1건 (홈 '주요 최근 소식'용)
    const nl = db
      .prepare("SELECT id, title, summary, content, source, url, image1, image2, created_at FROM newsletter ORDER BY id DESC LIMIT 1")
      .get();
    const genImg = (v, id) => (v === "gen" ? "/newsletter/gen/" + id + ".svg" : v);
    const newsletter = nl ? {
      id: nl.id, title: nl.title, source: nl.source, url: nl.url,
      date: cfg.formatDate(nl.created_at),
      lead: homeLead(nl.content, nl.summary),
      image1: genImg(nl.image1, nl.id), image2: genImg(nl.image2, nl.id),
    } : null;

    res.json({ notices, news, newsletter });
  });

  // ---------- 문의하기 접수 (홈 컨택 폼 → DB) ----------
  router.post("/api/contact", verifyCsrf, (req, res) => {
    // 허니팟: 봇이 채우면 조용히 성공 처리(저장 안 함)
    if ((req.body.website || "").trim()) return res.json({ ok: true });
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim();
    const phone = (req.body.phone || "").trim();
    const topic = (req.body.topic || "").trim();
    const message = (req.body.message || "").trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
      return res.status(400).json({ ok: false, error: "이름·이메일·문의 내용을 정확히 입력해 주세요." });
    }
    if (name.length > 100 || message.length > 5000) {
      return res.status(400).json({ ok: false, error: "입력 길이가 너무 깁니다." });
    }
    db.prepare(
      "INSERT INTO contacts (name, email, phone, topic, message, status, created_at) VALUES (?, ?, ?, ?, ?, '신규', ?)"
    ).run(name, email, phone, topic, message, new Date().toISOString());
    res.json({ ok: true });
  });

  // ---------- 문의(Contact): 보내기 / 확인하기 (임시 로그인) ----------
  const CONTACT_TOPICS = ["협력·파트너십", "컨설팅·진단", "교육 프로그램", "회원 가입", "기타"];

  // 로봇 방지: 세션 저장형 산수 캡차(1회용)
  function newCaptcha(req) {
    const a = 1 + Math.floor(Math.random() * 8);
    const b = 1 + Math.floor(Math.random() * 8);
    req.session.cap = a + b;
    return { a, b };
  }
  function capOk(req, ans) {
    const v = parseInt(String(ans || "").trim(), 10);
    const ok = req.session.cap != null && v === req.session.cap;
    req.session.cap = null;
    return ok;
  }
  function sessMember(req) {
    if (!req.session.member) return null;
    return db.prepare("SELECT id, name, email FROM members WHERE id = ?").get(req.session.member.id) || null;
  }
  function contactIdentity(req) {
    const m = sessMember(req);
    if (m) return { kind: "member", id: m.id, name: m.name, email: m.email };
    if (req.session.contact && req.session.contact.email) return { kind: "guest", email: req.session.contact.email };
    return null;
  }

  router.get("/contact", (req, res) => {
    const mode = req.query.mode === "check" ? "check" : "send";
    res.render("contact", {
      ...res.locals, title: "문의하기", mode, cap: newCaptcha(req),
      member: sessMember(req), topics: CONTACT_TOPICS, error: null, form: {},
    });
  });

  router.post("/contact/send", verifyCsrf, (req, res) => {
    const member = sessMember(req);
    const back = (error, form) => res.status(400).render("contact", {
      ...res.locals, title: "문의하기", mode: "send", cap: newCaptcha(req),
      member, topics: CONTACT_TOPICS, error, form: form || {},
    });
    if ((req.body.website || "").trim()) return res.redirect("/contact/my"); // 허니팟
    if (!capOk(req, req.body.captcha)) return back("로봇 방지 계산의 답이 올바르지 않습니다.", req.body);

    const name = member ? member.name : (req.body.name || "").trim();
    const email = member ? member.email : (req.body.email || "").trim().toLowerCase();
    const phone = (req.body.phone || "").trim();
    const topic = CONTACT_TOPICS.includes(req.body.topic) ? req.body.topic : "기타";
    const message = (req.body.message || "").trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message)
      return back("이름·유효한 이메일·문의 내용을 정확히 입력해 주세요.", req.body);
    if (name.length > 100 || message.length > 5000) return back("입력 길이가 너무 깁니다.", req.body);

    let pwHash = "";
    if (!member) {
      const pin = (req.body.pin || "").trim(), pin2 = (req.body.pin2 || "").trim();
      if (!/^\d{4}$/.test(pin)) return back("확인용 PIN을 숫자 4자리로 입력해 주세요.", req.body);
      if (pin !== pin2) return back("PIN 확인이 일치하지 않습니다.", req.body);
      const prev = db.prepare("SELECT pw_hash FROM contacts WHERE email = ? AND pw_hash <> '' ORDER BY id DESC LIMIT 1").get(email);
      if (prev) {
        if (!bcrypt.compareSync(pin, prev.pw_hash))
          return back("이 이메일로 이미 등록된 PIN과 다릅니다. 기존 PIN을 입력하거나 ‘문의 확인하기’를 이용해 주세요.", req.body);
        pwHash = prev.pw_hash;
      } else {
        pwHash = bcrypt.hashSync(pin, 10);
      }
    }
    const now = new Date().toISOString();
    db.prepare("INSERT INTO contacts (name, email, phone, topic, message, status, created_at, pw_hash, member_id) VALUES (?, ?, ?, ?, ?, '신규', ?, ?, ?)")
      .run(name, email, phone, topic, message, now, pwHash, member ? member.id : 0);
    req.session.contact = { email }; // 임시 로그인 부여
    return res.redirect("/contact/my?sent=1");
  });

  router.post("/contact/check", verifyCsrf, (req, res) => {
    const back = (error) => res.status(400).render("contact", {
      ...res.locals, title: "문의하기", mode: "check", cap: newCaptcha(req),
      member: null, topics: CONTACT_TOPICS, error, form: { email: (req.body.email || "").trim() },
    });
    if (!capOk(req, req.body.captcha)) return back("로봇 방지 계산의 답이 올바르지 않습니다.");
    const email = (req.body.email || "").trim().toLowerCase();
    const pin = (req.body.pin || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{4}$/.test(pin))
      return back("이메일과 4자리 PIN을 정확히 입력해 주세요.");
    const row = db.prepare("SELECT pw_hash FROM contacts WHERE email = ? AND pw_hash <> '' ORDER BY id DESC LIMIT 1").get(email);
    if (!row || !bcrypt.compareSync(pin, row.pw_hash)) return back("이메일 또는 PIN이 일치하지 않습니다.");
    req.session.contact = { email };
    return res.redirect("/contact/my");
  });

  router.get("/contact/my", (req, res) => {
    const id = contactIdentity(req);
    if (!id) return res.redirect("/contact?mode=check");
    const rows = id.kind === "member"
      ? db.prepare("SELECT * FROM contacts WHERE member_id = ? OR email = ? ORDER BY id DESC").all(id.id, id.email)
      : db.prepare("SELECT * FROM contacts WHERE email = ? ORDER BY id DESC").all(id.email);
    res.render("contact-my", { ...res.locals, title: "내 문의 내역", identity: id, rows, sent: req.query.sent === "1" });
  });

  router.post("/contact/logout", verifyCsrf, (req, res) => {
    delete req.session.contact;
    res.redirect("/contact");
  });

  // ---------- 회원가입 ----------
  // 회원 유형(개인/기업/단체) — 가입 시 등급은 항상 '준회원', 관리자 승인 시 '정회원'
  const MEMBER_TYPES = ["개인회원", "기업회원", "단체회원"];
  const MEMBER_FEE = { "개인회원": 10000, "기업회원": 300000, "단체회원": 0 };
  // 안내 페이지(소개만)
  router.get("/signup", (req, res) => {
    if (req.session.member) return res.redirect("/");
    res.render("signup", { ...res.locals, title: "회원가입 안내" });
  });
  // 신청 폼 페이지(별도)
  router.get("/signup/apply", (req, res) => {
    if (req.session.member) return res.redirect("/");
    res.render("signup-form", { ...res.locals, title: "회원가입 신청", error: null, form: {}, types: MEMBER_TYPES, fees: MEMBER_FEE, verifiedEmail: req.session.emailVerified || "" });
  });
  // 이메일 중복 확인(실시간)
  router.get("/api/check-email", (req, res) => {
    const email = (req.query.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ available: false, invalid: true });
    const exists = db.prepare("SELECT 1 FROM members WHERE email = ?").get(email);
    res.json({ available: !exists });
  });

  // 이메일 인증 코드 발송(세션당 10분 5회 제한)
  function sendCodeAllowed(req) {
    const now = Date.now(), win = 10 * 60 * 1000, max = 5;
    const arr = (req.session.codeHits || []).filter((t) => now - t < win);
    if (arr.length >= max) { req.session.codeHits = arr; return false; }
    arr.push(now); req.session.codeHits = arr; return true;
  }
  router.post("/api/send-code", async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: false, error: "이메일을 정확히 입력해 주세요." });
    if (db.prepare("SELECT 1 FROM members WHERE email = ?").get(email)) return res.json({ ok: false, error: "이미 가입된 이메일입니다." });
    if (!sendCodeAllowed(req)) return res.json({ ok: false, error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    req.session.emailCode = { email, code, expires: Date.now() + 10 * 60 * 1000, attempts: 0 };
    delete req.session.emailVerified;

    const subject = "[사단법인 도시공동체본부] 회원가입 이메일 인증 코드";
    const text = `회원가입 이메일 인증 코드: ${code}\n\n인증 코드는 10분간 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.`;
    const html = '<div style="font-family:sans-serif;max-width:460px;margin:0 auto;border:1px solid #e4e2da;border-radius:12px;overflow:hidden">'
      + '<div style="background:#123a2e;color:#fff;padding:16px 20px;font-weight:700">사단법인 도시공동체본부 · 이메일 인증</div>'
      + '<div style="padding:22px 20px;color:#16211c">회원가입을 위한 인증 코드입니다. 아래 6자리 코드를 입력해 주세요.'
      + '<div style="font-size:30px;font-weight:800;letter-spacing:8px;color:#123a2e;background:#f8f6f0;border-radius:10px;text-align:center;padding:16px;margin:16px 0">' + code + '</div>'
      + '<p style="font-size:13px;color:#6b766f;margin:0">인증 코드는 10분간 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p></div></div>';

    const r = await mailer.sendMail(email, subject, text, html);
    if (!r.sent) {
      if (IS_PROD) return res.json({ ok: false, error: "메일 발송이 설정되지 않았습니다. 사무처(1670-9678)로 문의해 주세요." });
      return res.json({ ok: true, sent: false, devCode: code }); // 개발: 화면에서 확인
    }
    res.json({ ok: true, sent: true });
  });

  // 인증 코드 검증
  router.post("/api/verify-code", (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const code = (req.body.code || "").trim();
    const rec = req.session.emailCode;
    if (!rec || rec.email !== email) return res.json({ ok: false, error: "먼저 인증 코드를 받아 주세요." });
    if (Date.now() > rec.expires) { delete req.session.emailCode; return res.json({ ok: false, error: "코드가 만료되었습니다. 다시 받아 주세요." }); }
    rec.attempts = (rec.attempts || 0) + 1;
    if (rec.attempts > 10) { delete req.session.emailCode; return res.json({ ok: false, error: "시도 횟수를 초과했습니다. 코드를 다시 받아 주세요." }); }
    if (code !== rec.code) return res.json({ ok: false, error: "코드를 다시 확인하세요." });
    req.session.emailVerified = email;
    delete req.session.emailCode;
    res.json({ ok: true });
  });

  router.post("/signup", memberUploadMw, verifyCsrf, (req, res) => {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const phone = (req.body.phone || "").replace(/[^0-9]/g, ""); // 숫자만 저장
    const memberType = MEMBER_TYPES.includes(req.body.member_type) ? req.body.member_type : "개인회원";
    const isBiz = memberType === "기업회원" || memberType === "단체회원";
    // 소속(org_name): 개인=소속(미입력 시 도시공동체본부) / 기업=기업명 / 단체=단체명
    const orgNameRaw = (req.body.org_name || "").trim();
    const orgName = isBiz ? orgNameRaw : (orgNameRaw || "도시공동체본부");
    const position = (req.body.position || "").trim();
    const job = (req.body.job || "").trim();
    const interest = (req.body.interest || "").trim();
    const pw = req.body.password || "";
    const confirm = req.body.confirm || "";
    const bizCeo = isBiz ? (req.body.biz_ceo || "").trim() : "";
    const bizSector = isBiz ? (req.body.biz_sector || "").trim() : "";
    const bizWebsite = isBiz ? (req.body.biz_website || "").trim() : "";
    const files = req.files || {};
    const logoFile = (files.biz_logo && files.biz_logo[0]) || null;
    const profileFile = (files.biz_profile && files.biz_profile[0]) || null;
    // 업로드 파일 정리(검증 실패 시 고아 파일 삭제)
    const cleanupFiles = () => {
      [logoFile, profileFile].forEach((f) => { if (f) { try { fs.unlinkSync(path.join(UPLOAD_DIR, f.filename)); } catch (e) {} } });
    };
    const form = {
      name, email, phone, member_type: memberType, org_name: (req.body.org_name || "").trim(),
      position, job, interest, biz_ceo: bizCeo, biz_sector: bizSector, biz_website: bizWebsite,
    };
    const fail = (msg) => {
      cleanupFiles();
      res.status(400).render("signup-form", { ...res.locals, title: "회원가입 신청", error: msg, form, types: MEMBER_TYPES, fees: MEMBER_FEE, verifiedEmail: req.session.emailVerified || "" });
    };

    if (!name) return fail(isBiz ? "담당자명을 입력해 주세요." : "이름을 입력해 주세요.");
    if (isBiz && !orgNameRaw) return fail(memberType === "기업회원" ? "기업명을 입력해 주세요." : "단체명을 입력해 주세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("유효한 이메일을 입력해 주세요.");
    if (req.session.emailVerified !== email) return fail("이메일 인증을 완료해 주셔야 가입할 수 있습니다.");
    if (pw.length < 8) return fail("비밀번호는 8자 이상이어야 합니다.");
    if (pw !== confirm) return fail("비밀번호 확인이 일치하지 않습니다.");
    // 유료 회원은 회비 납부 동의 필요
    const fee = MEMBER_FEE[memberType] || 0;
    if (fee > 0 && !req.body.fee_agree) return fail("회비 납부에 동의해 주셔야 신청이 완료됩니다.");

    const exists = db.prepare("SELECT id FROM members WHERE email = ?").get(email);
    if (exists) return fail("이미 가입된 이메일입니다.");

    const bizLogo = logoFile ? logoFile.filename : "";
    const bizProfile = profileFile ? profileFile.filename : "";
    const bizProfileName = profileFile ? fixName(profileFile.originalname) : "";

    // 데모 결제: 유료 회원이 결제완료(paid=1)면 회비 납부로 기록. 실제 청구는 없음(추후 PG 연동).
    const feePaid = (fee > 0 && req.body.paid === "1") ? 1 : 0;
    const hash = bcrypt.hashSync(pw, 10);
    db.prepare(
      "INSERT INTO members (name, email, phone, member_type, org_name, position, job, interest, " +
      "biz_ceo, biz_sector, biz_website, biz_logo, biz_profile, biz_profile_name, password_hash, fee_paid, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(name, email, phone, memberType, orgName, position, job, interest,
      bizCeo, bizSector, bizWebsite, bizLogo, bizProfile, bizProfileName, hash, feePaid, new Date().toISOString());
    delete req.session.emailVerified;
    res.redirect("/login?joined=1");
  });

  // ---------- 회원 로그인 ----------
  // 로그인 후 돌아갈 내부 경로만 허용(오픈 리다이렉트 방지)
  function safeNext(next) {
    return typeof next === "string" && /^\/[a-zA-Z0-9/_\-?=&.%]*$/.test(next) && !next.startsWith("//") ? next : "";
  }
  router.get("/login", (req, res) => {
    if (req.session.member) return res.redirect("/");
    res.render("member-form", {
      ...res.locals, title: "로그인", mode: "login",
      error: null, joined: req.query.joined === "1", form: {}, next: safeNext(req.query.next),
      oauthProviders: require("../oauth").enabled(),
    });
  });

  router.post("/login", verifyCsrf, (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const pw = req.body.password || "";
    const next = safeNext(req.body.next);
    const m = db.prepare("SELECT * FROM members WHERE email = ?").get(email);
    const ok = m && bcrypt.compareSync(pw, m.password_hash);
    if (!ok) {
      return res.status(401).render("member-form", {
        ...res.locals, title: "로그인", mode: "login",
        error: "이메일 또는 비밀번호가 올바르지 않습니다.", joined: false, form: { email }, next,
      });
    }
    req.session.member = { id: m.id, name: m.name, loginAt: Date.now() };
    res.redirect(next || "/");
  });

  router.post("/logout", verifyCsrf, (req, res) => {
    delete req.session.member;
    res.redirect("/");
  });

  // ---------- 비밀번호 찾기(임시 비밀번호 발송) ----------
  const forgotHits = new Map();
  function forgotAllowed(key) {
    const now = Date.now(), win = 10 * 60 * 1000, max = 3;
    const arr = (forgotHits.get(key) || []).filter((t) => now - t < win);
    if (arr.length >= max) { forgotHits.set(key, arr); return false; }
    arr.push(now); forgotHits.set(key, arr); return true;
  }
  function genTempPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // 혼동 문자 제외
    const buf = crypto.randomBytes(10);
    let s = ""; for (let i = 0; i < 10; i++) s += chars[buf[i] % chars.length];
    return s;
  }

  router.get("/login/forgot", (req, res) => {
    if (req.session.member) return res.redirect("/");
    res.render("member-forgot", { ...res.locals, title: "비밀번호 찾기", error: null, done: false, form: {} });
  });

  router.post("/login/forgot", verifyCsrf, async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const form = { email: (req.body.email || "").trim() };
    const fail = (msg) => res.status(400).render("member-forgot", { ...res.locals, title: "비밀번호 찾기", error: msg, done: false, form });
    const done = (extra) => res.render("member-forgot", { ...res.locals, title: "비밀번호 찾기", error: null, done: true, form, ...(extra || {}) });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("유효한 이메일을 입력해 주세요.");
    if (!forgotAllowed(chatClientIp(req) + "|" + email)) return fail("요청이 많습니다. 잠시 후 다시 시도해 주세요.");

    const m = db.prepare("SELECT id, name, email FROM members WHERE email = ?").get(email);
    if (!m) return done(); // 사용자 열거 방지: 가입 여부와 무관하게 동일한 성공 화면

    // 임시 비밀번호 생성 → 메일 발송 성공 시에만 비밀번호를 교체(발송 실패로 계정이 잠기는 것 방지)
    const tempPw = genTempPassword();
    const tpl = require("../mail-templates").resetPasswordMail(m, tempPw);
    let r = { sent: false, reason: "" };
    try { r = await mailer.sendMail(m.email, tpl.subject, tpl.text, tpl.html); }
    catch (e) { console.error("[forgot] 메일 오류:", e.message); }

    if (r.sent) {
      db.prepare("UPDATE members SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(tempPw, 10), m.id);
      return done();
    }
    // 발송 실패
    console.error("[forgot] 메일 발송 실패:", r.reason || "unknown");
    if (IS_PROD) return fail("메일 발송에 실패했습니다. 사무처(1670-9678)로 문의해 주세요.");
    // 개발환경(SMTP 미설정): 화면에서 임시 비밀번호 확인 + 비번 교체
    db.prepare("UPDATE members SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(tempPw, 10), m.id);
    return done({ devPw: tempPw });
  });

  // ---------- SNS 간편로그인 (카카오·네이버·구글) ----------
  const oauth = require("../oauth");
  const OAUTH_COOKIE = "ucc_oauth";
  function readCookie(req, name) {
    const m = (req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  router.get("/auth/:provider", (req, res) => {
    const p = req.params.provider;
    if (!oauth.isEnabled(p)) return res.redirect("/login");
    const state = crypto.randomBytes(16).toString("hex");
    const payload = { p, state, next: safeNext(req.query.next) };
    // 세션 + 전용 쿠키 이중 저장(리다이렉트 왕복 중 세션 유실 대비)
    req.session.oauthState = payload;
    const cookieVal = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    res.cookie(OAUTH_COOKIE, cookieVal, { maxAge: 10 * 60 * 1000, httpOnly: true, sameSite: "lax", secure: !!req.secure, path: "/" });
    // 세션 저장 완료 후 리다이렉트
    req.session.save(() => res.redirect(oauth.authorizeUrl(p, state, oauth.callbackUrl(req, p))));
  });

  router.get("/auth/:provider/callback", async (req, res) => {
    const p = req.params.provider;
    const oauthFail = (msg) => res.status(400).render("message", {
      ...res.locals, title: "로그인 오류", heading: "소셜 로그인에 실패했습니다",
      body: msg || "잠시 후 다시 시도해 주세요.", backUrl: "/login",
    });
    if (!oauth.isEnabled(p)) return oauthFail("지원하지 않는 로그인입니다.");

    // state 복원: 세션 우선, 없으면 전용 쿠키
    let st = req.session.oauthState;
    const fromSession = !!st;
    if (!st) {
      const raw = readCookie(req, OAUTH_COOKIE);
      if (raw) { try { st = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); } catch (e) {} }
    }
    const fromCookie = !fromSession && !!st;
    res.clearCookie(OAUTH_COOKIE, { path: "/" });
    delete req.session.oauthState;

    if (!st || st.p !== p || !req.query.code || !req.query.state || req.query.state !== st.state) {
      console.warn("[oauth] state 검증 실패:", JSON.stringify({
        provider: p, hasState: !!st, hasCode: !!req.query.code,
        qState: String(req.query.state || "").slice(0, 8), stState: String((st && st.state) || "").slice(0, 8),
        fromSession, fromCookie, hadCookie: !!readCookie(req, OAUTH_COOKIE), sid: (req.sessionID || "").slice(0, 6),
      }));
      return oauthFail("인증 정보가 올바르지 않습니다. 다시 시도해 주세요.");
    }
    if (fromCookie) console.log("[oauth] 쿠키로 state 복원 성공(세션 유실):", p);

    try {
      const prof = await oauth.exchange(p, req.query.code, oauth.callbackUrl(req, p), st.state);
      if (!prof || !prof.providerId) return oauthFail("프로필 정보를 가져오지 못했습니다.");

      // 1) provider+id 로 기존 연동 회원 조회
      let m = db.prepare("SELECT * FROM members WHERE provider = ? AND provider_id = ?").get(p, prof.providerId);

      // 2) 이메일이 같은 기존(일반) 회원이 있으면 소셜 계정 연동
      if (!m && prof.email) {
        const byEmail = db.prepare("SELECT * FROM members WHERE email = ?").get(prof.email);
        if (byEmail) {
          db.prepare("UPDATE members SET provider = ?, provider_id = ? WHERE id = ?").run(p, prof.providerId, byEmail.id);
          m = byEmail;
        }
      }

      // 3) 신규 → 바로 회원가입(개인회원·준회원)
      let isNew = false;
      if (!m) {
        const email = (prof.email || `${p}_${prof.providerId}@social.ucc`).toLowerCase();
        // 혹시 이메일 유니크 충돌 시 provider 기반 대체 이메일 사용
        let finalEmail = email;
        if (db.prepare("SELECT id FROM members WHERE email = ?").get(finalEmail)) {
          finalEmail = `${p}_${prof.providerId}@social.ucc`;
        }
        const now = new Date().toISOString();
        const info = db.prepare(
          "INSERT INTO members (name, email, phone, member_type, org_name, position, job, interest, password_hash, provider, provider_id, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(prof.name || "회원", finalEmail, "", "개인회원", "도시공동체본부", "", "", "", "", p, prof.providerId, now);
        m = db.prepare("SELECT * FROM members WHERE id = ?").get(info.lastInsertRowid);
        isNew = true;
        console.log(`[oauth] 신규 회원 가입(${p}): #${m.id} ${m.email}`);
      }

      req.session.member = { id: m.id, name: m.name, loginAt: Date.now() };
      // 신규 가입 또는 정보 미완성(연락처 없음) → 마이페이지로 이동해 정보 입력 유도
      const incomplete = isNew || !String(m.phone || "").trim();
      return res.redirect(incomplete ? "/mypage/edit?welcome=1" : (st.next || "/"));
    } catch (e) {
      console.error(`[oauth] ${p} 콜백 오류:`, e.message);
      return oauthFail("소셜 로그인 처리 중 오류가 발생했습니다.");
    }
  });

  // ---------- 마이페이지 (회원 전용) ----------
  function requireMember(req, res, next) {
    if (req.session && req.session.member) return next();
    return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
  }

  router.get("/mypage", requireMember, (req, res) => {
    const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.session.member.id);
    if (!m) { delete req.session.member; return res.redirect("/login"); }
    res.render("mypage", { ...res.locals, title: "마이페이지", m });
  });

  const hasPw = (m) => !!(m && m.password_hash && m.password_hash.length > 0);

  router.get("/mypage/edit", requireMember, (req, res) => {
    const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.session.member.id);
    if (!m) { delete req.session.member; return res.redirect("/login"); }
    res.render("mypage-edit", { ...res.locals, title: "내 정보 수정", m, error: null, pwError: null, done: null, hasPassword: hasPw(m), welcome: req.query.welcome === "1" });
  });

  // 정보 수정 — 비밀번호 있는 계정만 현재 비밀번호 재확인(소셜 계정은 세션 인증으로 충분)
  router.post("/mypage/edit", requireMember, verifyCsrf, (req, res) => {
    const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.session.member.id);
    if (!m) { delete req.session.member; return res.redirect("/login"); }
    const editErr = (msg) => res.status(400).render("mypage-edit", { ...res.locals, title: "내 정보 수정", m, error: msg, pwError: null, done: null, hasPassword: hasPw(m), welcome: false });
    if (hasPw(m) && !bcrypt.compareSync(req.body.current || "", m.password_hash)) {
      return editErr("현재 비밀번호가 올바르지 않습니다.");
    }
    // 이메일 변경 — 새 이메일이면 인증(session.emailVerified) 필수 + 중복 검사
    let emailToSet = m.email;
    const newEmail = (req.body.email || "").trim().toLowerCase();
    if (newEmail && newEmail !== m.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return editErr("유효한 이메일을 입력해 주세요.");
      if (req.session.emailVerified !== newEmail) return editErr("새 이메일 인증을 완료해 주셔야 변경됩니다.");
      if (db.prepare("SELECT id FROM members WHERE email = ? AND id <> ?").get(newEmail, m.id)) return editErr("이미 사용 중인 이메일입니다.");
      emailToSet = newEmail;
    }
    const name = (req.body.name || "").trim() || m.name;
    const memberType = MEMBER_TYPES.includes(req.body.member_type) ? req.body.member_type : m.member_type;
    const phone = (req.body.phone || "").replace(/[^0-9]/g, ""); // 숫자만 저장
    const orgName = (req.body.org_name || "").trim() || "도시공동체본부";
    const position = (req.body.position || "").trim();
    const job = (req.body.job || "").trim();
    const interest = (req.body.interest || "").trim();
    const address = (req.body.address || "").trim();
    const addressDetail = (req.body.address_detail || "").trim();
    const education = (req.body.education || "").trim();
    const eduLevels = ["고등학교", "전문학사", "학사", "석사", "박사", "기타"];
    const eduLevel = eduLevels.includes(req.body.edu_level) ? req.body.edu_level : "";
    const major = (req.body.major || "").trim();
    const specialty = (req.body.specialty || "").trim();
    db.prepare("UPDATE members SET email = ?, name = ?, member_type = ?, phone = ?, org_name = ?, position = ?, job = ?, interest = ?, address = ?, address_detail = ?, education = ?, edu_level = ?, major = ?, specialty = ? WHERE id = ?")
      .run(emailToSet, name, memberType, phone, orgName, position, job, interest, address, addressDetail, education, eduLevel, major, specialty, m.id);
    req.session.member.name = name;
    if (emailToSet !== m.email) delete req.session.emailVerified; // 변경 완료 후 인증상태 소거
    const m2 = db.prepare("SELECT * FROM members WHERE id = ?").get(m.id);
    res.render("mypage-edit", { ...res.locals, title: "내 정보 수정", m: m2, error: null, pwError: null, done: "정보가 저장되었습니다.", hasPassword: hasPw(m2), welcome: false });
  });

  // 비밀번호 변경/설정 — 기존 비밀번호가 있으면 현재 비밀번호 확인, 없으면(소셜) 바로 설정
  router.post("/mypage/password", requireMember, verifyCsrf, (req, res) => {
    const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.session.member.id);
    if (!m) { delete req.session.member; return res.redirect("/login"); }
    const cur = req.body.current || "", np = req.body.newpw || "", cf = req.body.confirm || "";
    const back = (pwError, done) => res.render("mypage-edit", { ...res.locals, title: "내 정보 수정", m, error: null, pwError, done, hasPassword: hasPw(m), welcome: false });
    if (hasPw(m) && !bcrypt.compareSync(cur, m.password_hash)) return back("현재 비밀번호가 올바르지 않습니다.", null);
    if (np.length < 8) return back("새 비밀번호는 8자 이상이어야 합니다.", null);
    if (np !== cf) return back("새 비밀번호 확인이 일치하지 않습니다.", null);
    db.prepare("UPDATE members SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(np, 10), m.id);
    const m2 = db.prepare("SELECT * FROM members WHERE id = ?").get(m.id);
    res.render("mypage-edit", { ...res.locals, title: "내 정보 수정", m: m2, error: null, pwError: null, done: hasPw(m) ? "비밀번호가 변경되었습니다." : "비밀번호가 설정되었습니다. 이제 이메일로도 로그인할 수 있습니다.", hasPassword: true, welcome: false });
  });

  return router;
};
