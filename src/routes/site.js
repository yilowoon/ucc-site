/* 사이트 라우트: 소개/약관 페이지 · 홈 API · 회원(가입/로그인) */
"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../db");
const cfg = require("../config");
const { PAGES } = require("../pages");

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
  router.get("/business", (req, res) => res.render("biz", { ...res.locals, title: "프로젝트" }));
  router.get("/projects/forum", (req, res) => res.render("forum", { ...res.locals, title: "두잉새롬마당" }));
  router.get("/projects/community", (req, res) => res.render("community", { ...res.locals, title: "커뮤니티모임" }));

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

    res.json({ notices, news });
  });

  // ---------- 회원가입 ----------
  const MEMBER_TYPES = ["개인회원", "기업회원", "단체회원", "준회원"];
  router.get("/signup", (req, res) => {
    if (req.session.member) return res.redirect("/");
    res.render("signup", { ...res.locals, title: "회원가입", error: null, form: {} });
  });

  router.post("/signup", verifyCsrf, (req, res) => {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const phone = (req.body.phone || "").trim();
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
  router.get("/login", (req, res) => {
    if (req.session.member) return res.redirect("/");
    res.render("member-form", {
      ...res.locals, title: "로그인", mode: "login",
      error: null, joined: req.query.joined === "1", form: {},
    });
  });

  router.post("/login", verifyCsrf, (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const pw = req.body.password || "";
    const m = db.prepare("SELECT * FROM members WHERE email = ?").get(email);
    const ok = m && bcrypt.compareSync(pw, m.password_hash);
    if (!ok) {
      return res.status(401).render("member-form", {
        ...res.locals, title: "로그인", mode: "login",
        error: "이메일 또는 비밀번호가 올바르지 않습니다.", joined: false, form: { email },
      });
    }
    req.session.member = { id: m.id, name: m.name };
    res.redirect("/");
  });

  router.post("/logout", verifyCsrf, (req, res) => {
    delete req.session.member;
    res.redirect("/");
  });

  return router;
};
