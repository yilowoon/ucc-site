/* member-reminder.js — 가입 1주일 경과 준회원에게 정회원 전환 안내 메일 자동 발송.
 * 조건: 준회원(정회원 아님) · 회비 미납(fee_paid=0) · 아직 안 보냄 · 옵트아웃 아님 · 실제 이메일 · 가입 7일 경과.
 * '준회원 유지'(reminder_optout=1) 선택 시 이후 발송 안 함. 스케줄러는 매시간 점검(신규 대상 자동 처리).
 */
"use strict";
const { db } = require("./db");
const mailer = require("./mailer");
const tpl = require("./mail-templates");
const tokens = require("./tokens");

const WEEK_MS = 7 * 24 * 3600 * 1000;
const BASE = () => (process.env.BASE_URL || "https://ucc.or.kr").replace(/\/+$/, "");

async function runOnce({ limit = 30 } = {}) {
  if (!mailer.hasSmtp()) return { sent: 0, scanned: 0, reason: "no-smtp" };
  const cutoff = new Date(Date.now() - WEEK_MS).toISOString();
  const rows = db.prepare(
    "SELECT id, name, email, member_type FROM members " +
    "WHERE grade <> '정회원' AND fee_paid = 0 AND reminder_sent = 0 AND reminder_optout = 0 " +
    "AND created_at <= ? AND email LIKE '%@%' AND email NOT LIKE '%@social.ucc' " +
    "ORDER BY created_at LIMIT ?"
  ).all(cutoff, limit);

  let sent = 0;
  for (const m of rows) {
    const keepUrl = BASE() + "/members/keep-associate?token=" + encodeURIComponent(tokens.sign({ id: m.id, k: "keep" }));
    const joinUrl = BASE() + "/login?next=" + encodeURIComponent("/mypage/edit");
    const mail = tpl.associateReminderMail(m, joinUrl, keepUrl);
    try {
      const r = await mailer.sendMail(m.email, mail.subject, mail.text, mail.html);
      if (r.sent) {
        db.prepare("UPDATE members SET reminder_sent = 1, reminder_sent_at = ? WHERE id = ?")
          .run(new Date().toISOString(), m.id);
        sent++;
      } else {
        console.warn("[reminder] 발송 실패:", m.email, r.reason || "");
      }
    } catch (e) {
      console.error("[reminder] 발송 오류:", m.email, e.message);
    }
  }
  if (rows.length) console.log(`[reminder] 준회원 정회원전환 안내메일 ${sent}/${rows.length}건 발송`);
  return { sent, scanned: rows.length };
}

function startScheduler() {
  const run = () => runOnce().catch((e) => console.error("[reminder] 스케줄 오류:", e.message));
  run();                                  // 시작 즉시 1회(가입 7일 지난 대상 캐치업)
  setInterval(run, 60 * 60 * 1000);       // 매시간 점검 — 새로 7일 경과한 준회원 자동 발송
  console.log("[reminder] 준회원 정회원전환 안내 스케줄러 시작(매시간 점검, 가입 7일 경과 대상)");
}

module.exports = { runOnce, startScheduler };
