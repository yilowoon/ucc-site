/* mailer.js — SMTP 메일 발송(환경변수 기반). 미설정/미설치 시 발송 안 함(개발 폴백).
 * 환경변수: SMTP_HOST, SMTP_PORT(기본 465), SMTP_SECURE(기본 true), SMTP_USER, SMTP_PASS, SMTP_FROM
 * 예) Gmail 앱비밀번호: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=계정 SMTP_PASS=앱비밀번호
 *     Naver:            SMTP_HOST=smtp.naver.com  SMTP_PORT=465 SMTP_USER=아이디 SMTP_PASS=비밀번호
 */
"use strict";

let _t = null, _tried = false;
function transporter() {
  if (_tried) return _t;
  _tried = true;
  const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return (_t = null);
  try {
    const nodemailer = require("nodemailer");
    _t = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || "true") !== "false",
      auth: { user, pass },
    });
    console.log("[mail] SMTP 준비:", host);
  } catch (e) {
    console.error("[mail] nodemailer 미설치/오류:", e.message);
    _t = null;
  }
  return _t;
}

function hasSmtp() { return !!transporter(); }

async function sendMail(to, subject, text, html) {
  const t = transporter();
  if (!t) return { sent: false, reason: "no-smtp" };
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await t.sendMail({ from, to, subject, text, html });
    return { sent: true };
  } catch (e) {
    console.error("[mail] 발송 실패:", e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { sendMail, hasSmtp };
