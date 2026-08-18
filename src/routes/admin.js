/* 관리자 라우트: 로그인 · 글 작성/수정/삭제 · 비밀번호 변경 */
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");

const { db, UPLOAD_DIR } = require("../db");
const cfg = require("../config");

// ---- 업로드 설정 ----
const ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", // 이미지
  ".pdf", ".hwp", ".hwpx", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".zip", ".txt", // 문서
]);
const MAX_FILE = 12 * 1024 * 1024; // 12MB
const MAX_FILES = 12;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(12).toString("hex") + ext;
    cb(null, name);
  },
});
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXT.has(ext)) return cb(null, true);
  const err = new Error("허용되지 않는 파일 형식입니다: " + ext);
  err.status = 400;
  err.publicMessage = "이미지 또는 문서 파일만 업로드할 수 있습니다.";
  cb(err);
}
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE, files: MAX_FILES },
});

// 원본 파일명을 UTF-8로 복원 (multer/latin1 → utf8)
function fixName(name) {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}

module.exports = function adminRoutes({ verifyCsrf }) {
  const router = express.Router();

  function requireAdmin(req, res, next) {
    if (req.session && req.session.admin) return next();
    return res.redirect("/admin/login?next=" + encodeURIComponent(req.originalUrl));
  }

  // multer 오류를 친절히 렌더
  function handleUpload(field) {
    return (req, res, next) => {
      upload.array(field, MAX_FILES)(req, res, (err) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") {
            err.status = 413;
            err.publicMessage = "파일 크기는 최대 12MB까지 가능합니다.";
          }
          return next(err);
        }
        next();
      });
    };
  }

  // ---------- 로그인 ----------
  router.get("/login", (req, res) => {
    if (req.session.admin) return res.redirect("/admin");
    res.render("admin-login", {
      ...res.locals,
      title: "관리자 로그인",
      error: null,
      next: req.query.next || "/admin",
    });
  });

  router.post("/login", verifyCsrf, (req, res) => {
    const { username, password } = req.body;
    const nextUrl = safeNext(req.body.next);
    const admin = db
      .prepare("SELECT * FROM admins WHERE username = ?")
      .get((username || "").trim());
    const ok = admin && bcrypt.compareSync(password || "", admin.password_hash);
    if (!ok) {
      return res.status(401).render("admin-login", {
        ...res.locals,
        title: "관리자 로그인",
        error: "아이디 또는 비밀번호가 올바르지 않습니다.",
        next: nextUrl,
      });
    }
    req.session.regenerate((e) => {
      if (e) {
        console.error(e);
        return res.status(500).render("admin-login", {
          ...res.locals,
          title: "관리자 로그인",
          error: "로그인 처리 중 오류가 발생했습니다.",
          next: nextUrl,
        });
      }
      req.session.admin = { id: admin.id, username: admin.username, loginAt: Date.now() };
      req.session.csrf = crypto.randomBytes(16).toString("hex");
      res.redirect(nextUrl);
    });
  });

  router.post("/logout", verifyCsrf, (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  // ---------- 대시보드 ----------
  router.get("/", requireAdmin, (req, res) => {
    const board = cfg.isBoard(req.query.board) ? req.query.board : "all";
    let rows;
    if (board === "all") {
      rows = db
        .prepare(
          `SELECT p.*, (SELECT COUNT(*) FROM attachments a WHERE a.post_id = p.id) AS attach_count
             FROM posts p ORDER BY p.id DESC LIMIT 100`
        )
        .all();
    } else {
      rows = db
        .prepare(
          `SELECT p.*, (SELECT COUNT(*) FROM attachments a WHERE a.post_id = p.id) AS attach_count
             FROM posts p WHERE board = ? ORDER BY p.id DESC LIMIT 100`
        )
        .all(board);
    }
    const counts = {};
    for (const k of cfg.BOARD_KEYS) {
      counts[k] = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE board = ?").get(k).n;
    }
    const stats = {
      postsTotal: db.prepare("SELECT COUNT(*) AS n FROM posts").get().n,
      contactsNew: db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE status = '신규'").get().n,
      contactsTotal: db.prepare("SELECT COUNT(*) AS n FROM contacts").get().n,
      members: db.prepare("SELECT COUNT(*) AS n FROM members").get().n,
      applications: db.prepare("SELECT COUNT(*) AS n FROM edu_applications").get().n,
    };
    res.render("admin-dashboard", {
      ...res.locals,
      title: "관리자",
      posts: rows,
      filterBoard: board,
      counts,
      stats,
    });
  });

  // ---------- 글쓰기 ----------
  router.get("/write", requireAdmin, (req, res) => {
    const board = cfg.isBoard(req.query.board) ? req.query.board : "notice";
    res.render("admin-form", {
      ...res.locals,
      title: "새 글 작성",
      mode: "create",
      board,
      post: { title: "", content: "", pinned: 0, author: "관리자" },
      attachments: [],
    });
  });

  router.post("/write", requireAdmin, handleUpload("files"), verifyCsrf, (req, res, next) => {
    try {
      const board = cfg.isBoard(req.body.board) ? req.body.board : "notice";
      const title = (req.body.title || "").trim();
      const content = req.body.content || "";
      const author = (req.body.author || "관리자").trim() || "관리자";
      const pinned = req.body.pinned ? 1 : 0;
      if (!title) {
        cleanupFiles(req.files);
        const err = new Error("제목 필요");
        err.status = 400;
        err.publicMessage = "제목을 입력해 주세요.";
        return next(err);
      }
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO posts (board, title, content, author, pinned, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(board, title, content, author, pinned, now, now);
      const postId = info.lastInsertRowid;
      insertAttachments(postId, req.files);
      res.redirect(`/board/${board}/${postId}`);
    } catch (e) {
      cleanupFiles(req.files);
      next(e);
    }
  });

  // ---------- 수정 ----------
  router.get("/edit/:id", requireAdmin, (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
    if (!post) return next();
    const attachments = db
      .prepare("SELECT * FROM attachments WHERE post_id = ? ORDER BY sort, id")
      .all(id);
    res.render("admin-form", {
      ...res.locals,
      title: "글 수정",
      mode: "edit",
      board: post.board,
      post,
      attachments,
    });
  });

  router.post("/edit/:id", requireAdmin, handleUpload("files"), verifyCsrf, (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
      if (!post) {
        cleanupFiles(req.files);
        return next();
      }
      const board = cfg.isBoard(req.body.board) ? req.body.board : post.board;
      const title = (req.body.title || "").trim();
      const content = req.body.content || "";
      const author = (req.body.author || "관리자").trim() || "관리자";
      const pinned = req.body.pinned ? 1 : 0;
      if (!title) {
        cleanupFiles(req.files);
        const err = new Error("제목 필요");
        err.status = 400;
        err.publicMessage = "제목을 입력해 주세요.";
        return next(err);
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE posts SET board = ?, title = ?, content = ?, author = ?, pinned = ?, updated_at = ? WHERE id = ?`
      ).run(board, title, content, author, pinned, now, id);

      // 삭제 요청된 기존 첨부 제거
      let removeIds = req.body.remove_attachment;
      if (removeIds) {
        if (!Array.isArray(removeIds)) removeIds = [removeIds];
        for (const rid of removeIds) {
          const a = db.prepare("SELECT * FROM attachments WHERE id = ? AND post_id = ?").get(parseInt(rid, 10), id);
          if (a) {
            safeUnlink(a.filename);
            db.prepare("DELETE FROM attachments WHERE id = ?").run(a.id);
          }
        }
      }
      insertAttachments(id, req.files);
      res.redirect(`/board/${board}/${id}`);
    } catch (e) {
      cleanupFiles(req.files);
      next(e);
    }
  });

  // ---------- 삭제 ----------
  router.post("/delete/:id", requireAdmin, verifyCsrf, (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
    if (!post) return next();
    const atts = db.prepare("SELECT filename FROM attachments WHERE post_id = ?").all(id);
    db.prepare("DELETE FROM posts WHERE id = ?").run(id); // CASCADE로 attachments 행 삭제
    for (const a of atts) safeUnlink(a.filename);
    res.redirect(`/board/${post.board}`);
  });

  // ---------- 비밀번호 변경 ----------
  router.get("/password", requireAdmin, (req, res) => {
    res.render("admin-password", { ...res.locals, title: "비밀번호 변경", error: null, done: false });
  });

  router.post("/password", requireAdmin, verifyCsrf, (req, res) => {
    const { current, next: newpw, confirm } = req.body;
    const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.session.admin.id);
    const render = (opts) =>
      res.render("admin-password", { ...res.locals, title: "비밀번호 변경", done: false, error: null, ...opts });
    if (!admin || !bcrypt.compareSync(current || "", admin.password_hash)) {
      return render({ error: "현재 비밀번호가 올바르지 않습니다." });
    }
    if (!newpw || newpw.length < 8) {
      return render({ error: "새 비밀번호는 8자 이상이어야 합니다." });
    }
    if (newpw !== confirm) {
      return render({ error: "새 비밀번호 확인이 일치하지 않습니다." });
    }
    const hash = bcrypt.hashSync(newpw, 10);
    db.prepare("UPDATE admins SET password_hash = ? WHERE id = ?").run(hash, admin.id);
    res.render("admin-password", { ...res.locals, title: "비밀번호 변경", error: null, done: true });
  });

  // ---------- 교육일정(캘린더) 관리 ----------
  router.get("/calendar", requireAdmin, (req, res) => {
    const events = db.prepare("SELECT * FROM edu_events ORDER BY event_date DESC, id DESC LIMIT 200").all();
    res.render("admin-calendar", { ...res.locals, title: "교육일정 관리", events, error: null });
  });
  router.post("/calendar", requireAdmin, verifyCsrf, (req, res, next) => {
    const title = (req.body.title || "").trim();
    const date = (req.body.event_date || "").trim();
    const category = (req.body.category || "기타").trim() || "기타";
    const memo = (req.body.memo || "").trim();
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const events = db.prepare("SELECT * FROM edu_events ORDER BY event_date DESC, id DESC LIMIT 200").all();
      return res.status(400).render("admin-calendar", { ...res.locals, title: "교육일정 관리", events, error: "제목과 날짜(YYYY-MM-DD)를 정확히 입력해 주세요." });
    }
    db.prepare("INSERT INTO edu_events (title, event_date, category, memo, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(title, date, category, memo, new Date().toISOString());
    res.redirect("/admin/calendar");
  });
  router.post("/calendar/delete/:id", requireAdmin, verifyCsrf, (req, res) => {
    db.prepare("DELETE FROM edu_events WHERE id = ?").run(parseInt(req.params.id, 10));
    res.redirect("/admin/calendar");
  });

  // ---------- 교육신청 내역 ----------
  router.get("/applications", requireAdmin, (req, res) => {
    const apps = db.prepare("SELECT * FROM edu_applications ORDER BY id DESC LIMIT 300").all();
    res.render("admin-applications", { ...res.locals, title: "교육신청 내역", apps });
  });

  // ---------- 문의 관리 ----------
  const CONTACT_STATUS = ["신규", "확인", "완료"];
  router.get("/contacts", requireAdmin, (req, res) => {
    const filter = CONTACT_STATUS.includes(req.query.status) ? req.query.status : "all";
    const contacts = filter === "all"
      ? db.prepare("SELECT * FROM contacts ORDER BY id DESC LIMIT 500").all()
      : db.prepare("SELECT * FROM contacts WHERE status = ? ORDER BY id DESC LIMIT 500").all(filter);
    const counts = {
      all: db.prepare("SELECT COUNT(*) AS n FROM contacts").get().n,
      신규: db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE status = '신규'").get().n,
      확인: db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE status = '확인'").get().n,
      완료: db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE status = '완료'").get().n,
    };
    res.render("admin-contacts", { ...res.locals, title: "문의 관리", contacts, filter, counts, statuses: CONTACT_STATUS });
  });
  router.post("/contacts/:id/status", requireAdmin, verifyCsrf, (req, res) => {
    const status = CONTACT_STATUS.includes(req.body.status) ? req.body.status : "신규";
    db.prepare("UPDATE contacts SET status = ? WHERE id = ?").run(status, parseInt(req.params.id, 10));
    res.redirect("/admin/contacts" + (CONTACT_STATUS.includes(req.body.back) ? "?status=" + encodeURIComponent(req.body.back) : ""));
  });
  router.post("/contacts/:id/delete", requireAdmin, verifyCsrf, (req, res) => {
    db.prepare("DELETE FROM contacts WHERE id = ?").run(parseInt(req.params.id, 10));
    res.redirect("/admin/contacts");
  });

  // ---------- 회원 관리 ----------
  const MEMBER_COLS = "id, name, email, phone, member_type, org_name, grade, fee_paid, confirmed_at, created_at";
  router.get("/members", requireAdmin, (req, res) => {
    const q = (req.query.q || "").trim();
    const grade = ["준회원", "정회원"].includes(req.query.grade) ? req.query.grade : "";
    const where = [], params = [];
    if (q) {
      where.push("(name LIKE ? OR email LIKE ? OR org_name LIKE ?)");
      const like = "%" + q + "%"; params.push(like, like, like);
    }
    if (grade) { where.push("grade = ?"); params.push(grade); }
    const sql = "SELECT " + MEMBER_COLS + " FROM members" +
      (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY id DESC LIMIT 1000";
    const members = db.prepare(sql).all(...params);

    const byType = {};
    for (const t of ["개인회원", "기업회원", "단체회원"]) {
      byType[t] = db.prepare("SELECT COUNT(*) AS n FROM members WHERE member_type = ?").get(t).n;
    }
    const byGrade = {};
    for (const g of ["준회원", "정회원"]) {
      byGrade[g] = db.prepare("SELECT COUNT(*) AS n FROM members WHERE grade = ?").get(g).n;
    }
    const feePaid = db.prepare("SELECT COUNT(*) AS n FROM members WHERE fee_paid = 1").get().n;
    res.render("admin-members", { ...res.locals, title: "회원 관리", members, q, grade, byType, byGrade, feePaid });
  });

  // 준회원 → 정회원 승인 (회비 납부 확인 필수)
  router.post("/members/:id/approve", requireAdmin, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const feeConfirmed = req.body.fee_confirm === "1";
    const back = "/admin/members" + (req.body.q ? "?q=" + encodeURIComponent(req.body.q) : "");
    if (!feeConfirmed) {
      // 회비 납부 확인 없이는 승인 불가 — 강화된 체크
      return res.status(400).render("message", {
        ...res.locals, title: "승인 불가",
        heading: "회비 납부 확인이 필요합니다",
        body: "정회원 승인은 회비 납부 여부를 확인한 후에만 가능합니다. ‘회비 납부 확인’에 체크한 뒤 다시 승인해 주세요.",
        backUrl: back,
      });
    }
    db.prepare("UPDATE members SET grade = '정회원', fee_paid = 1, confirmed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    res.redirect(back);
  });

  // 정회원 → 준회원 전환 (회비 미납 등)
  router.post("/members/:id/revert", requireAdmin, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const back = "/admin/members" + (req.body.q ? "?q=" + encodeURIComponent(req.body.q) : "");
    db.prepare("UPDATE members SET grade = '준회원', confirmed_at = '' WHERE id = ?").run(id);
    res.redirect(back);
  });

  // 회비 납부 여부 토글
  router.post("/members/:id/fee", requireAdmin, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const back = "/admin/members" + (req.body.q ? "?q=" + encodeURIComponent(req.body.q) : "");
    const cur = db.prepare("SELECT fee_paid FROM members WHERE id = ?").get(id);
    if (cur) db.prepare("UPDATE members SET fee_paid = ? WHERE id = ?").run(cur.fee_paid ? 0 : 1, id);
    res.redirect(back);
  });

  router.post("/members/:id/delete", requireAdmin, verifyCsrf, (req, res) => {
    db.prepare("DELETE FROM members WHERE id = ?").run(parseInt(req.params.id, 10));
    const back = "/admin/members" + (req.body.q ? "?q=" + encodeURIComponent(req.body.q) : "");
    res.redirect(back);
  });

  // ---------- 트래픽 통계 ----------
  const kstDay = (offset = 0) =>
    new Date(Date.now() + 9 * 3600 * 1000 - offset * 86400 * 1000).toISOString().slice(0, 10);
  router.get("/stats", requireAdmin, (req, res) => {
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    const today = kstDay(0);
    // 순방문자(UV) = 고유 visitor 수 (빈 식별자 제외)
    const uvOn = (day) => n("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE day = ? AND visitor <> ''", day);
    const uvSince = (day) => n("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE day >= ? AND visitor <> ''", day);
    const uvBetween = (a, b) => n("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE day BETWEEN ? AND ? AND visitor <> ''", a, b);
    const uvMonth = (ym) => n("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE substr(day,1,7) = ? AND visitor <> ''", ym);

    const summary = {
      todayUV: uvOn(today),
      weekUV: uvSince(kstDay(6)),
      monthUV: uvSince(kstDay(29)),
      totalUV: n("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE visitor <> ''"),
      totalPV: n("SELECT COUNT(*) AS n FROM visits"),
    };

    // 기간별 UV 시리즈 (주/월은 기간 내 고유 방문자 — 합산 아님)
    const daily = [], weekly = [], monthly = [];
    for (let i = 29; i >= 0; i--) { const d = kstDay(i); daily.push({ label: d.slice(5).replace("-", "/"), v: uvOn(d) }); }
    for (let w = 11; w >= 0; w--) { const s = kstDay(w * 7 + 6), e = kstDay(w * 7); weekly.push({ label: s.slice(5).replace("-", "/"), v: uvBetween(s, e) }); }
    { const t = new Date(Date.now() + 9 * 3600 * 1000);
      for (let m = 11; m >= 0; m--) { const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - m, 1));
        monthly.push({ label: (d.getUTCMonth() + 1) + "월", v: uvMonth(d.toISOString().slice(0, 7)) }); } }

    const refRows = db.prepare("SELECT source, COUNT(DISTINCT visitor) AS c FROM visits WHERE source != '내부' AND visitor <> '' GROUP BY source ORDER BY c DESC").all();
    const pageRows = db.prepare("SELECT path, COUNT(DISTINCT visitor) AS c FROM visits WHERE visitor <> '' GROUP BY path ORDER BY c DESC LIMIT 8").all();
    const devRows = db.prepare("SELECT device, COUNT(DISTINCT visitor) AS c FROM visits WHERE visitor <> '' GROUP BY device").all();
    const since = db.prepare("SELECT MIN(day) AS m FROM visits").get().m;
    res.render("admin-stats", { ...res.locals, title: "트래픽 통계", summary, daily, weekly, monthly, refRows, pageRows, devRows, since, today });
  });

  // ---------- 햇빛소득마을 지역 현황 관리 ----------
  const SOLAR_STATUSES = ["준비중", "추진중", "운영중"];
  router.get("/solar", requireAdmin, (req, res) => {
    const regions = db.prepare("SELECT * FROM solar_regions ORDER BY sort, code").all();
    res.render("admin-solar", { ...res.locals, title: "햇빛소득마을 관리", regions, statuses: SOLAR_STATUSES, saved: req.query.saved || "" });
  });
  router.post("/solar/:code", requireAdmin, verifyCsrf, (req, res, next) => {
    const row = db.prepare("SELECT code FROM solar_regions WHERE code = ?").get(req.params.code);
    if (!row) return next();
    const status = SOLAR_STATUSES.includes(req.body.status) ? req.body.status : "준비중";
    const villages = Math.max(0, parseInt(req.body.villages, 10) || 0);
    const households = Math.max(0, parseInt(req.body.households, 10) || 0);
    const capacity = Math.max(0, parseFloat(req.body.capacity) || 0);
    const summary = (req.body.summary || "").trim();
    const body = (req.body.body || "").trim();
    db.prepare("UPDATE solar_regions SET status=?, villages=?, households=?, capacity=?, summary=?, body=?, updated_at=? WHERE code=?")
      .run(status, villages, households, capacity, summary, body, new Date().toISOString(), req.params.code);
    res.redirect("/admin/solar?saved=" + encodeURIComponent(req.params.code));
  });

  // ---- 헬퍼 ----
  function insertAttachments(postId, files) {
    if (!files || !files.length) return;
    const stmt = db.prepare(
      `INSERT INTO attachments (post_id, filename, original, mimetype, size, sort)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    files.forEach((f, i) => {
      stmt.run(postId, f.filename, fixName(f.originalname), f.mimetype, f.size, i);
    });
  }

  return router;
};

// ---- 파일 유틸 ----
function safeUnlink(filename) {
  if (!filename) return;
  const p = path.join(UPLOAD_DIR, path.basename(filename));
  fs.unlink(p, () => {});
}
function cleanupFiles(files) {
  if (!files) return;
  for (const f of files) safeUnlink(f.filename);
}
function safeNext(next) {
  // 오픈 리다이렉트 방지: 사이트 내부 경로만 허용
  if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/admin";
}
