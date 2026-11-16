/* notice-expiry.js — 알림마당 '공지' 자동 만료(10일)
 *
 * 규칙: 게시판 글을 '공지'로 체크하면(posts.pinned=1) 지정 시각(pinned_at)부터
 *   10일 동안만 상단 고정. 10일이 지나면 자동으로 공지가 풀리고(pinned=0) 일반
 *   게시물로 되돌아간다(pinned_at 도 비움).
 *
 * 동작: 서버 기동 즉시 1회 + 매시간 스윕. 기준 시각은 pinned_at(=공지 지정 시각,
 *   admin.js 에서 기록). pinned_at 이 빈 행(일반글)은 대상 아님.
 */
"use strict";

const { db } = require("./db");

const NOTICE_DAYS = 10;

/** 10일 경과한 공지를 일반 게시물로 되돌린다. 반환: 해제된 건수. */
function sweepExpired() {
  const cutoff = new Date(Date.now() - NOTICE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    // pinned_at(ISO 문자열) < cutoff → 10일 초과. ISO 문자열은 사전식 비교가 시간순과 일치.
    const info = db
      .prepare("UPDATE posts SET pinned = 0, pinned_at = '' WHERE pinned = 1 AND pinned_at != '' AND pinned_at < ?")
      .run(cutoff);
    if (info.changes > 0) console.log(`[notice] 공지 자동 해제 — ${info.changes}건(${NOTICE_DAYS}일 경과)`);
    return info.changes;
  } catch (e) {
    console.error("[notice] 공지 만료 스윕 오류:", e.message);
    return 0;
  }
}

/** 부팅 즉시 1회 + 주기(기본 1시간) 스윕 시작. */
function startNoticeSweeper(intervalMs = 60 * 60 * 1000) {
  sweepExpired(); // 기동 즉시(배포 직후 밀린 만료분 포함)
  const t = setInterval(sweepExpired, intervalMs);
  if (t.unref) t.unref();
  console.log(`[notice] 공지 자동 만료 스케줄러 시작 — ${NOTICE_DAYS}일 경과 공지를 매시 해제`);
}

module.exports = { sweepExpired, startNoticeSweeper, NOTICE_DAYS };
