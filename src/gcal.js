/* gcal.js — 구글 캘린더 '비공개 iCal 주소(.ics)'를 읽어 일정으로 제공(무의존).
 *
 * 설정: .env 의 GOOGLE_CALENDAR_ICS 에 구글 캘린더 설정 →
 *       '캘린더 통합' → '비공개 주소(iCal 형식)' URL 을 넣는다.
 *       (여러 개면 콤마(,)로 구분 가능)
 *
 * 동작: 서버 메모리에 이벤트를 캐시하고 30분마다 갱신. 반복(RRULE) 일정은
 *       현재 기준 -31일 ~ +180일 범위로 펼쳐서 저장. 시각은 KST 기준으로 표시.
 */
"use strict";

const ICS_URLS = () => (process.env.GOOGLE_CALENDAR_ICS || "").split(",").map((s) => s.trim()).filter(Boolean);
const REFRESH_MS = 30 * 60 * 1000;
const WIN_BACK = 31, WIN_FWD = 180; // 펼칠 범위(일)

let _cache = { events: [], fetchedAt: 0, loading: null };

const pad = (n) => String(n).padStart(2, "0");
/** KST 벽시계 Date(=UTC필드에 KST값 저장)에서 키 추출 */
function keys(d) {
  return {
    dateKey: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}
function kstToday() {
  const n = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** iCal 값 → KST 벽시계 Date + allDay 여부 */
function parseDt(val, params) {
  const m = String(val).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const Y = +m[1], Mo = +m[2], D = +m[3];
  const hasTime = m[4] != null;
  if (!hasTime || params.VALUE === "DATE") {
    return { allDay: true, date: new Date(Date.UTC(Y, Mo - 1, D)) };
  }
  const H = +m[4], Mi = +m[5], S = +m[6] || 0;
  if (m[7] === "Z") { // UTC → KST(+9)
    return { allDay: false, date: new Date(Date.UTC(Y, Mo - 1, D, H, Mi, S) + 9 * 3600 * 1000) };
  }
  // TZID/floating → KST 벽시계로 간주(한국 캘린더 가정)
  return { allDay: false, date: new Date(Date.UTC(Y, Mo - 1, D, H, Mi, S)) };
}

/** RFC5545 라인 언폴딩 후 VEVENT 블록 파싱 */
function parseICS(text) {
  const unfolded = String(text || "").replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r\n|\n|\r/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdate: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const ci = line.indexOf(":");
    if (ci < 0) continue;
    const left = line.slice(0, ci), value = line.slice(ci + 1);
    const parts = left.split(";");
    const name = parts[0].toUpperCase();
    const params = {};
    for (let i = 1; i < parts.length; i++) { const kv = parts[i].split("="); params[kv[0].toUpperCase()] = (kv[1] || "").toUpperCase(); }
    if (name === "DTSTART") cur.start = parseDt(value, params);
    else if (name === "DTEND") cur.end = parseDt(value, params);
    else if (name === "SUMMARY") cur.summary = unescapeText(value);
    else if (name === "DESCRIPTION") cur.description = unescapeText(value);
    else if (name === "LOCATION") cur.location = unescapeText(value);
    else if (name === "RRULE") cur.rrule = value;
    else if (name === "UID") cur.uid = value;
    else if (name === "EXDATE") { const p = parseDt(value.split(",")[0], params); if (p) cur.exdate.push(keys(p.date).dateKey); }
  }
  return events;
}
function unescapeText(s) {
  return String(s).replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

/** RRULE 파싱 */
function parseRRule(s) {
  const o = {};
  for (const kv of String(s).split(";")) { const [k, v] = kv.split("="); if (k) o[k.toUpperCase()] = v; }
  return o;
}
const DAYMAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** 하나의 VEVENT → 발생 인스턴스 배열(윈도 내). 각 인스턴스: {start(Date), allDay, summary, location, description} */
function expand(ev, winStart, winEnd) {
  if (!ev.start) return [];
  const dur = (ev.end && ev.end.date) ? (ev.end.date.getTime() - ev.start.date.getTime()) : (ev.start.allDay ? 86400000 : 3600000);
  const base = { allDay: !!ev.start.allDay, summary: ev.summary || "(제목 없음)", location: ev.location || "", description: ev.description || "", durMs: dur };
  const out = [];
  const pushIf = (d) => {
    if (d.getTime() < winStart || d.getTime() > winEnd) return;
    if (ev.exdate.includes(keys(d).dateKey)) return;
    out.push({ ...base, start: new Date(d.getTime()) });
  };
  if (!ev.rrule) { pushIf(ev.start.date); return out; }

  const r = parseRRule(ev.rrule);
  const freq = (r.FREQ || "").toUpperCase();
  const interval = Math.max(1, parseInt(r.INTERVAL, 10) || 1);
  const count = r.COUNT ? parseInt(r.COUNT, 10) : null;
  let until = null;
  if (r.UNTIL) { const p = parseDt(r.UNTIL, {}); if (p) until = p.date.getTime(); }
  const byday = r.BYDAY ? r.BYDAY.split(",").map((x) => DAYMAP[x.slice(-2).toUpperCase()]).filter((n) => n != null) : null;

  let cursor = new Date(ev.start.date.getTime());
  let made = 0, guard = 0;
  const cap = 500;
  while (guard++ < 2000) {
    if (until && cursor.getTime() > until) break;
    if (cursor.getTime() > winEnd) break;
    if (count && made >= count) break;
    if (freq === "WEEKLY" && byday) {
      // 해당 주의 지정 요일들
      const weekStart = new Date(cursor.getTime()); weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      for (const wd of byday) {
        const occ = new Date(weekStart.getTime()); occ.setUTCDate(occ.getUTCDate() + wd);
        occ.setUTCHours(ev.start.date.getUTCHours(), ev.start.date.getUTCMinutes(), 0, 0);
        if (occ.getTime() < ev.start.date.getTime()) continue;
        if (until && occ.getTime() > until) continue;
        if (count && made >= count) break;
        pushIf(occ); made++;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 7 * interval);
    } else {
      pushIf(cursor); made++;
      if (freq === "DAILY") cursor.setUTCDate(cursor.getUTCDate() + interval);
      else if (freq === "WEEKLY") cursor.setUTCDate(cursor.getUTCDate() + 7 * interval);
      else if (freq === "MONTHLY") cursor.setUTCMonth(cursor.getUTCMonth() + interval);
      else if (freq === "YEARLY") cursor.setUTCFullYear(cursor.getUTCFullYear() + interval);
      else break; // 미지원 FREQ
    }
    if (out.length > cap) break;
  }
  return out;
}

async function fetchIcs(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "UCC-Calendar/1.0" } });
    if (!r.ok) return "";
    return await r.text();
  } catch (e) { return ""; }
  finally { clearTimeout(to); }
}

async function refresh() {
  const urls = ICS_URLS();
  if (!urls.length) { _cache = { events: [], fetchedAt: Date.now(), loading: null }; return _cache.events; }
  const winStart = kstToday().getTime() - WIN_BACK * 86400000;
  const winEnd = kstToday().getTime() + WIN_FWD * 86400000;
  const all = [];
  for (const u of urls) {
    const text = await fetchIcs(u);
    if (!text) continue;
    for (const ev of parseICS(text)) {
      for (const occ of expand(ev, winStart, winEnd)) {
        const k = keys(occ.start);
        all.push({
          dateKey: k.dateKey,
          time: occ.allDay ? "" : k.time,
          endTime: occ.allDay ? "" : keys(new Date(occ.start.getTime() + occ.durMs)).time,
          allDay: occ.allDay,
          summary: occ.summary,
          location: occ.location,
          description: occ.description,
          _start: occ.start.getTime(),
          durMs: occ.durMs,
        });
        // 여러 날에 걸친 종일 일정은 각 날짜에 배치
        if (occ.allDay && occ.durMs > 86400000) {
          const days = Math.min(31, Math.round(occ.durMs / 86400000));
          for (let i = 1; i < days; i++) {
            const d2 = new Date(occ.start.getTime() + i * 86400000);
            all.push({ dateKey: keys(d2).dateKey, time: "", endTime: "", allDay: true, summary: occ.summary, location: occ.location, description: occ.description, _start: d2.getTime(), durMs: 86400000 });
          }
        }
      }
    }
  }
  all.sort((a, b) => a._start - b._start || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1));
  _cache = { events: all, fetchedAt: Date.now(), loading: null };
  console.log(`[gcal] 구글 캘린더 동기화: ${all.length}건 (소스 ${urls.length}개)`);
  return all;
}

/** 캐시된 이벤트(필요시 갱신). */
async function getEvents() {
  if (!ICS_URLS().length) return [];
  if (_cache.events.length && Date.now() - _cache.fetchedAt < REFRESH_MS) return _cache.events;
  if (_cache.loading) return _cache.loading.then(() => _cache.events);
  _cache.loading = refresh().catch(() => {}).finally(() => { _cache.loading = null; });
  await _cache.loading;
  return _cache.events;
}

function isConfigured() { return ICS_URLS().length > 0; }

/** 월(YYYY, 1~12) → { day(1~31): [events] } */
async function monthMap(year, month) {
  const evs = await getEvents();
  const prefix = `${year}-${pad(month)}-`;
  const map = {};
  for (const e of evs) if (e.dateKey.startsWith(prefix)) { const d = +e.dateKey.slice(8, 10); (map[d] = map[d] || []).push(e); }
  return map;
}
/** 특정일(YYYY-MM-DD) 이벤트 */
async function dayEvents(dateKey) {
  const evs = await getEvents();
  return evs.filter((e) => e.dateKey === dateKey);
}
/** 특정일이 속한 주(월~일) → [{dateKey, weekday, events}] */
async function weekEvents(dateKey) {
  const evs = await getEvents();
  const [Y, M, D] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(Y, M - 1, D));
  const dow = base.getUTCDay(); // 0=일
  const mondayOffset = (dow === 0 ? -6 : 1 - dow);
  const mon = new Date(base.getTime() + mondayOffset * 86400000);
  const names = ["월", "화", "수", "목", "금", "토", "일"];
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon.getTime() + i * 86400000);
    const k = keys(d).dateKey;
    week.push({ dateKey: k, weekday: names[i], events: evs.filter((e) => e.dateKey === k) });
  }
  return week;
}

/** 서버 시작 시 프리페치 + 주기 갱신 */
function start() {
  if (!isConfigured()) { console.log("[gcal] GOOGLE_CALENDAR_ICS 미설정 — 캘린더 동기화 비활성"); return; }
  refresh().catch((e) => console.error("[gcal] 초기 동기화 실패:", e.message));
  setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS);
}

module.exports = { isConfigured, getEvents, monthMap, dayEvents, weekEvents, refresh, start };
