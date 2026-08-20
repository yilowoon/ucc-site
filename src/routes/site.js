/* 사이트 라우트: 소개/약관 페이지 · 홈 API · 회원(가입/로그인) */
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db");
const cfg = require("../config");
const { PAGES } = require("../pages");
const KOREA_SIDO = require("../korea-sido.json"); // 전국 시·도 경계 지오메트리

module.exports = function siteRoutes({ verifyCsrf }) {
  const router = express.Router();

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
    const n = db.prepare("SELECT keyword, title FROM newsletter WHERE id = ?").get(id);
    if (!n) return next();
    res.type("image/svg+xml");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(require("../newsletter").buildGenSvg(n.keyword, n.title));
  });
  const nlImg = (v, id) => (v === "gen" ? "/newsletter/gen/" + id + ".svg" : v);
  router.get("/newsletter/:id", (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return next();
    const n = db.prepare("SELECT * FROM newsletter WHERE id = ?").get(id);
    if (!n) return next();
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
      .prepare("SELECT id, title, summary, source, url, image1, image2, created_at FROM newsletter ORDER BY id DESC LIMIT 1")
      .get();
    const genImg = (v, id) => (v === "gen" ? "/newsletter/gen/" + id + ".svg" : v);
    const newsletter = nl ? {
      ...nl, date: cfg.formatDate(nl.created_at),
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

  // ---------- 회원가입 ----------
  // 회원 유형(개인/기업/단체) — 가입 시 등급은 항상 '준회원', 관리자 승인 시 '정회원'
  const MEMBER_TYPES = ["개인회원", "기업회원", "단체회원"];
  router.get("/signup", (req, res) => {
    if (req.session.member) return res.redirect("/");
    res.render("signup", { ...res.locals, title: "회원가입", error: null, form: {} });
  });

  router.post("/signup", verifyCsrf, (req, res) => {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const phone = (req.body.phone || "").replace(/[^0-9]/g, ""); // 숫자만 저장
    const memberType = MEMBER_TYPES.includes(req.body.member_type) ? req.body.member_type : "개인회원";
    const orgName = (req.body.org_name || "").trim();
    const pw = req.body.password || "";
    const confirm = req.body.confirm || "";
    const form = { name, email, phone, member_type: memberType, org_name: orgName };
    const fail = (msg) =>
      res.status(400).render("signup", { ...res.locals, title: "회원가입", error: msg, form });

    if (!name) return fail("이름을 입력해 주세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("유효한 이메일을 입력해 주세요.");
    if ((memberType === "기업회원" || memberType === "단체회원") && !orgName) return fail("기업·단체회원은 기관·단체명을 입력해 주세요.");
    if (pw.length < 8) return fail("비밀번호는 8자 이상이어야 합니다.");
    if (pw !== confirm) return fail("비밀번호 확인이 일치하지 않습니다.");

    const exists = db.prepare("SELECT id FROM members WHERE email = ?").get(email);
    if (exists) return fail("이미 가입된 이메일입니다.");

    const hash = bcrypt.hashSync(pw, 10);
    db.prepare("INSERT INTO members (name, email, phone, member_type, org_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(name, email, phone, memberType, orgName, hash, new Date().toISOString());
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

  router.get("/mypage/edit", requireMember, (req, res) => {
    const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.session.member.id);
    if (!m) { delete req.session.member; return res.redirect("/login"); }
    res.render("mypage-edit", { ...res.locals, title: "내 정보 수정", m, error: null, pwError: null, done: null });
  });

  // 정보 수정 — 현재 비밀번호 재확인(보안 게이트)
  router.post("/mypage/edit", requireMember, verifyCsrf, (req, res) => {
    const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.session.member.id);
    if (!m) { delete req.session.member; return res.redirect("/login"); }
    const view = (extra) => res.render("mypage-edit", { ...res.locals, title: "내 정보 수정", m, error: null, pwError: null, done: null, ...extra });
    if (!bcrypt.compareSync(req.body.current || "", m.password_hash)) {
      return res.status(400).render("mypage-edit", { ...res.locals, title: "내 정보 수정", m, error: "현재 비밀번호가 올바르지 않습니다.", pwError: null, done: null });
    }
    const name = (req.body.name || "").trim() || m.name;
    const phone = (req.body.phone || "").replace(/[^0-9]/g, ""); // 숫자만 저장
    const orgName = (req.body.org_name || "").trim();
    const address = (req.body.address || "").trim();
    const addressDetail = (req.body.address_detail || "").trim();
    const education = (req.body.education || "").trim();
    const eduLevels = ["고등학교", "전문학사", "학사", "석사", "박사", "기타"];
    const eduLevel = eduLevels.includes(req.body.edu_level) ? req.body.edu_level : "";
    const major = (req.body.major || "").trim();
    const specialty = (req.body.specialty || "").trim();
    db.prepare("UPDATE members SET name = ?, phone = ?, org_name = ?, address = ?, address_detail = ?, education = ?, edu_level = ?, major = ?, specialty = ? WHERE id = ?")
      .run(name, phone, orgName, address, addressDetail, education, eduLevel, major, specialty, m.id);
    req.session.member.name = name;
    const m2 = db.prepare("SELECT * FROM members WHERE id = ?").get(m.id);
    res.render("mypage-edit", { ...res.locals, title: "내 정보 수정", m: m2, error: null, pwError: null, done: "정보가 수정되었습니다." });
  });

  // 비밀번호 변경 — 현재 비밀번호 확인 + 새 비밀번호
  router.post("/mypage/password", requireMember, verifyCsrf, (req, res) => {
    const m = db.prepare("SELECT * FROM members WHERE id = ?").get(req.session.member.id);
    if (!m) { delete req.session.member; return res.redirect("/login"); }
    const cur = req.body.current || "", np = req.body.newpw || "", cf = req.body.confirm || "";
    const back = (pwError, done) => res.render("mypage-edit", { ...res.locals, title: "내 정보 수정", m, error: null, pwError, done });
    if (!bcrypt.compareSync(cur, m.password_hash)) return back("현재 비밀번호가 올바르지 않습니다.", null);
    if (np.length < 8) return back("새 비밀번호는 8자 이상이어야 합니다.", null);
    if (np !== cf) return back("새 비밀번호 확인이 일치하지 않습니다.", null);
    db.prepare("UPDATE members SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(np, 10), m.id);
    back(null, "비밀번호가 변경되었습니다.");
  });

  return router;
};
