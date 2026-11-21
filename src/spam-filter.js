/* spam-filter.js — 교육신청 등 사용자 입력의 광고·스팸·성인물 문구 감지
 *
 * isSpam(text) → { spam: boolean, reason: string }
 *
 * 설계:
 *  - STRONG: 한 번만 나와도 스팸(도박·성인물·대출·코인리딩·SEO백링크 등 명백한 광고).
 *  - WEAK  : 단독으로는 정상일 수 있어(마케팅 문의 등), 2개 이상 겹치거나 URL 과 함께일 때만 스팸.
 *  - URL   : 링크가 2개 이상이면 광고 가능성 — WEAK 1개와 결합 시 스팸.
 *  - 오탐 최소화: 정규 교육문의(AI·ESG·지역혁신 등)에서 흔한 단어는 STRONG 에 넣지 않는다.
 *
 * 필요 시 STRONG/WEAK 목록만 조정하면 된다(코드 변경 불필요).
 */
"use strict";

// 한 번만 나와도 거절 — 명백한 불법/성인/도박/대출/홍보성 스팸
const STRONG = [
  // 도박
  "카지노", "바카라", "슬롯머신", "토토", "사설토토", "베팅", "배팅", "도박", "먹튀", "꽁머니",
  "casino", "baccarat", "betting", "gambling", "poker",
  // 성인물
  "성인물", "야동", "음란", "조건만남", "오피스텔성인", "출장안마", "안마방", "휴게텔", "성인용품",
  "porn", "xxx", "sexcam", "escort", "adult video",
  // 대출·금융사기
  "무담보대출", "작업대출", "급전대출", "소액대출", "신용대출광고", "일수대출", "대출상담사",
  "payday loan", "forex signal",
  // 코인·투자 리딩방
  "코인리딩", "리딩방", "주식리딩", "수익보장", "원금보장", "급등주", "세력주", "펌핑",
  "pump and dump", "guaranteed profit",
  // SEO·백링크·DB판매 스팸
  "상위노출", "백링크", "구글상위", "검색상위작업", "홈페이지상위", "db판매", "디비판매", "db팝니다",
  "backlink", "seo ranking", "mass email",
  // 의약품 스팸
  "비아그라", "시알리스", "viagra", "cialis",
];

// 단독으로는 정상일 수 있는 약한 신호 — 2개 이상 겹치거나 URL 동반 시 스팸
const WEAK = [
  "광고문의", "홍보대행", "재택부업", "부업", "투잡", "월수익", "고수익", "즉시수익",
  "이벤트당첨", "당첨되셨습니다", "무료체험권", "지금클릭", "클릭하세요", "텔레그램문의",
  "promotion", "click here", "limited offer", "work from home",
];

// 입력에서 비교용 정규화: 소문자 + 공백/구두점 제거(띄어쓰기 회피 스팸 대응)
function normalize(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[\s .,·・…_\-~!?]/g, "");
}

function countUrls(s) {
  const m = String(s || "").match(/https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(?:com|net|org|co\.kr|kr|xyz|top|biz|info|ru|cn)\b/gi);
  return m ? m.length : 0;
}

/** 텍스트에 광고·스팸·성인물 문구가 포함됐는지 판정. */
function isSpam(text) {
  const raw = String(text == null ? "" : text);
  if (!raw.trim()) return { spam: false, reason: "" };
  const norm = normalize(raw);

  for (const kw of STRONG) {
    if (norm.includes(normalize(kw))) return { spam: true, reason: `광고·스팸 문구 감지("${kw}")` };
  }

  const weakHits = WEAK.filter((kw) => norm.includes(normalize(kw)));
  const urls = countUrls(raw);
  if (weakHits.length >= 2) return { spam: true, reason: `광고성 문구 반복 감지("${weakHits.slice(0, 2).join(", ")}")` };
  if (weakHits.length >= 1 && urls >= 1) return { spam: true, reason: `광고성 문구+링크 감지("${weakHits[0]}")` };
  if (urls >= 3) return { spam: true, reason: "다수 링크 감지(광고 추정)" };

  return { spam: false, reason: "" };
}

module.exports = { isSpam, STRONG, WEAK };
