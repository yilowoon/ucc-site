/* naverblog.js — 게시판 글을 '네이버 블로그 원고'로 변환한다.
 *
 * ■ 왜 '자동 발행'이 아니라 '원고 생성'인가?
 *   네이버는 2020년 5월 6일자로 블로그 글쓰기 오픈API(writePost)를 종료했다.
 *   광고성 글이 API로 대량 게재되는 문제 때문이었고, 그 뒤로 외부 서버가
 *   네이버 블로그에 글을 직접 밀어 넣는 공식 경로는 존재하지 않는다.
 *   (참고: 네이버 오픈API 목록에는 '검색'만 남아 있고 '블로그 글쓰기'는 빠졌다.)
 *
 *   로그인 세션을 흉내 내 자동 게시하는 방법도 기술적으로는 있지만,
 *   네이버 이용약관 위반이고 계정 제재 대상이라 이 저장소에서는 쓰지 않는다.
 *
 *   그래서 이 모듈은 '사람이 마지막 한 번만 붙여넣으면 되는 상태'까지 자동화한다.
 *   즉 게시글 → 스마트에디터에 그대로 붙여넣을 수 있는 제목·본문·태그·이미지 목록.
 *
 * ■ 이 파일은 순수 변환 함수만 담는다(DB·Express 의존 없음).
 *   덕분에 라우트 없이도 동작을 확인할 수 있고, 테스트하기 쉽다.
 */
"use strict";

// ---------------------------------------------------------------------------
// 설정 (환경변수)
// ---------------------------------------------------------------------------
// NAVER_BLOG_ID        : 우리 블로그 아이디(blog.naver.com/<여기>). 글쓰기 버튼 링크에 쓴다.
// NAVER_BLOG_WRITE_URL : 글쓰기 화면 주소를 직접 지정하고 싶을 때(네이버가 주소를 바꾸면 여기만 고치면 된다).
// NAVER_BLOG_TAGS      : 모든 글에 공통으로 붙일 태그. 쉼표로 구분. 미설정 시 기본값 사용.

const DEFAULT_TAGS = ["도시공동체본부", "사회연대경제", "지역회복", "공동체"];

// 게시판별로 어울리는 태그를 하나씩 더 붙여 준다.
const BOARD_TAGS = {
  notice: ["공지사항"],
  press: ["보도자료"],
  business: ["사업안내"],
  news: ["활동소식"],
  global: ["지구촌소식브리프", "해외사례"],
};

// 네이버 블로그 제약·권장값 (체크리스트 판정 기준)
const LIMITS = {
  titleMax: 100, // 네이버 블로그 제목 입력 한도
  titleGood: 40, // 검색 결과에서 잘리지 않는 권장 길이
  bodyGood: 800, // 이 정도는 되어야 '정보성 글'로 읽힌다
  tagMax: 30, // 태그는 최대 30개
};

function blogId() {
  return (process.env.NAVER_BLOG_ID || "").trim();
}

function blogHomeUrl() {
  const id = blogId();
  return id ? `https://blog.naver.com/${encodeURIComponent(id)}` : "";
}

/** 네이버 블로그 글쓰기 화면 주소.
 *  네이버가 주소 체계를 바꿔도 NAVER_BLOG_WRITE_URL 환경변수로 덮어쓸 수 있게 했다. */
function blogWriteUrl() {
  const custom = (process.env.NAVER_BLOG_WRITE_URL || "").trim();
  if (custom) return custom;
  const id = blogId();
  return id ? `https://blog.naver.com/${encodeURIComponent(id)}?Redirect=Write` : "";
}

function commonTags() {
  const raw = (process.env.NAVER_BLOG_TAGS || "").trim();
  if (!raw) return DEFAULT_TAGS.slice();
  return raw.split(",").map((t) => t.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 텍스트 다듬기
// ---------------------------------------------------------------------------

/** 혹시 본문에 HTML 태그가 섞여 있으면 제거한다.
 *  (게시판 본문은 순수 텍스트가 원칙이지만, 외부에서 붙여넣은 글이 있을 수 있다.) */
function stripTags(s) {
  return String(s == null ? "" : s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "");
}

/** 줄바꿈을 통일하고, 빈 줄이 3줄 이상 이어지면 2줄로 줄인다. */
function normalize(s) {
  return stripTags(s)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 빈 줄 기준으로 문단을 나눈다. */
function paragraphs(text) {
  return normalize(text).split(/\n{2,}/).filter((p) => p.trim());
}

/** 첫 문단을 한 문장 요약(리드)으로 다듬는다. 길면 문장 경계에서 자른다. */
function leadSentence(text, max = 120) {
  const first = (paragraphs(text)[0] || "").replace(/\n/g, " ").trim();
  if (!first) return "";
  if (first.length <= max) return first;
  // 마침표 뒤에서 끊어 자연스럽게 자른다.
  const cut = first.slice(0, max);
  const dot = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("다"), cut.lastIndexOf("!"));
  return (dot > max * 0.5 ? cut.slice(0, dot + 1) : cut.trim() + "…");
}

// 태그로 뽑으면 안 되는 흔한 낱말 (조사·접속사·형식어)
const STOP_WORDS = new Set([
  "그리고", "그러나", "하지만", "또한", "우리는", "위하여", "위한", "대한", "통해", "관련",
  "있습니다", "합니다", "입니다", "때문에", "지역의", "사업의", "제1회", "제2회", "안내",
  "개최", "실시", "모집", "결과", "공고", "신청", "보도자료", "공지사항",
  // 부사 — 뜻은 있지만 태그로는 쓸모가 없다
  "스스로", "직접", "함께", "다시", "새로", "모두", "서로", "가장", "더욱", "특히",
]);

// 낱말 끝에 붙는 조사 — 태그에서는 떼어 낸다("표준체계를" → "표준체계")
const JOSA = /(으로써|으로서|에게서|에서는|으로|에서|에게|까지|부터|이나|라는|이라|을|를|은|는|이|가|의|에|와|과|로|도)$/;

// 조사처럼 끝나지만 낱말의 일부인 말 — 자르면 뜻이 망가진다("햇빛소득마을" → "햇빛소득마").
// 완전하지 않은 목록이다. 이상한 태그가 나오면 여기에 덧붙이면 된다.
const KEEP_WHOLE = /(마을|어린이|아이|놀이|회의|먹거리|살이)$/;

/** 제목에서 태그 후보 낱말을 뽑는다.
 *  형태소 분석기 없이도 쓸 만하도록, '두 글자 이상 한글/영문 낱말'만 단순 추출한 뒤
 *  조사를 떼고 서술어(…다/…요로 끝나는 말)를 걸러 낸다.
 *  정확도보다 읽기 쉬움을 택한 선택 — 관리자가 화면에서 태그를 손볼 수 있으니 충분하다. */
function keywordsFromTitle(title, limit = 4) {
  const words = String(title || "")
    .replace(/[\[\]()<>{}·,.!?"'“”‘’~\-—:;/|]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    // 서술어·관형형은 태그로 쓰지 않는다("논하다", "합니다", "만드는")
    // 한국어 명사가 '는'으로 끝나는 경우는 거의 없어, 통째로 걸러도 안전하다.
    .filter((w) => !/(다|요|까|는)$/.test(w))
    // 조사를 떼기 전에 한 번 거른다("스스로"를 "스스"로 만든 뒤엔 못 알아본다)
    .filter((w) => !STOP_WORDS.has(w))
    .map((w) => {
      if (KEEP_WHOLE.test(w)) return w;
      // 조사를 뗀다("표준체계를" → "표준체계"). 떼고 나서 한 글자만 남으면
      // 애초에 태그로 쓸 만한 말이 아니므로 버린다("힘을" → 버림, "나의" → 버림).
      const cut = w.replace(JOSA, "");
      return cut.length >= 2 ? cut : "";
    })
    .filter((w) => w.length >= 2 && w.length <= 12)
    .filter((w) => /[가-힣A-Za-z]/.test(w))
    .filter((w) => !STOP_WORDS.has(w));

  const seen = new Set();
  const out = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

/** 공통 태그 + 게시판 태그 + 제목 키워드를 합쳐 중복을 없앤다. */
function buildTags(post) {
  const all = [
    ...commonTags(),
    ...(BOARD_TAGS[post.board] || []),
    ...keywordsFromTitle(post.title),
  ];
  const seen = new Set();
  const out = [];
  for (const t of all) {
    // 네이버 태그는 공백을 허용하지 않는다 → 붙여쓰기로 변환
    const tag = String(t).replace(/[#\s]+/g, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= LIMITS.tagMax) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 원고 조립
// ---------------------------------------------------------------------------

const DIVIDER = "───────────────────";

/**
 * 게시글 하나를 네이버 블로그 원고로 변환한다.
 *
 * @param {object}   opts
 * @param {object}   opts.post         posts 테이블 행 (board, title, content, created_at ...)
 * @param {Array}    opts.attachments  attachments 테이블 행 배열 (없으면 빈 배열)
 * @param {string}   opts.baseUrl      사이트 절대 주소 (예: https://ucc.or.kr)
 * @param {string}   opts.boardName    게시판 표시 이름 (예: '보도자료')
 * @returns {{title, body, tags, tagLine, images, files, sourceUrl, checklist, bodyLength}}
 */
function buildDraft({ post, attachments = [], baseUrl = "", boardName = "" }) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const sourceUrl = `${base}/board/${post.board}/${post.id}`;

  const isImage = (a) => /^image\//.test(a.mimetype || "");
  const images = attachments.filter(isImage).map((a) => ({
    name: a.original,
    url: `${base}/uploads/${a.filename}`,
  }));
  const files = attachments.filter((a) => !isImage(a)).map((a) => ({
    name: a.original,
    url: `${base}/board/download/${a.id}`,
  }));

  const lead = leadSentence(post.content);
  const paras = paragraphs(post.content);
  const tags = buildTags(post);
  const tagLine = tags.map((t) => "#" + t).join(" ");

  // ---- 본문 조립 ----
  // 스마트에디터는 붙여넣은 줄바꿈을 그대로 살리므로, 여기서 만든 모양이 곧 발행 모양이다.
  const lines = [];

  if (lead) {
    lines.push(lead, "");
    lines.push(DIVIDER, "");
  }

  // 첫 문단은 리드로 이미 썼으므로 건너뛴다(리드가 첫 문단을 그대로 쓴 경우에 한해).
  const bodyParas = lead && paras[0] && paras[0].startsWith(lead.replace(/…$/, "")) ? paras.slice(1) : paras;
  for (const p of bodyParas) lines.push(p, "");

  if (images.length) {
    lines.push(DIVIDER, "");
    lines.push(`📷 사진 ${images.length}장 — 아래 순서대로 올려 주세요`);
    images.forEach((img, i) => lines.push(`  ${i + 1}. ${img.name}  ${img.url}`));
    lines.push("");
  }

  if (files.length) {
    lines.push(`📎 첨부자료`);
    files.forEach((f, i) => lines.push(`  ${i + 1}. ${f.name}  ${f.url}`));
    lines.push("");
  }

  lines.push(DIVIDER, "");
  lines.push(`🔗 원문 보기 — ${boardName || post.board}`);
  lines.push(sourceUrl, "");
  lines.push("사단법인 도시공동체본부");
  lines.push(base || "https://ucc.or.kr");
  // 태그는 본문에 넣지 않는다. 네이버는 태그 입력란에 넣은 태그를 글 하단에 자동으로
  // 보여 주므로, 본문에도 쓰면 같은 태그가 두 번 나온다. (원고 화면의 '태그 복사' 참고)

  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // 글자수는 '읽을 거리'만 센다. 링크·파일명·태그까지 넣으면 분량이 실제보다 부풀려진다.
  const bodyLength = paras.join("").replace(/\s/g, "").length;

  return {
    title: String(post.title || "").trim(),
    body,
    tags,
    tagLine,
    images,
    files,
    sourceUrl,
    bodyLength,
    checklist: buildChecklist({ title: post.title, bodyLength, tags, images }),
  };
}

/** 발행 전에 관리자가 눈으로 확인할 항목. ok=false 면 화면에서 주의 표시된다. */
function buildChecklist({ title, bodyLength, tags, images }) {
  const len = String(title || "").length;
  return [
    {
      ok: len > 0 && len <= LIMITS.titleMax,
      label: `제목 ${len}자`,
      hint: len > LIMITS.titleGood
        ? `검색 결과에서는 ${LIMITS.titleGood}자 안팎까지 보입니다. 핵심 낱말을 앞쪽에 두세요.`
        : "적정 길이입니다.",
    },
    {
      ok: bodyLength >= LIMITS.bodyGood,
      label: `본문 ${bodyLength.toLocaleString()}자(공백 제외)`,
      hint: bodyLength >= LIMITS.bodyGood
        ? "정보성 글로 충분한 분량입니다."
        : `${LIMITS.bodyGood}자 이상이면 검색 노출에 유리합니다. 배경·의미를 한두 문단 덧붙여 보세요.`,
    },
    {
      ok: images.length > 0,
      label: `사진 ${images.length}장`,
      hint: images.length
        ? "본문 흐름에 맞춰 나눠 배치하세요."
        : "사진이 한 장도 없으면 노출이 불리합니다. 현장 사진이나 포스터를 추가하세요.",
    },
    {
      ok: tags.length >= 3 && tags.length <= LIMITS.tagMax,
      label: `태그 ${tags.length}개`,
      hint: tags.length > LIMITS.tagMax
        ? `태그는 최대 ${LIMITS.tagMax}개입니다.`
        : "3~10개가 적당합니다. 글과 무관한 태그는 빼세요.",
    },
  ];
}

module.exports = {
  LIMITS,
  blogId,
  blogHomeUrl,
  blogWriteUrl,
  commonTags,
  buildTags,
  buildDraft,
  // 아래는 테스트·재사용용으로 함께 공개
  normalize,
  paragraphs,
  leadSentence,
  keywordsFromTitle,
};
