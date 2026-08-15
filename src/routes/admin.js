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
      req.session.admin = { id: admin.id, username: admin.username };
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
    res.render("admin-dashboard", {
      ...res.locals,
      title: "관리자",
      posts: rows,
      filterBoard: board,
      counts,
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
