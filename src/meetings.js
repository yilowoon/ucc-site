/* meetings.js — 임원 업무관리: 회의록(카카오톡 대화)·업무(task) 데이터 + AI 정리 */
"use strict";
const { db } = require("./db");
const kakao = require("./kakaoparse");

const STATUSES = ["대기", "진행중", "보류", "이슈", "완료"];

/* ---------- 회의록(대화 로그) ---------- */
function addLog({ title, text, filename, uploadedBy }) {
  const parsed = kakao.parse(text);
  const now = new Date().toISOString();
  const info = db.prepare(
    "INSERT INTO meeting_logs (title, period_from, period_to, msg_count, participants, filename, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(String(title || "제목 없는 대화").slice(0, 120), parsed.from, parsed.to, parsed.messages.length,
        parsed.participants.join(", ").slice(0, 400), String(filename || "").slice(0, 200), uploadedBy || "", now);
  const logId = info.lastInsertRowid;
  const ins = db.prepare("INSERT INTO meeting_messages (log_id, seq, msg_at, sender, content) VALUES (?,?,?,?,?)");
  try { db.exec("BEGIN"); for (const m of parsed.messages) ins.run(logId, m.seq, m.msg_at, m.sender.slice(0, 80), m.content); db.exec("COMMIT"); }
  catch (e) { try { db.exec("ROLLBACK"); } catch (_) {} throw e; }
  return { logId, count: parsed.messages.length, participants: parsed.participants };
}
function listLogs() {
  return db.prepare("SELECT * FROM meeting_logs ORDER BY id DESC").all();
}
function getLog(id) { return db.prepare("SELECT * FROM meeting_logs WHERE id = ?").get(id); }
function logMessages(id) { return db.prepare("SELECT * FROM meeting_messages WHERE log_id = ? ORDER BY seq").all(id); }
function removeLog(id) {
  db.prepare("DELETE FROM meeting_messages WHERE log_id = ?").run(id);
  db.prepare("DELETE FROM meeting_logs WHERE id = ?").run(id);
}
function setLogSummary(id, summary) { db.prepare("UPDATE meeting_logs SET summary = ? WHERE id = ?").run(String(summary || "").slice(0, 4000), id); }

/* ---------- 업무(task) ---------- */
function listTasks() {
  const order = { "이슈": 0, "진행중": 1, "대기": 2, "보류": 3, "완료": 4 };
  return db.prepare("SELECT * FROM tasks ORDER BY sort_order, id DESC").all()
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
}
function getTask(id) { return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id); }
const normDate = (v) => { const m = String(v || "").match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : ""; };

/* ----- 진행 단계(steps) ----- */
function parseSteps(v) {
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a.filter((x) => x && x.label != null)
      .map((x) => ({ label: String(x.label || "").slice(0, 200), done: !!x.done })) : [];
  } catch (_) { return []; }
}
function rateFromSteps(steps) {
  if (!steps || !steps.length) return 0;
  return Math.round((steps.filter((s0) => s0.done).length / steps.length) * 100);
}
function stepsToJson(steps) {
  return JSON.stringify((steps || []).map((s0) => ({ label: String(s0.label || "").slice(0, 200), done: !!s0.done })));
}
/** 폼 배열(step_label[], step_done[])에서 steps 구성. 없으면 null 반환(단계 미지정) */
function stepsFromBody(b) {
  if (b.step_label == null) return null;
  let L = b.step_label, D = b.step_done;
  if (!Array.isArray(L)) L = [L];
  if (!Array.isArray(D)) D = D == null ? [] : [D];
  const steps = [];
  for (let i = 0; i < L.length; i++) {
    const label = String(L[i] == null ? "" : L[i]).trim();
    if (!label) continue;
    steps.push({ label: label.slice(0, 200), done: String(D[i] == null ? "0" : D[i]) === "1" });
  }
  return steps;
}

function addTask(t) {
  const now = new Date().toISOString();
  const status = STATUSES.includes(t.status) ? t.status : "진행중";
  let steps = stepsFromBody(t);
  if (steps == null) steps = Array.isArray(t.steps) ? t.steps : [];
  if (status === "완료") steps = steps.map((s0) => ({ ...s0, done: true }));
  const rate = status === "완료" ? 100 : rateFromSteps(steps);
  const info = db.prepare(
    "INSERT INTO tasks (title, status, progress, manager, participants, issues, detail, log_id, rate, due_date, steps, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(String(t.title || "제목 없음").slice(0, 200), status, s(t.progress), s(t.manager, 80), s(t.participants, 200),
        s(t.issues), s(t.detail), parseInt(t.log_id, 10) || 0, rate, normDate(t.due_date), stepsToJson(steps), s(t.created_by, 80), now, now);
  return info.lastInsertRowid;
}
function updateTask(id, t) {
  const now = new Date().toISOString();
  const status = STATUSES.includes(t.status) ? t.status : "진행중";
  const cur = getTask(id);
  let steps = stepsFromBody(t);
  if (steps == null) steps = cur ? parseSteps(cur.steps) : [];   // 폼에 단계가 없으면 기존 유지
  if (status === "완료") steps = steps.map((s0) => ({ ...s0, done: true }));
  const rate = status === "완료" ? 100 : rateFromSteps(steps);
  db.prepare("UPDATE tasks SET title=?, status=?, progress=?, manager=?, participants=?, issues=?, detail=?, rate=?, due_date=?, steps=?, updated_at=? WHERE id=?")
    .run(String(t.title || "제목 없음").slice(0, 200), status, s(t.progress), s(t.manager, 80), s(t.participants, 200), s(t.issues), s(t.detail), rate, normDate(t.due_date), stepsToJson(steps), now, id);
}
/** 단계 하나의 완료 상태 토글 → 진행률 재계산 */
function toggleStep(id, idx) {
  const t = getTask(id);
  if (!t) return;
  const steps = parseSteps(t.steps);
  if (idx < 0 || idx >= steps.length) return;
  steps[idx].done = !steps[idx].done;
  const rate = rateFromSteps(steps);
  db.prepare("UPDATE tasks SET steps=?, rate=?, updated_at=? WHERE id=?").run(stepsToJson(steps), rate, new Date().toISOString(), id);
}
function appendTaskProgress(id, note, author) {
  const t = getTask(id);
  if (!t) return;
  const body = String(note == null ? "" : note).trim();
  if (!body) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const who = String(author || "").trim();
  const entry = "• [" + stamp + (who ? " · " + who : "") + "] " + body;
  const next = (t.progress ? t.progress + "\n" : "") + entry;
  db.prepare("UPDATE tasks SET progress = ?, updated_at = ? WHERE id = ?").run(s(next), new Date().toISOString(), id);
}
function setTaskStatus(id, status) {
  if (!STATUSES.includes(status)) return;
  const now = new Date().toISOString();
  if (status === "완료") {
    const t = getTask(id);
    const steps = t ? parseSteps(t.steps).map((s0) => ({ ...s0, done: true })) : [];
    db.prepare("UPDATE tasks SET status=?, rate=100, steps=?, updated_at=? WHERE id=?").run(status, stepsToJson(steps), now, id);
  } else {
    // 다시 열기 등: 단계 완료 비율로 진행률 재계산
    const t = getTask(id);
    const rate = t ? rateFromSteps(parseSteps(t.steps)) : 0;
    db.prepare("UPDATE tasks SET status=?, rate=?, updated_at=? WHERE id=?").run(status, rate, now, id);
  }
}
function removeTask(id) { db.prepare("DELETE FROM tasks WHERE id = ?").run(id); }
const s = (v, n = 4000) => String(v == null ? "" : v).slice(0, n);

/* ---------- AI 업무 정리(Gemini, 선택) ---------- */
async function extractTasksAI(logId, createdBy) {
  const log = getLog(logId);
  if (!log) throw new Error("회의록을 찾을 수 없습니다.");
  const msgs = logMessages(logId);
  if (!msgs.length) throw new Error("대화 내용이 없습니다.");
  let llm;
  try { llm = require("./globalnews").llm; } catch (e) { throw new Error("AI 모듈 로드 실패"); }
  if (typeof llm !== "function") throw new Error("AI(Gemini)가 설정되지 않았습니다.");

  // 대화 텍스트(최근 위주, 토큰 예산)
  let convo = msgs.map((m) => `[${m.msg_at}] ${m.sender}: ${m.content}`).join("\n");
  if (convo.length > 14000) convo = convo.slice(convo.length - 14000);

  // 기존 열린 업무(맥락 연결·중복 방지)
  const open = listTasks().filter((t) => t.status !== "완료").map((t) => `#${t.id} ${t.title} [${t.status}] 담당:${t.manager || "-"}`).join("\n") || "(없음)";

  const prompt =
`너는 사단법인 '도시공동체본부' 임원 회의(카카오톡 대화)를 분석해 업무를 정리하는 비서다.
아래 대화를 읽고 '진행 중이거나 결정된 업무'를 추출해 JSON으로만 답하라.
이미 등록된 기존 업무 목록을 참고해, 같은 업무면 새로 만들지 말고 연결(link_to_id)하라.

[기존 업무]
${open}

[대화]
${convo}

출력(JSON only):
{
 "summary": "회의 핵심 요약 3~5문장",
 "tasks": [
   {
     "title": "업무명(간결)",
     "status": "대기|진행중|보류|이슈|완료 중 하나",
     "progress": "현재 어디까지 진행되었는지",
     "manager": "매니징(담당)하는 사람 이름 (없으면 빈 문자열)",
     "participants": "참여자 이름들(쉼표)",
     "issues": "이슈/문제점 (없으면 빈 문자열)",
     "detail": "맥락·세부내용",
     "link_to_id": 0
   }
 ]
}
규칙: 대화에 근거 없는 내용 지어내지 말 것. 단순 인사/잡담은 제외. tasks는 최대 8개.`;

  const out = await llm(prompt, { ms: 90000, maxTokens: 4096, temperature: 0.3 });
  const data = (out && typeof out === "object") ? out : {};
  if (data.summary) setLogSummary(logId, data.summary);
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  let created = 0, linked = 0;
  for (const t of tasks) {
    if (!t || !t.title) continue;
    const linkId = parseInt(t.link_to_id, 10) || 0;
    if (linkId && getTask(linkId)) {
      // 기존 업무 업데이트(진행상황·이슈 갱신)
      const cur = getTask(linkId);
      updateTask(linkId, {
        title: cur.title, status: t.status || cur.status,
        progress: t.progress || cur.progress, manager: t.manager || cur.manager,
        participants: t.participants || cur.participants, issues: t.issues || cur.issues,
        detail: (cur.detail ? cur.detail + "\n\n" : "") + "[" + (log.title) + "] " + (t.detail || ""),
      });
      linked++;
    } else {
      addTask({ ...t, log_id: logId, created_by: createdBy });
      created++;
    }
  }
  return { summary: data.summary || "", created, linked, total: tasks.length };
}

/* ---------- 카카오톡 발송용 정리 리포트 ---------- */
function buildKakaoReport(logId) {
  const log = getLog(logId);
  if (!log) throw new Error("회의록을 찾을 수 없습니다.");
  let base = "https://ucc.or.kr";
  try { base = require("./globalnews").SITE_BASE_URL(); } catch (_) {}
  const linkUrl = base + "/exec/meetings/" + logId;
  const period = log.period_from + (log.period_to && log.period_to !== log.period_from ? " ~ " + log.period_to : "");
  const tasks = db.prepare("SELECT * FROM tasks WHERE log_id = ? ORDER BY id").all(logId);

  const L = [];
  L.push("[도시공동체본부] 임원 업무 정리");
  L.push("📌 " + (log.title || "회의"));
  if (period) L.push("🗓 " + period);
  L.push("");
  if (log.summary && log.summary.trim()) { L.push("📝 요약"); L.push(log.summary.trim()); L.push(""); }
  if (tasks.length) {
    L.push("✅ 업무 " + tasks.length + "건");
    tasks.forEach((t, i) => {
      L.push((i + 1) + ") " + t.title + " [" + t.status + "]" + (t.manager ? " · 담당 " + t.manager : ""));
      if (t.progress && t.progress.trim()) {
        const last = t.progress.trim().split("\n").filter(Boolean).pop();
        if (last) L.push("   " + last);
      }
      if (t.issues && t.issues.trim()) L.push("   ⚠ " + t.issues.trim().split("\n")[0]);
    });
    L.push("");
  }
  L.push("🔗 자세히 보기: " + linkUrl);
  return { text: L.join("\n"), linkUrl, taskCount: tasks.length };
}

function stats() {
  const counts = {}; STATUSES.forEach((st) => (counts[st] = 0));
  db.prepare("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").all().forEach((r) => { counts[r.status] = r.n; });
  return { counts, logCount: db.prepare("SELECT COUNT(*) AS n FROM meeting_logs").get().n, taskTotal: db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n };
}

module.exports = { STATUSES, addLog, listLogs, getLog, logMessages, removeLog, listTasks, getTask, addTask, updateTask, setTaskStatus, appendTaskProgress, toggleStep, parseSteps, removeTask, extractTasksAI, buildKakaoReport, stats };
