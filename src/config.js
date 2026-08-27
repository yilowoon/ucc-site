/* 게시판 정의 및 공용 헬퍼 */
"use strict";

// 고정 게시판. key 는 URL(/board/:key)과 DB(posts.board)에 그대로 사용.
const BOARDS = {
  notice: { key: "notice", name: "공지사항", en: "NOTICE", desc: "본부의 새 소식과 안내를 전합니다." },
  press: { key: "press", name: "보도자료", en: "PRESS", desc: "언론 보도와 배포 자료를 모았습니다." },
  business: { key: "business", name: "사업안내", en: "PROGRAMS", desc: "진행 사업과 프로그램을 안내합니다." },
  news: { key: "news", name: "도시공동체본부 활동", en: "UCC NEWS", desc: "본부의 활동 소식과 이미지 자료입니다.", image: true },
  global: {
    key: "global",
    name: "지구촌소식브리프",
    en: "GLOBAL BRIEF",
    desc: "지역·시민 주도의 공동체 회복과 지속가능한 도시를 위한 세계의 흐름을, 매주 한 편의 브리프로 모아 전해드립니다.",
  },
};
const BOARD_KEYS = Object.keys(BOARDS);
// 메인 '주요 전달 소식' 3박스에 쓰는 게시판(공지·보도·사업)
const NOTICE_BOARDS = ["notice", "press", "business"];

function isBoard(key) {
  return Object.prototype.hasOwnProperty.call(BOARDS, key);
}

// HTML 이스케이프 (XSS 방지)
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 줄바꿈을 <br>로 (먼저 이스케이프)
function nl2br(s) {
  return escapeHtml(s).replace(/\r\n|\r|\n/g, "<br>");
}

// 줄바꿈 <br> + http(s) URL 을 새 창 링크로 (먼저 이스케이프하므로 안전)
function nl2brLink(s) {
  return escapeHtml(s)
    .replace(/(https?:\/\/[^\s<]+)/g, (m) => {
      // 문장부호로 끝나면 링크에서 제외
      const tail = (m.match(/[.,!?)\]}'"]+$/) || [""])[0];
      const url = m.slice(0, m.length - tail.length);
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
    })
    .replace(/\r\n|\r|\n/g, "<br>");
}

// YYYY.MM.DD 형식 (KST)
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(iso)} ${hh}:${mm}`;
}

module.exports = {
  BOARDS,
  BOARD_KEYS,
  NOTICE_BOARDS,
  isBoard,
  escapeHtml,
  nl2br,
  nl2brLink,
  formatDate,
  formatDateTime,
};
