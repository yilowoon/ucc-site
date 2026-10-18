/* kakaoparse.js — 카카오톡 '대화 내보내기(.txt)' 파싱(무의존).
 * PC/모바일 내보내기 포맷을 모두 처리해 메시지 배열로 변환.
 *   반환: { messages: [{ msg_at:'YYYY-MM-DD HH:MM', sender, content }], from, to, participants[] }
 */
"use strict";

const pad = (n) => String(n).padStart(2, "0");

// "오전/오후 H:MM" → 24h "HH:MM"
function to24(ampm, h, m) {
  h = parseInt(h, 10); m = parseInt(m, 10);
  if (ampm === "오후" && h < 12) h += 12;
  if (ampm === "오전" && h === 12) h = 0;
  return pad(h) + ":" + pad(m);
}

// 날짜 헤더: "2026년 10월 18일 토요일" / "--------------- 2026년 10월 18일 ... ---------------"
const RE_DATE = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;
// 모바일: "2026년 10월 18일 오전 9:30, 홍길동 : 내용"  또는  "오전 9:30, 홍길동 : 내용"
const RE_MOBILE_FULL = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*([^:]+?)\s*:\s*([\s\S]*)$/;
const RE_MOBILE_TIME = /^(오전|오후)\s*(\d{1,2}):(\d{2}),\s*([^:]+?)\s*:\s*([\s\S]*)$/;
// PC: "[홍길동] [오전 9:30] 내용"
const RE_PC = /^\[([^\]]+)\]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})\]\s*([\s\S]*)$/;

function parse(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/﻿/g, "");
  const lines = raw.split("\n");
  const messages = [];
  let curDate = "";          // 'YYYY-MM-DD'
  let last = null;           // 직전 메시지(여러 줄 이어붙이기용)

  for (const lineRaw of lines) {
    const line = lineRaw.replace(/\s+$/g, "");
    if (!line.trim()) { if (last) last.content += "\n"; continue; }

    // 날짜 전용 헤더
    const onlyDate = line.match(/^-*\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*$/);
    if (onlyDate && !RE_MOBILE_FULL.test(line) && !/:\s/.test(line.replace(RE_DATE, ""))) {
      curDate = onlyDate[1] + "-" + pad(onlyDate[2]) + "-" + pad(onlyDate[3]);
      last = null;
      continue;
    }

    let m;
    if ((m = line.match(RE_MOBILE_FULL))) {
      curDate = m[1] + "-" + pad(m[2]) + "-" + pad(m[3]);
      last = { msg_at: curDate + " " + to24(m[4], m[5], m[6]), sender: m[7].trim(), content: m[8] };
      messages.push(last); continue;
    }
    if ((m = line.match(RE_MOBILE_TIME))) {
      last = { msg_at: (curDate ? curDate + " " : "") + to24(m[1], m[2], m[3]), sender: m[4].trim(), content: m[5] };
      messages.push(last); continue;
    }
    if ((m = line.match(RE_PC))) {
      last = { msg_at: (curDate ? curDate + " " : "") + to24(m[2], m[3], m[4]), sender: m[1].trim(), content: m[5] };
      messages.push(last); continue;
    }
    // 그 외 — 직전 메시지의 이어지는 줄
    if (last) last.content += "\n" + line;
  }

  // content 정리 + 시스템/빈 메시지 제거
  const SYS = /(님이 (들어왔|나갔)습니다|채팅방 관리자|저장한 날짜|운영정책|대화내용)/;
  const out = [];
  const senders = new Set();
  for (const msg of messages) {
    msg.content = (msg.content || "").trim();
    if (!msg.sender || !msg.content) continue;
    if (SYS.test(msg.content) && msg.content.length < 30) continue;
    senders.add(msg.sender);
    out.push(msg);
  }
  out.forEach((m, i) => (m.seq = i + 1));
  return {
    messages: out,
    from: out.length ? out[0].msg_at.slice(0, 10) : "",
    to: out.length ? out[out.length - 1].msg_at.slice(0, 10) : "",
    participants: [...senders],
  };
}

module.exports = { parse };
