/* calevents.js — 관리자가 사이트에서 직접 등록하는 회원 캘린더 일정(DB).
 * 구글 캘린더(iCal) 일정과 동일한 형태로 정규화해 반환한다. */
"use strict";

const { db } = require("./db");

function norm(r) {
  return {
    id: r.id,
    dateKey: r.event_date,
    time: r.start_time || "",
    endTime: r.end_time || "",
    allDay: !r.start_time,
    summary: r.title,
    location: r.location || "",
    description: r.memo || "",
    source: "site",
  };
}

/** 특정일(YYYY-MM-DD) */
function dayEvents(dateKey) {
  try { return db.prepare("SELECT * FROM cal_events WHERE event_date = ? ORDER BY (start_time='') DESC, start_time, id").all(dateKey).map(norm); }
  catch (e) { return []; }
}
/** 월(YYYY, 1~12) → { day: [events] } */
function monthMap(year, month) {
  const prefix = year + "-" + String(month).padStart(2, "0") + "-";
  const map = {};
  try {
    for (const r of db.prepare("SELECT * FROM cal_events WHERE event_date LIKE ? ORDER BY (start_time='') DESC, start_time, id").all(prefix + "%")) {
      const d = +r.event_date.slice(8, 10);
      (map[d] = map[d] || []).push(norm(r));
    }
  } catch (e) {}
  return map;
}
/** 관리 목록(다가오는 일정 우선 + 최근) */
function listForAdmin(limit = 200) {
  try { return db.prepare("SELECT * FROM cal_events ORDER BY event_date DESC, start_time").all().slice(0, limit); }
  catch (e) { return []; }
}
function add({ event_date, start_time, end_time, title, location, memo }) {
  db.prepare("INSERT INTO cal_events (event_date, start_time, end_time, title, location, memo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(event_date, start_time || "", end_time || "", title, location || "", memo || "", new Date().toISOString());
}
function get(id) { try { return db.prepare("SELECT * FROM cal_events WHERE id = ?").get(id) || null; } catch (e) { return null; } }
function update(id, { event_date, start_time, end_time, title, location, memo }) {
  db.prepare("UPDATE cal_events SET event_date=?, start_time=?, end_time=?, title=?, location=?, memo=? WHERE id=?")
    .run(event_date, start_time || "", end_time || "", title, location || "", memo || "", id);
}
function remove(id) { try { db.prepare("DELETE FROM cal_events WHERE id = ?").run(id); } catch (e) {} }

module.exports = { dayEvents, monthMap, listForAdmin, add, get, update, remove };
