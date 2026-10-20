/* exec.js — 임원 전용 업무관리(회의록 업로드·파싱, AI 업무 정리, 업무 보드) */
"use strict";
const express = require("express");
const multer = require("multer");
const { db } = require("../db");
const meetings = require("../meetings");
const kakao = require("../kakao");

const uploadTxt = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /\.txt$/i.test(file.originalname) || file.mimetype === "text/plain"),
});

module.exports = function execRoutes({ verifyCsrf }) {
  const router = express.Router();

  // /exec 및 모든 하위 페이지 공통 OG(링크 미리보기) 메타
  router.use((req, res, next) => {
    res.locals.ogImage = "/img/og-exec.png?v=1";
    res.locals.ogTitle = "업무관리 현황 | 사단법인 도시공동체본부";
    res.locals.ogDescription = "임원 업무의 진행·이슈·담당을 단계별 진행률과 우선순위로 체계적으로 관리합니다. (임원 전용)";
    next();
  });

  function requireExec(req, res, next) {
    if (req.session && req.session.admin) { req.execName = req.session.admin.username; return next(); }
    if (req.session && req.session.member) {
      const m = db.prepare("SELECT is_exec, name FROM members WHERE id = ?").get(req.session.member.id);
      if (m && m.is_exec) {
        req.execName = m.name;
        req.execMemberId = req.session.member.id;
        // 임원이 업무관리 페이지를 '확인'한 시각 기록(참여도) — 조회(GET) 시
        if (req.method === "GET") {
          try { db.prepare("UPDATE members SET exec_seen_at = ? WHERE id = ?").run(new Date().toISOString(), req.session.member.id); } catch (_) {}
        }
        return next();
      }
    }
    // 비인가(크롤러·비로그인·일반회원): GET은 OG를 포함한 공개 게이트(200)를 렌더 → 링크 미리보기 노출
    if (req.method === "GET") {
      return res.status(200).render("exec-gate", {
        ...res.locals, title: "업무관리",
        signedIn: !!(req.session && req.session.member),
        ogUrl: (res.locals.baseUrl || "") + req.originalUrl,
      });
    }
    if (req.session && req.session.member) {
      return res.status(403).render("message", {
        ...res.locals, title: "임원 전용", heading: "임원 전용 페이지입니다",
        body: "임원으로 승인된 회원만 이용할 수 있습니다. 승인 문의는 사무처(1670-9678)로 연락해 주세요.", backUrl: "/",
      });
    }
    return res.redirect("/login?next=" + encodeURIComponent(req.originalUrl));
  }

  // 대시보드
  router.get("/", requireExec, (req, res) => {
    const d = new Date();
    const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    const today = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${wd})`;
    res.render("exec-dashboard", {
      ...res.locals, title: "임원 업무관리", today,
      stats: meetings.stats(), logs: meetings.listLogs().slice(0, 8), tasks: meetings.listTasks().slice(0, 12),
      pendingIds: meetings.pendingTaskIdSet(), pendingCount: meetings.pendingCount(),
      execs: db.prepare("SELECT id, name, org_name, position, exec_seen_at FROM members WHERE is_exec = 1 ORDER BY (exec_seen_at = '') ASC, exec_seen_at DESC, name ASC").all(),
      viewerId: req.execMemberId || 0,
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
    res.render("exec-meeting", {
      ...res.locals, title: log.title, log,
      messages: meetings.logMessages(id),
      newCount: meetings.newMessages(id).length,     // 이번 분석 대상(이전 분석 제외)
      watermark: meetings.getWatermark(),
      wiki: meetings.parseWiki(log.wiki),             // 청킹(wiki)
      proposals: meetings.pendingProposalsForLog(id), // 생성된 제안
      taskById: (tid) => meetings.getTask(tid),
      pendingCount: meetings.pendingCount(),
      msg: req.query.msg || "", err: req.query.err || "",
    });
  });
  router.post("/meetings/:id/extract", requireExec, verifyCsrf, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      const r = await meetings.analyzeMeeting(id, req.execName);
      if (r.skipped) {
        return res.redirect("/exec/meetings/" + id + "?msg=" + encodeURIComponent(r.message));
      }
      res.redirect("/exec/meetings/" + id + "?msg=" + encodeURIComponent(
        `분석 완료 — 신규 대화 ${r.newCount}건에서 업무 제안 ${r.proposals}개(기존 매칭 ${r.matched}개)를 만들었습니다. 아래에서 확인 후 ‘업무 보드’에서 일괄 반영하세요.`));
    } catch (e) {
      res.redirect("/exec/meetings/" + id + "?err=" + encodeURIComponent("대화 분석 실패: " + e.message + " (업무 보드에서 직접 등록할 수 있습니다)"));
    }
  });
  router.post("/meetings/:id/send-kakao", requireExec, verifyCsrf, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
      if (!meetings.getLog(id)) throw new Error("회의록을 찾을 수 없습니다.");
      if (!kakao.isConnected()) throw new Error("카카오톡이 연결되어 있지 않습니다. 관리자 → ‘카카오 자동발송’에서 ‘카카오 연결’을 먼저 진행해 주세요.");
      const rep = meetings.buildKakaoReport(id);
      const parts = await kakao.sendToMe(rep.text, rep.linkUrl);
      res.redirect("/exec/meetings/" + id + "?msg=" + encodeURIComponent(
        "카카오톡으로 발송했습니다(" + parts + "통). 메시지의 ‘자세히 보기’를 누르면 이 회의 내용으로 이동합니다."));
    } catch (e) {
      res.redirect("/exec/meetings/" + id + "?err=" + encodeURIComponent("카카오톡 발송 실패: " + e.message));
    }
  });
  router.post("/meetings/:id/delete", requireExec, verifyCsrf, (req, res) => {
    meetings.removeLog(parseInt(req.params.id, 10));
    res.redirect("/exec/meetings?msg=" + encodeURIComponent("회의록을 삭제했습니다."));
  });

  // 업무 보드
  router.get("/tasks", requireExec, (req, res) => {
    const edit = req.query.edit ? meetings.getTask(parseInt(req.query.edit, 10)) : null;
    const pendingTaskIds = meetings.pendingTaskIdSet();
    res.render("exec-tasks", {
      ...res.locals, title: "업무관리", STATUSES: meetings.STATUSES, PRIORITIES: meetings.PRIORITIES,
      tasks: meetings.listTasks(), logs: meetings.listLogs(), edit,
      openId: parseInt(req.query.open, 10) || 0, parseSteps: meetings.parseSteps,
      pendingIds: pendingTaskIds, pendingCount: meetings.pendingCount(),
      newTaskProposals: meetings.pendingProposals().filter((p) => !p.task_id).length,
      msg: req.query.msg || "", err: req.query.err || "",
    });
  });
  // 처리 후 해당 업무가 펼쳐진 채 유지되도록 open 앵커로 리다이렉트
  const backToTask = (id, msg) => "/exec/tasks?open=" + id + "&msg=" + encodeURIComponent(msg) + "#task-" + id;
  const backToTaskErr = (id, err) => "/exec/tasks?open=" + id + "&err=" + encodeURIComponent(err) + "#task-" + id;
  router.post("/tasks", requireExec, verifyCsrf, (req, res) => {
    const b = req.body;
    if (!(b.title || "").trim()) return res.redirect("/exec/tasks?err=" + encodeURIComponent("업무명을 입력하세요."));
    if (b.id) { const id = parseInt(b.id, 10); meetings.updateTask(id, b); res.redirect(backToTask(id, "업무를 수정했습니다.")); }
    else { const id = meetings.addTask({ ...b, created_by: req.execName }); res.redirect(backToTask(id, "업무를 등록했습니다.")); }
  });
  router.post("/tasks/:id/progress", requireExec, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const note = (req.body.note || "").trim();
    if (!meetings.getTask(id)) return res.redirect("/exec/tasks?err=" + encodeURIComponent("업무를 찾을 수 없습니다."));
    if (!note) return res.redirect(backToTaskErr(id, "추가할 내용을 입력하세요."));
    meetings.appendTaskProgress(id, note, req.execName);
    res.redirect(backToTask(id, "진행 상황을 업데이트했습니다."));
  });
  // 대화 분석 제안 → 주요업무에 일괄 반영
  router.post("/tasks/apply-updates", requireExec, verifyCsrf, (req, res) => {
    try {
      const r = meetings.applyAllProposals(req.execName);
      if (!r.total) return res.redirect("/exec/tasks?msg=" + encodeURIComponent("반영할 업데이트가 없습니다."));
      res.redirect("/exec/tasks?msg=" + encodeURIComponent(
        `대화 분석 내역을 일괄 반영했습니다 — 기존 업무 ${r.updated}건 수정, 신규 ${r.added}건 추가.`));
    } catch (e) {
      res.redirect("/exec/tasks?err=" + encodeURIComponent("일괄 반영 실패: " + e.message));
    }
  });
  router.post("/tasks/discard-updates", requireExec, verifyCsrf, (req, res) => {
    meetings.clearPendingProposals();
    res.redirect("/exec/tasks?msg=" + encodeURIComponent("대기 중인 업데이트 제안을 모두 비웠습니다."));
  });
  router.post("/tasks/:id/step/toggle", requireExec, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const idx = parseInt(req.body.idx, 10);
    if (!meetings.getTask(id)) return res.redirect("/exec/tasks?err=" + encodeURIComponent("업무를 찾을 수 없습니다."));
    if (isNaN(idx)) return res.redirect(backToTaskErr(id, "단계 정보가 올바르지 않습니다."));
    meetings.toggleStep(id, idx);
    res.redirect(backToTask(id, "단계 상태를 변경했습니다. 진행률이 다시 계산되었습니다."));
  });
  router.post("/tasks/:id/status", requireExec, verifyCsrf, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const status = (req.body.status || "").trim();
    if (!meetings.getTask(id)) return res.redirect("/exec/tasks?err=" + encodeURIComponent("업무를 찾을 수 없습니다."));
    if (!meetings.STATUSES.includes(status)) return res.redirect(backToTaskErr(id, "상태값이 올바르지 않습니다."));
    meetings.setTaskStatus(id, status);
    const note = status === "완료" ? "업무를 완료 처리했습니다." : ("업무 상태를 ‘" + status + "’(으)로 변경했습니다.");
    res.redirect(backToTask(id, note));
  });
  router.post("/tasks/:id/delete", requireExec, verifyCsrf, (req, res) => {
    meetings.removeTask(parseInt(req.params.id, 10));
    res.redirect("/exec/tasks?msg=" + encodeURIComponent("업무를 삭제했습니다."));
  });

  return router;
};
