/* partners.js — 기업회원 페이지 상단의 '임원사(EXECUTIVE PARTNERS)' 소개 데이터.
 * 임원사 = 기업회원 중 이사회에 참여해 본부 운영·주요 의사결정에 함께하는 핵심 기업.
 * 새 임원사를 추가하려면 아래 배열에 항목을 넣으면 기업회원 페이지(박스+전체보기 테이블)에 자동 반영됩니다.
 *   name     기업명 (필수)
 *   logo     로고(CI) 이미지 경로 (선택) — 예: "/img/partners/ds.png"
 *   ceo      대표이사 (선택)
 *   field    주요사업분야 (선택)
 *   intro    회사 비즈니스 설명 한두 문장 (선택)
 *   address  주소 (선택)
 *   phone    연락처 (선택)
 *   url      홈페이지 (선택, 없으면 빈 문자열)
 *   region   지역 (선택, 테이블 표기용)
 *   featured 상단 박스 노출 여부(true/false)
 */
"use strict";

const PARTNERS = [
  {
    name: "(주)DS두뇌로세계로",
    logo: "/img/partners/ds.png",
    ceo: "이동은",
    field: "창의수학, 한글교육 전문",
    intro: "창의수학과 한글교육을 전문으로 하는 교육기업으로, 지역 아동·청소년을 위한 교육 프로그램을 본부와 함께 운영합니다.",
    address: "세종특별자치시 부강면 연청로 1161, 2동 202호",
    phone: "1670-9678",
    url: "https://www.9678.co.kr/",
    region: "세종",
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
  {
    name: "그린나래솔루션",
    field: "친환경 · 그린 솔루션",
    region: "",
    intro: "친환경 솔루션 기업으로, 지역의 지속가능한 도시환경 조성 사업에 본부와 협력합니다.",
    url: "",
    featured: true,
  },
  {
    name: "물산업연구조합",
    field: "물산업 · 연구",
    region: "",
    intro: "물산업 분야 연구조합으로, 물·환경 관련 연구와 실증 사업에 본부와 협력합니다.",
    url: "",
    featured: true,
  },
  {
    name: "(주)에너팜",
    field: "에너지 · 신재생",
    region: "",
    intro: "에너지 분야 기업으로, 햇빛소득마을 등 신재생에너지·에너지전환 사업에 본부와 협력합니다.",
    url: "",
    featured: true,
  },
];

module.exports = { PARTNERS };
