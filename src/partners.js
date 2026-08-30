/* partners.js — 기업회원 페이지 상단의 '임원사(EXECUTIVE PARTNERS)' 소개 데이터.
 * 임원사 = 기업회원 중 이사회에 참여해 본부 운영·주요 의사결정에 함께하는 핵심 기업.
 * 새 임원사를 추가하려면 아래 배열에 항목을 넣으면 기업회원 페이지(박스+전체보기 테이블)에 자동 반영됩니다.
 *   name    기업명
 *   field   분야·업종
 *   region  지역(선택)
 *   intro   박스/테이블에 표시할 한두 문장 소개
 *   url     홈페이지(선택, 없으면 빈 문자열)
 *   featured 상단 박스 노출 여부(true/false)
 */
"use strict";

const PARTNERS = [
  {
    name: "(주)DS두뇌로세계로",
    field: "에듀테크 · 인재양성",
    region: "세종",
    intro: "두뇌개발·창의교육 콘텐츠 기업으로, 지역 청소년과 주민을 위한 교육 프로그램을 본부와 함께 기획·운영합니다.",
    url: "",
    featured: true,
  },
  {
    name: "(주)이인벤션",
    field: "기술혁신 · 제품개발",
    region: "세종",
    intro: "창의적 제품·기술 개발 기업으로, 도시문제 해결을 위한 리빙랩·실증 사업과 공동 연구개발에 협력합니다.",
    url: "",
    featured: true,
  },
];

module.exports = { PARTNERS };
