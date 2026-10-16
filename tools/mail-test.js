/* mail-test.js — SMTP 메일 발송 진단(서버에서 직접 실행)
 *
 * 사용: node tools/mail-test.js [받는주소]
 *   예) node tools/mail-test.js heejung1009@gmail.com
 *
 * .env 의 SMTP_* 설정으로 실제 발송을 시도하고, 성공/실패와 '정확한 원인'을 출력한다.
 * (비밀번호 값 자체는 출력하지 않음)
 */
"use strict";
const path = require("path");
const fs = require("fs");

// server.js 와 동일한 .env 로더
(function loadDotEnv() {
  try {
    const p = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s[0] === "#") continue;
      const i = s.indexOf("=");
      if (i < 1) continue;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch (e) {}
})();

const to = process.argv[2] || process.env.SMTP_USER || "";
const mask = (v) => (v ? v.slice(0, 2) + "***" + (v.length > 4 ? v.slice(-2) : "") : "(없음)");

console.log("=== SMTP 설정 점검 ===");
console.log("  SMTP_HOST  :", process.env.SMTP_HOST || "(없음)");
console.log("  SMTP_PORT  :", process.env.SMTP_PORT || "(기본 465)");
console.log("  SMTP_SECURE:", process.env.SMTP_SECURE || "(기본 true)");
console.log("  SMTP_USER  :", process.env.SMTP_USER || "(없음)");
console.log("  SMTP_PASS  :", mask(process.env.SMTP_PASS), "(길이:", (process.env.SMTP_PASS || "").length, ")");
console.log("  SMTP_FROM  :", process.env.SMTP_FROM || "(없음 → USER 사용)");
console.log("  받는 주소  :", to);

if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.error("\n❌ SMTP_HOST/USER/PASS 중 비어있는 값이 있습니다. .env 를 확인하세요.");
  process.exit(1);
}
if (!to) { console.error("\n❌ 받는 주소를 지정하세요: node tools/mail-test.js 받는주소@example.com"); process.exit(1); }

(async () => {
  let nodemailer;
  try { nodemailer = require("nodemailer"); }
  catch (e) { console.error("\n❌ nodemailer 미설치:", e.message, "\n   → npm install 실행 필요"); process.exit(1); }

  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") !== "false",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  console.log("\n=== 1) SMTP 로그인 검증(verify) ===");
  try { await t.verify(); console.log("  ✅ 로그인/연결 성공"); }
  catch (e) {
    console.error("  ❌ 실패:", e.message);
    console.error("     code:", e.code, "| response:", e.response || "");
    console.error("\n   ▶ 흔한 원인: Gmail '앱 비밀번호'가 아니거나 만료됨 / 2단계인증 미설정 /");
    console.error("     계정 보안차단. Gmail 앱비밀번호를 새로 발급해 SMTP_PASS 에 공백없이 넣으세요.");
    process.exit(1);
  }

  console.log("\n=== 2) 실제 발송 테스트 ===");
  try {
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: "[테스트] 도시공동체본부 메일 발송 점검",
      text: "이 메일이 보이면 SMTP 발송은 정상입니다. (받은편지함에 없으면 스팸함도 확인하세요)",
    });
    console.log("  ✅ 발송 성공");
    console.log("     messageId:", info.messageId);
    console.log("     accepted :", JSON.stringify(info.accepted));
    console.log("     rejected :", JSON.stringify(info.rejected));
    console.log("\n   → 발송은 성공했습니다. 수신이 안 되면 받는 쪽 '스팸함/프로모션' 탭을 확인하세요.");
  } catch (e) {
    console.error("  ❌ 발송 실패:", e.message);
    console.error("     code:", e.code, "| response:", e.response || "");
    process.exit(1);
  }
})();
