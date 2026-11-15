/* i18n.js — UI(크롬) 문자열 한국어 → 영어 사전
 *
 * 한국어 | ENGLISH 이원화에서 '정적 UI 라벨'(네비·버튼·배너·푸터 등)을 번역한다.
 * DB 콘텐츠는 _en 컬럼(Gemini 번역)을 쓰고, 여기 사전은 템플릿의 고정 문자열 전용.
 *
 * 사용: 템플릿에서 L('공지사항') — lang=en 이면 영어, 아니면 한국어 원문.
 * 사전에 없으면 원문(한국어)을 그대로 반환(점진 번역 가능).
 */
"use strict";

// 한국어 원문 → 영어. 키는 템플릿에 나오는 한글 그대로.
const EN = {
  // 브랜드/공통
  "도시공동체본부": "Urban Community Center",
  "사단법인 도시공동체본부": "Urban Community Center (UCC)",
  "한국어": "한국어",
  "ENGLISH": "ENGLISH",

  // 상단 네비(대분류)
  "본부소개": "About",
  "프로젝트": "Projects",
  "알림마당": "News & Notices",
  "배움터": "Learning",
  "함께하는사람들": "People",
  "멤버십캘린더": "Membership Calendar",
  "업무관리": "Work",
  "마이페이지": "My Page",
  "로그아웃": "Log out",
  "로그인": "Log in",
  "회원가입": "Sign up",
  "관리자": "Admin",

  // 본부소개 하위
  "인사말": "Greeting",
  "비전과 목표": "Vision & Goals",
  "ESG경영": "ESG Management",
  "연혁": "History",
  "조직도": "Organization",
  "기관CI/소개자료": "CI / Brochure",
  "오시는길": "Directions",

  // 프로젝트 하위
  "두잉새롬마당": "Doing Saerom Forum",
  "커뮤니티모임": "Community Meetups",
  "햇빛소득마을": "Solar Income Village",
  "문화예술과학융합": "Culture·Art·Science Convergence",
  "X시그마플랫폼": "X-Sigma Platform",
  "지역회복 표준체계": "Regional Recovery Framework",

  // 알림마당 하위(게시판)
  "공지사항": "Notices",
  "사업안내": "Programs",
  "보도자료": "Press",
  "데일리뉴스": "Daily News",
  "지구촌소식브리프": "Global Brief",
  "도시공동체본부 활동": "UCC Activities",

  // 배움터 하위
  "주요과정소개": "Courses",
  "AI활용전문가과정": "AI Specialist Course",
  "ESG전문가과정": "ESG Specialist Course",
  "지역혁신개발전문가과정": "Regional Innovation Course",
  "연간교육일정": "Annual Schedule",
  "교육과정개설": "Open a Course",
  "교육신청하기": "Apply",
  "교육 신청하기": "Apply for Training",

  // 함께하는사람들 하위
  "임원진": "Executives",
  "정회원": "Full Members",
  "개인회원": "Individual",
  "기업회원": "Corporate",
  "단체회원": "Organization",
  "준회원": "Associate Members",

  // 게시판 공통
  "전체": "All",
  "번호": "No.",
  "제목": "Title",
  "출처": "Source",
  "키워드": "Keyword",
  "등록일": "Date",
  "조회": "Views",
  "검색": "Search",
  "제목·내용 검색": "Search title or content",
  "＋ 글쓰기": "+ Write",
  "글쓰기": "Write",
  "목록으로": "Back to list",
  "이전": "Prev",
  "다음": "Next",
  "작성자": "By",
  "작성일": "Date",
  "조회수": "Views",
  "공유": "Share",
  "공지": "Notice",
  "첨부파일": "Attachments",
  "다운로드": "Download",
  "수정": "Edit",
  "삭제": "Delete",
  "저장": "Save",
  "취소": "Cancel",
  "확인": "Confirm",
  "닫기": "Close",
  "보도": "Reported",
  "원문 보기": "View original",
  "더보기": "More",
  "아직 등록된 글이 없습니다.": "No posts yet.",
  "검색 결과": "search results",
  "페이지": "Page",
  "이전 글이 없습니다": "No previous post",
  "다음 글이 없습니다": "No next post",
  "원문 보기 →": "View original →",
  "전체보기 →": "View all →",

  // 게시판 설명(배너)
  "본부의 새 소식과 안내를 전합니다.": "News and announcements from the Center.",
  "언론 보도와 배포 자료를 모았습니다.": "Press coverage and media materials.",
  "진행 사업과 프로그램을 안내합니다.": "Our ongoing projects and programs.",
  "본부의 활동 소식과 이미지 자료입니다.": "Activity news and photos from the Center.",
  "지역·시민 주도의 공동체 회복과 지속가능한 도시를 위한 세계의 흐름을, 매주 한 편의 브리프로 모아 전해드립니다.": "A weekly brief on global trends in community-led recovery and sustainable cities.",

  // 홈 섹션
  "주요 최근 소식": "Latest Updates",
  "핵심 활동 방향": "What We Do",

  // 푸터/연락
  "문의하기": "Contact",
  "개인정보처리방침": "Privacy Policy",
  "이용약관": "Terms of Use",
  "이메일무단수집거부": "No Email Collection",

  // 랜딩 히어로(제목이 <strong>·<br>로 쪼개져 있어 조각 단위로 자연스럽게 교정)
  //  AI: "누구나 쓰는 AI,<br><strong>나의 무기</strong>로 만드세요" → "Make everyday AI / your weapon."
  "누구나 쓰는 AI,": "Make everyday AI",
  "나의 무기": "your weapon",
  "로 만드세요": ".",
  //  ESG: "지속가능의 시대,<br><strong>ESG 전문가</strong>로 앞서가세요"
  "지속가능의 시대,": "The age of sustainability —",
  "ESG 전문가": "lead as an ESG Expert",
  "로 앞서가세요": ".",
  //  RDC: "지역을 되살리는 힘,<br><strong>지역혁신개발전문가(RDC)</strong>"
  "지역을 되살리는 힘,": "The power to revive regions —",
  "지역혁신개발전문가(RDC)": "Regional Innovation Development Expert (RDC)",

  // AI과정 수료생 분야 통계 라벨(src/aistats.js — .js 데이터라 사전 스캔 제외분)
  "기획·전략": "Planning & Strategy",
  "행정·공공": "Administration & Public",
  "마케팅·홍보": "Marketing & PR",
  "연구·R&amp;D": "Research &amp; R&D",
  "교육·강사": "Education & Instruction",
  "공공기관·지자체": "Public Institutions & Local Gov.",
  "중소기업": "SMEs",
  "대학·연구기관": "Universities & Research",
  "사회적경제·비영리": "Social Economy & Nonprofit",
  "스타트업·1인기업": "Startups & Solo Businesses",
  "기타": "Other",

  // 캘린더 요일(단일 글자는 전역 치환 위험 → 캘린더 템플릿에서 lang 처리하고, 여기서는 안전한 것만)
  "연간교육일정": "Annual Schedule",
};

/** lang='en' 이면 사전의 영어, 없거나 한국어면 원문 그대로. */
function L(lang, ko) {
  if (lang !== "en") return ko;
  const key = String(ko == null ? "" : ko);
  return Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : ko;
}

// 자동 생성 사전(뷰 고정 한글 → 영어) 병합. tools/build-ui-dict.js 산출물(선택).
let GEN = {};
try { GEN = require("./i18n-generated.json"); } catch (e) { GEN = {}; }
// 수동 사전(EN)이 생성 사전보다 우선(정제된 번역 유지).
const MERGED = Object.assign({}, GEN, EN);

// 렌더된 HTML에서 UI 라벨을 영어로 치환하되, '텍스트 노드/속성값 전체가 사전 키와 정확히
// 일치할 때만' 바꾼다. ★부분 문자열 치환 금지★ — 그래야 한국어 폴백 본문(번역 전 _en 공백)의
// 문장 속 단어(마을·지역·으로 등)를 건드려 깨뜨리는 일이 없다.
const DECO_RE = /^([\s\S]*?)(\s*(?:→|←|»|«|›|‹|→|←)+)$/; // 끝의 화살표 장식 분리
function lookup(key) {
  if (!key || !/[가-힣]/.test(key)) return null;
  let en = MERGED[key];
  if (en != null && en !== key) return en;
  const m = key.match(DECO_RE); // "교육 신청하기 →" 처럼 끝 장식이 붙은 라벨 대응
  if (m) {
    const base = m[1].trim();
    const v = MERGED[base];
    if (v != null && v !== base && /[가-힣]/.test(base)) return v + m[2];
  }
  return null;
}
function translateHtml(html) {
  let s = String(html);
  // 1) 텍스트 노드(>...<) — 노드 전체가 키와 일치할 때만
  s = s.replace(/>([^<>]+)</g, (m, text) => {
    const key = text.replace(/\s+/g, " ").trim();
    const en = lookup(key);
    if (en == null) return m;
    const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
    return ">" + lead + en + trail + "<";
  });
  // 2) 번역 가능한 속성값(정확 일치)
  s = s.replace(/\b(placeholder|alt|title|aria-label)="([^"]*)"/gi, (m, attr, val) => {
    const en = lookup(val.replace(/\s+/g, " ").trim());
    return en == null ? m : `${attr}="${en}"`;
  });
  return s;
}

module.exports = { L, EN, translateHtml };
