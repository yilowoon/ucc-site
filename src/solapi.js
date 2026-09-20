/* solapi.js — 솔라피(CoolSMS) 카카오 친구톡 발송(무의존). 회원 대상 1000자 메시지.
 *
 * 설정(.env):
 *   SOLAPI_API_KEY, SOLAPI_API_SECRET  — 솔라피 API 키/시크릿
 *   SOLAPI_PFID                        — 카카오 발신프로필 ID(채널 연동 후 발급)
 *   SOLAPI_SENDER                      — 등록한 발신번호(숫자만; SMS 대체용)
 *
 * 친구톡은 '채널을 친구추가한' 회원에게만 전달됩니다. 1건 최대 1,000자.
 * 켜기/끄기는 관리자에서 토글(app_settings.friendtalk_on).
 */
"use strict";

const crypto = require("crypto");
const { getSetting, setSetting } = require("./db");

const API = "https://api.solapi.com";
const KEY = () => process.env.SOLAPI_API_KEY || "";
const SECRET = () => process.env.SOLAPI_API_SECRET || "";
const PFID = () => process.env.SOLAPI_PFID || "";
const SENDER = () => (process.env.SOLAPI_SENDER || "").replace(/[^0-9]/g, "");

const K_ON = "friendtalk_on";
const K_LAST_SENT = "friendtalk_last_sent";
const K_LAST_ERR = "friendtalk_last_error";

function isConfigured() { return !!(KEY() && SECRET() && PFID()); }
function onFlag() { return getSetting(K_ON, "0") === "1"; }
function setOn(on) { setSetting(K_ON, on ? "1" : "0"); }
function status() {
  return { configured: isConfigured(), on: onFlag(), sender: SENDER(), pfid: PFID() ? "설정됨" : "", lastSent: getSetting(K_LAST_SENT), lastError: getSetting(K_LAST_ERR) };
}

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString("hex");
  const signature = crypto.createHmac("sha256", SECRET()).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${KEY()}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function post(path, body) {
  const r = await fetch(API + path, { method: "POST", headers: { Authorization: authHeader(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`솔라피 ${r.status}: ${(j && (j.errorMessage || j.message || j.error)) || t.slice(0, 180)}`);
  return j;
}

/** 친구톡(텍스트) 대량 발송. phones: string[], text ≤1000, linkUrl: 버튼 링크(선택). 반환 {count} */
async function sendFriendtalk(phones, text, linkUrl) {
  if (!isConfigured()) throw new Error("솔라피 미설정(SOLAPI_API_KEY/SECRET/PFID)");
  const list = [...new Set((phones || []).map((p) => String(p).replace(/[^0-9]/g, "")).filter((p) => p.length >= 9))];
  if (!list.length) return { count: 0 };
  const buttons = linkUrl ? [{ buttonType: "WL", buttonName: "브리프 보기", linkMo: linkUrl, linkPc: linkUrl }] : undefined;
  const kakaoOptions = { pfId: PFID(), disableSms: true, ...(buttons ? { buttons } : {}) };
  const messages = list.map((to) => ({ to, from: SENDER() || undefined, type: "CTA", text: String(text).slice(0, 1000), kakaoOptions }));
  try {
    const res = await post("/messages/v4/send-many/detail", { messages });
    setSetting(K_LAST_SENT, new Date().toISOString());
    setSetting(K_LAST_ERR, "");
    return { count: list.length, res };
  } catch (e) {
    setSetting(K_LAST_ERR, `${new Date().toISOString()} ${e.message}`);
    throw e;
  }
}

module.exports = { isConfigured, onFlag, setOn, status, sendFriendtalk, SENDER };
