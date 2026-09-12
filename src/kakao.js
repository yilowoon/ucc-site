/* kakao.js — 카카오톡 '나에게 보내기'(메모 API)로 지구촌소식브리프 요약을 자동 발송.
 *
 * 동작: 기존 카카오 로그인 앱을 그대로 사용. talk_message 권한으로 1회 동의하면
 *       refresh_token 을 DB(app_settings, data/ucc.db=커밋 제외)에 저장하고,
 *       이후에는 refresh_token 으로 access_token 을 자동 갱신해 매일 발송한다.
 *
 * 필요 설정:
 *   .env : KAKAO_REST_API_KEY (로그인용과 동일) [, KAKAO_CLIENT_SECRET]
 *   카카오 개발자센터: 카카오 로그인 ON, 동의항목 'talk_message'(카카오톡 메시지 전송) 사용,
 *                      Redirect URI 에 {BASE_URL}/auth/kakao-memo/callback 추가
 *   1회 연결: 관리자 → 카카오 자동발송 → '카카오 연결' 클릭 후 동의
 *
 * 참고: 메모(기본 text 템플릿)의 text 는 최대 200자 → 긴 내용은 줄 단위로 자동 분할 발송.
 */
"use strict";

const { getSetting, setSetting } = require("./db");

const AUTH = "https://kauth.kakao.com/oauth";
const API = "https://kapi.kakao.com";
const SCOPE = "talk_message";
const TEXT_MAX = 190; // 안전 여유(공식 한도 200)

const REST_KEY = () => process.env.KAKAO_REST_API_KEY || "";
const CLIENT_SECRET = () => process.env.KAKAO_CLIENT_SECRET || "";

const K_REFRESH = "kakao_memo_refresh_token";
const K_CONNECTED_AT = "kakao_memo_connected_at";
const K_LAST_SENT = "kakao_memo_last_sent_at";
const K_LAST_ERROR = "kakao_memo_last_error";
const K_AUTOSEND = "kakao_memo_autosend"; // "1"|"0"

let _access = { token: "", exp: 0 }; // 액세스 토큰 메모리 캐시

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isConfigured() { return !!REST_KEY(); }
function isConnected() { return !!getSetting(K_REFRESH); }
function autoSendOn() { return getSetting(K_AUTOSEND, "1") !== "0"; }
function setAutoSend(on) { setSetting(K_AUTOSEND, on ? "1" : "0"); }

function status() {
  return {
    configured: isConfigured(),
    connected: isConnected(),
    autoSend: autoSendOn(),
    connectedAt: getSetting(K_CONNECTED_AT),
    lastSentAt: getSetting(K_LAST_SENT),
    lastError: getSetting(K_LAST_ERROR),
  };
}

function disconnect() {
  setSetting(K_REFRESH, "");
  setSetting(K_CONNECTED_AT, "");
  _access = { token: "", exp: 0 };
}

async function fetchJson(url, opts, ms = 10000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { ok: r.ok, status: r.status, json: j, text: t };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: (e && e.message) || "network-error" };
  } finally { clearTimeout(to); }
}

/** 1회 동의용 인가 URL */
function authorizeUrl(redirectUri, state) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: REST_KEY(),
    redirect_uri: redirectUri,
    scope: SCOPE,
    state: state || "",
  });
  return `${AUTH}/authorize?${q.toString()}`;
}

/** 콜백 code → refresh_token 저장 */
async function connect(code, redirectUri) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: REST_KEY(),
    redirect_uri: redirectUri,
    code,
  });
  if (CLIENT_SECRET()) body.set("client_secret", CLIENT_SECRET());
  const r = await fetchJson(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const j = r.json || {};
  if (!j.refresh_token) throw new Error(`카카오 토큰 교환 실패: status=${r.status} ${(r.text || "").slice(0, 200)}`);
  setSetting(K_REFRESH, j.refresh_token);
  setSetting(K_CONNECTED_AT, new Date().toISOString());
  setSetting(K_LAST_ERROR, "");
  if (j.access_token) _access = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000 };
  return true;
}

/** 유효한 access_token 반환(만료 시 refresh_token 으로 갱신, 회전 토큰 저장) */
async function getAccessToken() {
  if (_access.token && Date.now() < _access.exp) return _access.token;
  const rt = getSetting(K_REFRESH);
  if (!rt) throw new Error("카카오 미연결(refresh_token 없음) — 관리자에서 '카카오 연결'을 먼저 진행하세요.");
  const body = new URLSearchParams({ grant_type: "refresh_token", client_id: REST_KEY(), refresh_token: rt });
  if (CLIENT_SECRET()) body.set("client_secret", CLIENT_SECRET());
  const r = await fetchJson(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const j = r.json || {};
  if (!j.access_token) throw new Error(`카카오 액세스 토큰 갱신 실패: status=${r.status} ${(r.text || "").slice(0, 200)}`);
  _access = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000 };
  if (j.refresh_token) setSetting(K_REFRESH, j.refresh_token); // 회전 시 최신 토큰으로 갱신
  return _access.token;
}

/** 긴 텍스트를 줄 경계 기준 TEXT_MAX 이내로 분할(한 줄이 너무 길면 강제 컷) */
function splitByLines(text, max = TEXT_MAX) {
  const out = [];
  let cur = "";
  for (let line of String(text || "").split("\n")) {
    while (line.length > max) { // 초장문 한 줄 방어
      if (cur) { out.push(cur); cur = ""; }
      out.push(line.slice(0, max));
      line = line.slice(max);
    }
    const add = cur ? cur + "\n" + line : line;
    if (add.length > max) { if (cur) out.push(cur); cur = line; }
    else cur = add;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

/** 메모(text) 1건 전송 */
async function sendMemoText(text, linkUrl) {
  const token = await getAccessToken();
  const template = {
    object_type: "text",
    text: String(text).slice(0, 200),
    link: linkUrl ? { web_url: linkUrl, mobile_web_url: linkUrl } : { web_url: "", mobile_web_url: "" },
  };
  if (linkUrl) template.button_title = "브리프 보기";
  const body = new URLSearchParams({ template_object: JSON.stringify(template) });
  const r = await fetchJson(`${API}/v2/api/talk/memo/default/send`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`카카오 발송 실패: status=${r.status} ${(r.text || "").slice(0, 200)}`);
  return true;
}

/** 긴 내용을 여러 통으로 나눠 '나에게' 발송. 마지막 통에 링크 버튼 부착. 반환: 발송 통수 */
async function sendToMe(fullText, linkUrl) {
  const parts = splitByLines(fullText, TEXT_MAX - 8); // (n/N) 표기 여유
  try {
    for (let i = 0; i < parts.length; i++) {
      const tag = parts.length > 1 ? `\n(${i + 1}/${parts.length})` : "";
      const isLast = i === parts.length - 1;
      await sendMemoText(parts[i] + tag, isLast ? linkUrl : "");
      if (!isLast) await sleep(600);
    }
    setSetting(K_LAST_SENT, new Date().toISOString());
    setSetting(K_LAST_ERROR, "");
    return parts.length;
  } catch (e) {
    setSetting(K_LAST_ERROR, `${new Date().toISOString()} ${e.message}`);
    throw e;
  }
}

module.exports = {
  isConfigured, isConnected, autoSendOn, setAutoSend, status, disconnect,
  authorizeUrl, connect, getAccessToken, sendToMe, sendMemoText, splitByLines, SCOPE,
};
