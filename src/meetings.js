/* meetings.js — 임원 업무관리: 회의록(카카오톡 대화)·업무(task) 데이터 + AI 정리 */
"use strict";
const { db, getSetting, setSetting } = require("./db");
const kakao = require("./kakaoparse");
const K_WATERMARK = "exec_analyzed_until"; // 마지막으로 분석 완료한 대화 시각(ISO, 이 시각 이하 대화는 재분석 제외)

const STATUSES = ["대기", "진행중", "보류", "이슈", "완료"];
const PRIORITIES = ["시급", "높음", "보통", "낮음"];

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
      .map((x) => ({ label: String(x.label || "").slice(0, 200), done: !!x.done, due: normDate(x.due),
                     owner: String(x.owner || "").slice(0, 80), lead: String(x.lead || "").slice(0, 80) })) : [];
  } catch (_) { return []; }
}
function rateFromSteps(steps) {
  if (!steps || !steps.length) return 0;
  return Math.round((steps.filter((s0) => s0.done).length / steps.length) * 100);
}
function stepsToJson(steps) {
  return JSON.stringify((steps || []).map((s0) => ({ label: String(s0.label || "").slice(0, 200), done: !!s0.done, due: normDate(s0.due),
                                                     owner: String(s0.owner || "").slice(0, 80), lead: String(s0.lead || "").slice(0, 80) })));
}
/** 폼 배열(step_label, step_done, step_due, step_owner, step_lead)에서 steps 구성. 없으면 null 반환(단계 미지정) */
function stepsFromBody(b) {
  if (b.step_label == null) return null;
  let L = b.step_label, D = b.step_done, U = b.step_due, O = b.step_owner, G = b.step_lead;
  if (!Array.isArray(L)) L = [L];
  if (!Array.isArray(D)) D = D == null ? [] : [D];
  if (!Array.isArray(U)) U = U == null ? [] : [U];
  if (!Array.isArray(O)) O = O == null ? [] : [O];
  if (!Array.isArray(G)) G = G == null ? [] : [G];
  const steps = [];
  for (let i = 0; i < L.length; i++) {
    const label = String(L[i] == null ? "" : L[i]).trim();
    if (!label) continue;
    steps.push({ label: label.slice(0, 200), done: String(D[i] == null ? "0" : D[i]) === "1", due: normDate(U[i]),
                 owner: String(O[i] == null ? "" : O[i]).trim().slice(0, 80), lead: String(G[i] == null ? "" : G[i]).trim().slice(0, 80) });
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
  const priority = PRIORITIES.includes(t.priority) ? t.priority : "보통";
  const info = db.prepare(
    "INSERT INTO tasks (title, status, progress, manager, participants, issues, detail, log_id, rate, due_date, steps, priority, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(String(t.title || "제목 없음").slice(0, 200), status, s(t.progress), s(t.manager, 80), s(t.participants, 200),
        s(t.issues), s(t.detail), parseInt(t.log_id, 10) || 0, rate, normDate(t.due_date), stepsToJson(steps), priority, s(t.created_by, 80), now, now);
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
  const priority = PRIORITIES.includes(t.priority) ? t.priority : (cur && cur.priority ? cur.priority : "보통");
  db.prepare("UPDATE tasks SET title=?, status=?, progress=?, manager=?, participants=?, issues=?, detail=?, rate=?, due_date=?, steps=?, priority=?, updated_at=? WHERE id=?")
    .run(String(t.title || "제목 없음").slice(0, 200), status, s(t.progress), s(t.manager, 80), s(t.participants, 200), s(t.issues), s(t.detail), rate, normDate(t.due_date), stepsToJson(steps), priority, now, id);
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

/* ---------- 분석 워터마크(한번 분석한 이전 대화 재분석 제외) ---------- */
function getWatermark() { return getSetting(K_WATERMARK, ""); }
function setWatermark(iso) { if (iso) setSetting(K_WATERMARK, iso); }
function resetWatermark() { setSetting(K_WATERMARK, ""); }
/** 워터마크(마지막 분석 시각) 이후의 '신규' 대화만 반환 */
function newMessages(logId) {
  const wm = getWatermark();
  const all = logMessages(logId);
  if (!wm) return all;
  return all.filter((m) => String(m.msg_at || "") > wm);
}
/** 제목 유사도 2차 검증(기존 업무 자동 매칭) */
function fuzzyMatchTask(title, tasks) {
  const norm = (x) => String(x || "").replace(/[\s\[\]()·,.\-_/]/g, "").toLowerCase();
  const nt = norm(title);
  if (!nt) return null;
  for (const t of tasks) {
    const no = norm(t.title);
    if (!no) continue;
    if (no === nt) return t;
    if (nt.length >= 4 && (no.includes(nt) || nt.includes(no))) return t;
  }
  return null;
}

/* ---------- ② 대화 청킹(wiki) + ③ 업무 분류 → 제안(proposal) 생성 (Gemini) ---------- */
async function analyzeMeeting(logId, byName) {
  const log = getLog(logId);
  if (!log) throw new Error("회의록을 찾을 수 없습니다.");
  const fresh = newMessages(logId);
  if (!fresh.length) {
    return { skipped: true, newCount: 0, proposals: 0,
      message: "새로 분석할 대화가 없습니다. (이전에 분석한 시점 이후의 새 대화가 없습니다)" };
  }
  let llm;
  try { llm = require("./globalnews").llm; } catch (e) { throw new Error("AI 모듈 로드 실패"); }
  if (typeof llm !== "function") throw new Error("AI(Gemini)가 설정되지 않았습니다.");

  let convo = fresh.map((m) => `[${m.msg_at}] ${m.sender}: ${m.content}`).join("\n");
  if (convo.length > 16000) convo = convo.slice(convo.length - 16000);

  const openTasks = listTasks().filter((t) => t.status !== "완료");
  const open = openTasks.map((t) => `#${t.id} ${t.title} [${t.status}] 담당:${t.manager || "-"} 완료예정:${t.due_date || "-"}`).join("\n") || "(없음)";

  const prompt =
`너는 사단법인 '도시공동체본부' 임원 단톡방 대화를 분석하는 비서다.
아래는 '아직 분석하지 않은 신규 대화'다. 이 신규 대화만 근거로 (1) 주제별 요약(wiki)과 (2) 업무 변경 제안을 JSON으로만 출력하라.
기존 업무 목록과 대조해, 같은 업무면 match_task_id로 연결하고 없으면 신규(0)로 제안하라.
완료/연기/일정 변경이 감지되면 status와 due_date에 반영하라.

[기존 업무]
${open}

[신규 대화]
${convo}

출력(JSON only):
{
 "summary": "신규 대화 핵심 요약 2~4문장",
 "topics": [ { "title": "주제", "summary": "핵심 1~2문장", "participants": "관련자", "match_task_id": 0 } ],
 "updates": [
   {
     "match_task_id": 0,
     "title": "업무명(간결)",
     "status": "대기|진행중|보류|이슈|완료 중 하나 또는 빈 문자열(변경 없음)",
     "progress": "이번 대화에서 추가되거나 진전된 내용 1~2문장",
     "due_date": "YYYY-MM-DD (일정이 정해지거나 바뀐 경우, 아니면 빈 문자열)",
     "detail": "맥락"
   }
 ]
}
규칙: 신규 대화에 근거 없는 내용 금지. 단순 인사/잡담 제외. topics·updates 각 최대 8개. 완료면 status='완료', 연기면 status='보류'로 하고 progress에 사유를 적어라.`;

  const out = await llm(prompt, { ms: 90000, maxTokens: 4096, temperature: 0.3 });
  const data = (out && typeof out === "object") ? out : {};
  if (data.summary) setLogSummary(logId, data.summary);
  if (Array.isArray(data.topics)) {
    db.prepare("UPDATE meeting_logs SET wiki=? WHERE id=?").run(JSON.stringify(data.topics).slice(0, 8000), logId);
  }

  const updates = Array.isArray(data.updates) ? data.updates : [];
  let created = 0, matched = 0;
  const now = new Date().toISOString();
  const ins = db.prepare("INSERT INTO task_proposals (log_id, task_id, kind, title, status, progress_note, due_date, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?)");
  for (const u of updates) {
    if (!u || !u.title) continue;
    let tid = parseInt(u.match_task_id, 10) || 0;
    if (tid && !getTask(tid)) tid = 0;
    if (!tid) { const m = fuzzyMatchTask(u.title, openTasks); if (m) tid = m.id; } // 이중 검증
    if (tid) matched++;
    let st = String(u.status || "").trim();
    if (st === "연기") st = "보류";
    if (!STATUSES.includes(st)) st = "";
    ins.run(logId, tid, tid ? "update" : "new", String(u.title).slice(0, 200), st, s(u.progress), normDate(u.due_date), s(u.detail), now);
    created++;
  }

  // 워터마크 = 이번에 분석한 신규 대화의 최대 시각(다음 업로드 때 이 시각 이하는 재분석 제외)
  const maxAt = fresh.reduce((mx, m) => (String(m.msg_at) > mx ? String(m.msg_at) : mx), getWatermark());
  setWatermark(maxAt);
  db.prepare("UPDATE meeting_logs SET analyzed_from=?, analyzed_at=? WHERE id=?").run(fresh[0].msg_at || "", now, logId);

  return { skipped: false, newCount: fresh.length, proposals: created, matched,
    from: fresh[0].msg_at, to: fresh[fresh.length - 1].msg_at, summary: data.summary || "" };
}

/* ---------- 제안(proposal): 이중검증 결과 → 'update' 마킹 → 일괄 반영 ---------- */
function parseWiki(v) { try { const a = JSON.parse(v || "[]"); return Array.isArray(a) ? a : []; } catch (_) { return []; } }
function pendingProposals() { return db.prepare("SELECT * FROM task_proposals WHERE applied=0 ORDER BY id").all(); }
function pendingProposalsForLog(logId) { return db.prepare("SELECT * FROM task_proposals WHERE applied=0 AND log_id=? ORDER BY id").all(logId); }
function pendingCount() { return db.prepare("SELECT COUNT(*) AS n FROM task_proposals WHERE applied=0").get().n; }
function pendingTaskIdSet() { return new Set(db.prepare("SELECT DISTINCT task_id FROM task_proposals WHERE applied=0 AND task_id>0").all().map((r) => r.task_id)); }
function clearPendingProposals() { db.prepare("DELETE FROM task_proposals WHERE applied=0").run(); }

/** 대기 중 제안을 '주요업무'에 일괄 반영(기존 업무는 진행기록 누적·상태/일정 수정, 신규는 등록) */
function applyAllProposals(byName) {
  const list = pendingProposals();
  let updated = 0, added = 0;
  const now = new Date().toISOString();
  for (const p of list) {
    if (p.kind === "update" && p.task_id && getTask(p.task_id)) {
      if (p.progress_note) appendTaskProgress(p.task_id, p.progress_note, "대화분석");
      const cur = getTask(p.task_id); // 진행기록 반영 후 재조회
      updateTask(p.task_id, {
        title: cur.title, status: p.status || cur.status, progress: cur.progress,
        manager: cur.manager, participants: cur.participants, issues: cur.issues,
        detail: cur.detail, priority: cur.priority, due_date: p.due_date || cur.due_date,
        // step_label 미전달 → 기존 단계 유지
      });
      updated++;
    } else {
      addTask({ title: p.title, status: p.status || "진행중", progress: p.progress_note || "",
        detail: p.detail || "", log_id: p.log_id, created_by: byName || "대화분석" });
      added++;
    }
    db.prepare("UPDATE task_proposals SET applied=1, applied_at=? WHERE id=?").run(now, p.id);
  }
  return { updated, added, total: list.length };
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

module.exports = { STATUSES, PRIORITIES, addLog, listLogs, getLog, logMessages, removeLog, listTasks, getTask, addTask, updateTask, setTaskStatus, appendTaskProgress, toggleStep, parseSteps, removeTask,
  analyzeMeeting, newMessages, getWatermark, resetWatermark, parseWiki,
  pendingProposals, pendingProposalsForLog, pendingCount, pendingTaskIdSet, clearPendingProposals, applyAllProposals,
  buildKakaoReport, stats };
