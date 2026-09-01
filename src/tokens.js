/* tokens.js — 서버 비밀키(SESSION_SECRET)로 서명한 간단 토큰. 메일 링크 등 로그인 없는 액션에 사용. */
"use strict";
const crypto = require("crypto");
const secret = () => process.env.SESSION_SECRET || "ucc-dev-secret-change-me";

function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + sig;
}
function verify(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") < 0) return null;
  const i = token.indexOf(".");
  const body = token.slice(0, i), sig = token.slice(i + 1);
  const expect = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  let a, b;
  try { a = Buffer.from(sig); b = Buffer.from(expect); } catch { return null; }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}
module.exports = { sign, verify };
