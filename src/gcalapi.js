/* gcalapi.js — 구글 Calendar API v3 (서비스 계정, 무의존). 양방향(읽기/쓰기).
 *
 * 설정(.env):
 *   GOOGLE_SERVICE_ACCOUNT_JSON = 서비스 계정 JSON 내용 전체(한 줄) 또는 JSON 파일 경로
 *   GOOGLE_CALENDAR_ID          = 대상 캘린더 ID(예: xxxx@group.calendar.google.com 또는 hyungku.yi@gmail.com)
 *   ※ 대상 캘린더를 서비스 계정 이메일에 '일정 변경 권한'으로 공유해야 쓰기가 됩니다.
 *
 * 설정되면 관리자 CRUD·회원 캘린더 읽기가 모두 구글 캘린더를 단일 소스로 사용.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar";
const TZ = "Asia/Seoul";

let _token = { value: "", exp: 0 };

function loadSA() {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : fs.readFileSync(raw, "utf8");
    const sa = JSON.parse(json);
    if (sa.client_email && sa.private_key) return sa;
  } catch (e) {}
  return null;
}
const CAL_ID = () => {
  let v = (process.env.GOOGLE_CALENDAR_ID || "").trim();
  if (!v) return "";
  // 실수로 '퍼가기(embed)/공개 URL'을 넣은 경우 src= 파라미터에서 실제 캘린더 ID 추출
  const m = v.match(/[?&]src=([^&]+)/);
  if (m) { try { v = decodeURIComponent(m[1]); } catch (e) { v = m[1]; } }
  return v;
};
function isConfigured() { return !!(loadSA() && CAL_ID()); }

const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function accessToken() {
  if (_token.value && Date.now() < _token.exp) return _token.value;
  const sa = loadSA();
  if (!sa) throw new Error("서비스 계정 미설정");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256"); signer.update(header + "." + claim); signer.end();
  const jwt = header + "." + claim + "." + b64url(signer.sign(sa.private_key));
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt });
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("토큰 발급 실패: " + (j.error_description || j.error || r.status));
  _token = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000 };
  return _token.value;
}

async function apiFetch(pathAndQuery, opts = {}) {
  const token = await accessToken();
  const r = await fetch(API + pathAndQuery, { ...opts, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 204) return {};
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`Calendar API ${r.status}: ${(j && j.error && j.error.message) || t.slice(0, 160)}`);
  return j;
}

/* ---------- KST 시각 헬퍼 ---------- */
const pad = (n) => String(n).padStart(2, "0");
function kstKeys(epoch) {
  const d = new Date(epoch + 9 * 3600 * 1000);
  return { dateKey: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
function dayShiftKey(dateKey, deltaDays) {
  const [Y, M, D] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D) + deltaDays * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 구글 이벤트 → 정규화(여러 날 종일은 각 날짜로 펼침) 배열 */
function normalize(ev) {
  const out = [];
  const summary = ev.summary || "(제목 없음)";
  const base = { id: ev.id, summary, location: ev.location || "", description: ev.description || "", source: "google" };
  if (ev.start && ev.start.date) { // 종일
    const startK = ev.start.date; // YYYY-MM-DD
    const endK = ev.end && ev.end.date ? ev.end.date : dayShiftKey(startK, 1); // end 는 배타적
    let k = startK, guard = 0;
    while (k < endK && guard++ < 40) { out.push({ ...base, dateKey: k, time: "", endTime: "", allDay: true }); k = dayShiftKey(k, 1); }
    if (!out.length) out.push({ ...base, dateKey: startK, time: "", endTime: "", allDay: true });
  } else if (ev.start && ev.start.dateTime) {
    const s = kstKeys(Date.parse(ev.start.dateTime));
    const e = ev.end && ev.end.dateTime ? kstKeys(Date.parse(ev.end.dateTime)) : { time: "" };
    out.push({ ...base, dateKey: s.dateKey, time: s.time, endTime: e.time || "", allDay: false });
  }
  return out;
}

async function listRange(minKey, maxKey) {
  const timeMin = new Date(Date.parse(minKey + "T00:00:00+09:00")).toISOString();
  const timeMax = new Date(Date.parse(maxKey + "T23:59:59+09:00")).toISOString();
  const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "2500", timeZone: TZ });
  const j = await apiFetch(`/calendars/${encodeURIComponent(CAL_ID())}/events?${q.toString()}`);
  const events = [];
  for (const ev of (j.items || [])) { if (ev.status === "cancelled") continue; for (const n of normalize(ev)) events.push(n); }
  return events;
}

/* ---------- 읽기(회원 캘린더) ---------- */
async function monthMap(year, month) {
  const first = `${year}-${pad(month)}-01`;
  const last = `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
  const evs = await listRange(first, last);
  const map = {};
  for (const e of evs) if (e.dateKey >= first && e.dateKey <= last) { const d = +e.dateKey.slice(8, 10); (map[d] = map[d] || []).push(e); }
  return map;
}
async function dayEvents(dateKey) { return (await listRange(dateKey, dateKey)).filter((e) => e.dateKey === dateKey); }

/* ---------- 쓰기(관리자 CRUD) ---------- */
function toGoogleBody({ event_date, start_time, end_time, title, location, memo }) {
  const body = { summary: title, location: location || "", description: memo || "" };
  if (start_time) {
    body.start = { dateTime: `${event_date}T${start_time}:00`, timeZone: TZ };
    const end = end_time || addMinutes(start_time, 60);
    body.end = { dateTime: `${event_date}T${end}:00`, timeZone: TZ };
  } else {
    body.start = { date: event_date };
    body.end = { date: dayShiftKey(event_date, 1) }; // 종일: end 배타적(+1일)
  }
  return body;
}
function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  let t = h * 60 + m + mins; t = ((t % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}
async function insert(payload) { return apiFetch(`/calendars/${encodeURIComponent(CAL_ID())}/events`, { method: "POST", body: JSON.stringify(toGoogleBody(payload)) }); }
async function update(id, payload) { return apiFetch(`/calendars/${encodeURIComponent(CAL_ID())}/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(toGoogleBody(payload)) }); }
async function remove(id) { return apiFetch(`/calendars/${encodeURIComponent(CAL_ID())}/events/${encodeURIComponent(id)}`, { method: "DELETE" }); }

/** 관리자 목록/단건 — cal_events 와 동일한 필드 모양으로 반환 */
async function get(id) {
  const ev = await apiFetch(`/calendars/${encodeURIComponent(CAL_ID())}/events/${encodeURIComponent(id)}`);
  const n = normalize(ev)[0] || {};
  return { id: ev.id, event_date: n.dateKey || "", start_time: n.time || "", end_time: n.endTime || "", title: ev.summary || "", location: ev.location || "", memo: ev.description || "" };
}
async function listForAdmin() {
  const today = new Date(Date.now() + 9 * 3600 * 1000);
  const minKey = dayShiftKey(`${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`, -60);
  const maxKey = dayShiftKey(`${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate())}`, 180);
  const evs = await listRange(minKey, maxKey);
  return evs.map((e) => ({ id: e.id, event_date: e.dateKey, start_time: e.time, end_time: e.endTime, title: e.summary, location: e.location, memo: e.description }))
    .sort((a, b) => b.event_date.localeCompare(a.event_date) || String(a.start_time).localeCompare(b.start_time));
}

module.exports = { isConfigured, monthMap, dayEvents, insert, update, remove, get, listForAdmin };
