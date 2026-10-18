/* exec.js — 임원 전용 업무관리(회의록 업로드·파싱, AI 업무 정리, 업무 보드) */
"use strict";
const express = require("express");
const multer = require("multer");
const { db } = require("../db");
const meetings = require("../meetings");

const uploadTxt = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /\.txt$/i.test(file.originalname) || file.mimetype === "text/plain"),
});

module.exports = function execRoutes({ verifyCsrf }) {
  const router = express.Router();

  function requireExec(req, res, next) {
    if (req.session && req.session.admin) { req.execName = req.session.admin.username; return next(); }
    if (req.session && req.session.member) {
      const m = db.prepare("SELECT is_exec, name FROM members WHERE id = ?").get(req.session.member.id);
      if (m && m.is_exec) { req.execName = m.name; return next(); }
      return res.status(403).render("message", {
        ...res.locals, title: "임원 전용", heading: "임원 전용 페이지입니다",
        body: "임원으로 승인된 회원만 이용할 수 있습니다. 승인 문의는 사무처(1670-9678)로 연락해 주세요.", backUrl: "/",
      });
    }
    return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
  }

  // 대시보드
  router.get("/", requireExec, (req, res) => {
    res.render("exec-dashboard", {
      ...res.locals, title: "임원 업무관리",
      stats: meetings.stats(), logs: meetings.listLogs().slice(0, 5), tasks: meetings.listTasks().slice(0, 6),
    });
  });

  // 회의록(대화) 목록 + 업로드
  router.get("/meetings", requireExec, (req, res) => {
    res.render("exec-meetings", { ...res.locals, title: "회의록(대화) 관리", logs: meetings.listLogs(), msg: req.query.msg || "", err: req.query.err || "" });
  });
  router.post("/meetings/upload", requireExec, uploadTxt.single("file"), verifyCsrf, (req, res) => {
    try {
      if (!req.file) return res.redirect("/exec/meetings?err=" + encodeURIComponent("카카오톡 .txt 파일을 선택해 주세요."));
      const text = req.file.buffer.toString("utf8");
      const title = (req.body.title || "").trim() || (req.file.originalname || "대화").replace(/\.txt$/i, "");
      const r = meetings.addLog({ title, text, filename: req.file.originalname, uploadedBy: req.execName });
      if (!r.count) { meetings.removeLog(r.logId); return res.redirect("/exec/meetings?err=" + encodeURIComponent("대화 메시지를 찾지 못했습니다. 카카오톡 '대화 내보내기' 원본 .txt 인지 확인해 주세요.")); }
      res.redirect("/exec/meetings/" + r.logId + "?msg=" + encodeURIComponent(r.count + "개 메시지를 저장했습니다. ‘AI로 업무 정리’를 눌러 업무를 추출하세요."));
    } catch (e) {
      res.redirect("/exec/meetings?err=" + encodeURIComponent("업로드 처리 오류: " + e.message));
    }
  });
  router.get("/meetings/:id", requireExec, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const log = meetings.getLog(id);
    if (!log) return res.redirect("/exec/meetings?err=" + encodeURIComponent("회의록을 찾을 수 없습니다."));
    res.render("exec-meeting", { ...res.locals, title: log.title, log, messages: meetings.logMessages(id), msg: req.query.msg || "", err: req.query.err || "" });
  });
  router.post("/meetings/:id/extract", requireExec, verifyCsrf, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const r = await meetings.extractTasksAI(id, req.execName);
      res.redirect("/exec/meetings/" + id + "?msg=" + encodeURIComponent(`AI 정리 완료 — 신규 업무 ${r.created}개, 기존 연결 ${r.linked}개. 업무관리에서 확인하세요.`));
    } catch (e) {
      res.redirect("/exec/meetings/" + id + "?err=" + encodeURIComponent("AI 업무 정리 실패: " + e.message + " (업무관리에서 직접 등록할 수 있습니다)"));
    }
  });
  router.post("/meetings/:id/delete", requireExec, verifyCsrf, (req, res) => {
    meetings.removeLog(parseInt(req.params.id, 10));
    res.redirect("/exec/meetings?msg=" + encodeURIComponent("회의록을 삭제했습니다."));
  });

  // 업무 보드
  router.get("/tasks", requireExec, (req, res) => {
    const edit = req.query.edit ? meetings.getTask(parseInt(req.query.edit, 10)) : null;
    res.render("exec-tasks", {
      ...res.locals, title: "업무관리", STATUSES: meetings.STATUSES,
      tasks: meetings.listTasks(), logs: meetings.listLogs(), edit, msg: req.query.msg || "", err: req.query.err || "",
    });
  });
  router.post("/tasks", requireExec, verifyCsrf, (req, res) => {
    const b = req.body;
    if (!(b.title || "").trim()) return res.redirect("/exec/tasks?err=" + encodeURIComponent("업무명을 입력하세요."));
    if (b.id) { meetings.updateTask(parseInt(b.id, 10), b); res.redirect("/exec/tasks?msg=" + encodeURIComponent("업무를 수정했습니다.")); }
    else { meetings.addTask({ ...b, created_by: req.execName }); res.redirect("/exec/tasks?msg=" + encodeURIComponent("업무를 등록했습니다.")); }
  });
  router.post("/tasks/:id/delete", requireExec, verifyCsrf, (req, res) => {
    meetings.removeTask(parseInt(req.params.id, 10));
    res.redirect("/exec/tasks?msg=" + encodeURIComponent("업무를 삭제했습니다."));
  });

  return router;
};
