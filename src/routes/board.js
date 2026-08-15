/* 공개 게시판 라우트: 목록 · 상세 */
"use strict";

const express = require("express");
const { db } = require("../db");
const cfg = require("../config");

const PER_PAGE = 10;

module.exports = function boardRoutes() {
  const router = express.Router();

  // 첨부파일 다운로드 (비이미지 파일은 강제 다운로드)
  router.get("/download/:id", (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return next();
    const a = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id);
    if (!a) return next();
    const path = require("path");
    const { UPLOAD_DIR } = require("../db");
    res.download(path.join(UPLOAD_DIR, a.filename), a.original);
  });

  // 목록
  router.get("/:board", (req, res, next) => {
    const board = req.params.board;
    if (!cfg.isBoard(board)) return next();

    const meta = cfg.BOARDS[board];
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const q = (req.query.q || "").trim();
    const offset = (page - 1) * PER_PAGE;

    let where = "board = ?";
    const params = [board];
    if (q) {
      where += " AND (title LIKE ? OR content LIKE ?)";
      params.push("%" + q + "%", "%" + q + "%");
    }

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM posts WHERE ${where}`)
      .get(...params).n;
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

    const rows = db
      .prepare(
        `SELECT p.id, p.title, p.author, p.views, p.pinned, p.created_at,
                (SELECT filename FROM attachments a WHERE a.post_id = p.id ORDER BY sort, id LIMIT 1) AS thumb,
                (SELECT COUNT(*) FROM attachments a WHERE a.post_id = p.id) AS attach_count
           FROM posts p
          WHERE ${where}
          ORDER BY p.pinned DESC, p.id DESC
          LIMIT ? OFFSET ?`
      )
      .all(...params, PER_PAGE, offset);

    res.render("board-list", {
      ...res.locals,
      title: meta.name,
      currentBoard: board,
      meta,
      posts: rows,
      page,
      totalPages,
      total,
      q,
      perPage: PER_PAGE,
    });
  });

  // 상세
  router.get("/:board/:id", (req, res, next) => {
    const board = req.params.board;
    const id = parseInt(req.params.id, 10);
    if (!cfg.isBoard(board) || !id) return next();

    const post = db
      .prepare("SELECT * FROM posts WHERE id = ? AND board = ?")
      .get(id, board);
    if (!post) return next();

    // 조회수 증가 (관리자 열람은 제외)
    if (!(req.session && req.session.admin)) {
      db.prepare("UPDATE posts SET views = views + 1 WHERE id = ?").run(id);
      post.views += 1;
    }

    const attachments = db
      .prepare("SELECT * FROM attachments WHERE post_id = ? ORDER BY sort, id")
      .all(id);

    const isImage = (a) => /^image\//.test(a.mimetype);
    const images = attachments.filter(isImage);
    const files = attachments.filter((a) => !isImage(a));

    // 이전 / 다음 글
    const prev = db
      .prepare(
        "SELECT id, title FROM posts WHERE board = ? AND id < ? ORDER BY id DESC LIMIT 1"
      )
      .get(board, id);
    const next_ = db
      .prepare(
        "SELECT id, title FROM posts WHERE board = ? AND id > ? ORDER BY id ASC LIMIT 1"
      )
      .get(board, id);

    res.render("board-post", {
      ...res.locals,
      title: post.title,
      currentBoard: board,
      meta: cfg.BOARDS[board],
      post,
      images,
      files,
      prev,
      next: next_,
      backPage: parseInt(req.query.page, 10) || 1,
    });
  });

  return router;
};
