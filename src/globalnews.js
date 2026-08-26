/* 지구촌소식 AI기자 — 해외·국제 소식 자동 수집
 *
 * 도시공동체본부의 미션(지역재생·사회연대경제·에너지전환·지방소멸 대응)과
 * 맞닿은 해외 사례를 자동으로 찾아 'global' 게시판에 글로 올린다.
 *
 * - 소스: Daum 뉴스 검색(본문 요약까지 확보) → 실패 시 Google 뉴스 RSS
 *   두 수집 함수는 데일리뉴스(newsletter.js)의 것을 그대로 재사용한다.
 * - 저장 위치: 별도 테이블이 아니라 posts 테이블(board='global').
 *   다른 알림마당 게시판과 완전히 같은 구조라 목록·상세·관리자 화면이 그대로 동작한다.
 * - 저작권: 원문 전문을 저장하지 않는다. 제목 + 요약 발췌 + 출처·링크만 남긴다.
 * - 중복 방지: posts.source_guid 에 원문 식별자를 저장하고 부분 유니크 인덱스로 막는다.
 */
"use strict";

const { db } = require("./db");
const { fromDaum, fromGoogle } = require("./newsletter");

const AUTHOR = "지구촌소식 AI기자";
const BOARD = "global";

/**
 * 수집 주제. query 는 실제 검색어, angle 은 '왜 주목하나'에 들어갈 한 줄.
 * 본부 미션과의 접점을 사람이 미리 정해두고, 기사만 자동으로 붙인다.
 */
const TOPICS = [
  {
    name: "도시재생",
    query: "해외 도시재생 사례",
    angle: "쇠퇴한 도심을 되살린 해외 방식은 본부의 지역회복 표준체계를 다듬는 참고가 됩니다.",
  },
  {
    name: "사회연대경제",
    query: "유럽 사회적경제 정책",
    angle: "사회연대경제를 제도로 뒷받침하는 해외 사례는 국내 정책 설계의 비교 기준이 됩니다.",
  },
  {
    name: "에너지전환",
    query: "해외 주민참여 재생에너지 마을",
    angle: "주민이 발전 수익을 나누는 해외 모델은 햇빛소득마을 사업과 직접 맞닿아 있습니다.",
  },
  {
    name: "지방소멸",
    query: "해외 인구감소 지역 대응",
    angle: "인구가 줄어드는 지역을 어떻게 지탱하는지는 국내 지방소멸 대응의 선행 사례입니다.",
  },
  {
    name: "협동조합",
    query: "해외 협동조합 지역경제",
    angle: "협동조합이 지역경제를 떠받치는 구조는 커뮤니티 모임 사업의 확장 방향을 보여줍니다.",
  },
  {
    name: "기후적응",
    query: "해외 기후위기 도시 적응",
    angle: "기후 충격을 견디는 도시의 설계는 회복탄력성 논의의 출발점입니다.",
  },
];

const insertPost = db.prepare(
  `INSERT INTO posts (board, title, content, author, pinned, created_at, updated_at, source_guid)
   VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
);
const existsGuid = db.prepare("SELECT 1 FROM posts WHERE source_guid = ?");

/* ------------------------------------------------------------ 유틸 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ISO 시각 → 'YYYY. MM. DD.' (KST) */
function fmtKst(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}. ${String(k.getUTCMonth() + 1).padStart(2, "0")}. ${String(k.getUTCDate()).padStart(2, "0")}.`;
}

/**
 * 요약 문장을 다듬는다.
 * 원문 전문을 옮기지 않도록 앞부분 몇 문장만 발췌한다.
 */
function buildExcerpt(item) {
  const raw = String(item.summary || item.content || "").replace(/\s+/g, " ").trim();
  if (raw.length < 20) return "";
  const sentences = raw.match(/[^.!?。]+[.!?。]+/g) || [raw];
  const out = [];
  let len = 0;
  for (const s of sentences) {
    out.push(s.trim());
    len += s.length;
    if (len >= 220 || out.length >= 4) break;
  }
  let text = out.join(" ").trim();
  if (text.length > 420) text = text.slice(0, 419).trim() + "…";
  return text;
}

/**
 * 게시글 본문을 만든다.
 * 본문은 nl2br(escapeHtml(content)) 로 렌더되므로 HTML 없이 순수 텍스트여야 한다.
 */
function buildBody(item, topic) {
  const excerpt = buildExcerpt(item);
  const lines = [];

  if (excerpt) {
    lines.push(excerpt, "");
  } else {
    lines.push(`'${topic.query}' 관련 해외 보도입니다. 자세한 내용은 아래 원문 링크에서 확인하실 수 있습니다.`, "");
  }

  lines.push("○ 왜 주목하나", topic.angle, "");
  lines.push("○ 원문 정보");
  if (item.source) lines.push(`매체: ${item.source}`);
  lines.push(`보도: ${fmtKst(item.published_at)}`);
  if (item.url) lines.push(`링크: ${item.url}`);
  lines.push("");
  lines.push(
    "※ 본 게시물은 지구촌소식 AI기자가 공개된 보도를 자동으로 수집해 제목·요약 발췌·출처만 정리한 것입니다. " +
    "원문의 저작권은 해당 매체에 있으며, 전체 내용은 위 링크에서 확인해 주시기 바랍니다."
  );

  return lines.join("\n");
}

/** 제목 앞에 주제를 붙여 목록에서 분류가 보이게 한다 */
function buildTitle(item, topic) {
  const t = String(item.title || "").replace(/\s+/g, " ").trim();
  return `[${topic.name}] ${t}`.slice(0, 200);
}

/* -------------------------------------------------------- 1회 수집 */

/**
 * 한 번 실행에 최대 MAX_TOTAL 건, 주제당 MAX_PER_TOPIC 건까지만 저장한다.
 * 게시판이 한 번에 밀리지 않도록 의도적으로 적게 가져온다.
 */
async function collectOnce({ maxTotal = 2, maxPerTopic = 1 } = {}) {
  let inserted = 0, scanned = 0, skipped = 0;
  const titles = [];

  for (const topic of TOPICS) {
    if (inserted >= maxTotal) break;

    let items = [];
    try {
      items = await fromDaum(topic.query);
      if (!items || !items.length) items = await fromGoogle(topic.query);
    } catch (e) {
      console.error("[globalnews] 수집 실패:", topic.query, e.message);
      continue;
    }

    let perTopic = 0;
    for (const it of items || []) {
      if (perTopic >= maxPerTopic || inserted >= maxTotal) break;
      scanned++;

      if (!it.title || !it.guid) continue;
      const guid = "gn:" + String(it.guid).slice(0, 380);
      if (existsGuid.get(guid)) { skipped++; continue; }

      const now = new Date().toISOString();
      try {
        const res = insertPost.run(
          BOARD,
          buildTitle(it, topic),
          buildBody(it, topic),
          AUTHOR,
          it.published_at || now,   // 등록일을 원문 보도 시각으로
          now,
          guid
        );
        if (res.changes > 0) {
          inserted++; perTopic++;
          titles.push(buildTitle(it, topic));
        }
      } catch (e) {
        // 유니크 인덱스 충돌 등은 무시하고 다음 기사로
      }
      await sleep(150);
    }
    await sleep(300);
  }

  console.log(`[globalnews] 수집 완료: 신규 ${inserted}건 (검토 ${scanned}건, 중복 ${skipped}건)`);
  return { inserted, scanned, skipped, titles };
}

/* ------------------------- 스케줄러: 매일 07:00 / 19:00 (서버 시간) --- */

function msUntilNext(hours) {
  const now = new Date();
  let best = Infinity;
  for (const h of hours) {
    const t = new Date(now);
    t.setHours(h, 0, 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    best = Math.min(best, t.getTime() - now.getTime());
  }
  return best;
}

function startScheduler() {
  // 데일리뉴스(08:00/18:00)와 시간을 어긋나게 두어 외부 요청이 겹치지 않게 한다
  const HOURS = [7, 19];
  const run = async () => {
    try { await collectOnce(); } catch (e) { console.error("[globalnews] 스케줄 수집 오류:", e.message); }
    setTimeout(run, msUntilNext(HOURS));
  };
  setTimeout(run, msUntilNext(HOURS));
  const next = new Date(Date.now() + msUntilNext(HOURS));
  console.log(`[globalnews] 스케줄러 시작 — 다음 수집: ${next.toLocaleString()}`);
}

module.exports = { collectOnce, startScheduler, TOPICS, AUTHOR, BOARD };
