# 모듈 M‑HL · 주요 최근 소식(Home Latest)

> 홈(`/`) 상단의 **"주요 최근 소식"**(LATEST UPDATES) 영역. 비동기 API 한 번으로 **최신 데일리뉴스 피처 카드 + 공지 3단(공지사항·사업안내·보도자료)**을 묶어 보여준다.
> 정적 홈(`index.html`)에 빈 컨테이너만 두고, 로드 후 `fetch('/api/home')`로 채우는 구조.
>
> 상위 문서: [`FRAMEWORK.md`](../FRAMEWORK.md) · 형제: [데일리뉴스](daily-news.md)(피처 카드 원천), [공동체본부활동](ucc-news.md)(같은 `/api/home`의 `news` 그리드).

---

## 0. 한눈에 보기

| 항목 | 값 |
|---|---|
| 노출 위치 | 홈 `/` 섹션 `#news-brief`, 컨테이너 `#briefGrid` |
| 데이터 | `GET /api/home` → `{ notices, newsletter }`(+`news`는 [공동체본부활동](ucc-news.md)) |
| 렌더 | `public/js/main.js`(briefGrid 조립) |
| 마크업 | `public/index.html` `#news-brief` |
| 구성 | ① 최신 데일리뉴스 피처 1건 + ② 공지 3단 카드 |
| 공지 보드 | `NOTICE_BOARDS = ['notice','press','business']` (`src/config.js`) |
| 요약 헬퍼 | `homeLead(content, summary)` (`src/routes/site.js`) |

---

## 1. 메뉴구성 · 마크업

홈은 정적 `index.html`. 섹션은 제목 + 빈 그리드(로딩 표시)만 둔다.

```html
<!-- ============ 주요 전달 소식 ============ -->
<section class="section news-brief" id="news-brief">
  <div class="container">
    <div class="section-head section-head--plain reveal">
      <div>
        <h2 class="section-title">주요 최근 소식</h2>
        <span class="section-en">LATEST UPDATES</span>
      </div>
    </div>
    <div class="brief-grid" id="briefGrid" aria-live="polite">
      <div class="brief-loading">불러오는 중…</div>
    </div>
  </div>
</section>
```

→ `main.js`가 `#briefGrid`를 찾아 `innerHTML`로 채운다. `aria-live="polite"`로 로드 완료를 보조공학에 알림.

---

## 2. 데이터 (`GET /api/home`, `src/routes/site.js`)

```js
// ① 공지 3단: 공지사항·사업안내·보도자료 — 각 보드 최신 1건(고정글 우선)
const notices = cfg.NOTICE_BOARDS.map((b) => {
  const row = db.prepare(
    "SELECT id, title, created_at FROM posts WHERE board = ? ORDER BY pinned DESC, id DESC LIMIT 1").get(b);
  const meta = cfg.BOARDS[b];
  return { board:b, name:meta.name, en:meta.en,
           post: row ? { id:row.id, title:row.title, date:cfg.formatDate(row.created_at) } : null };
});

// ② 최신 데일리뉴스 1건(피처 카드용)
const nl = db.prepare("SELECT id,title,summary,content,source,url,image1,image2,created_at FROM newsletter ORDER BY id DESC LIMIT 1").get();
const newsletter = nl ? {
  id, title, source, url, date: cfg.formatDate(nl.created_at),
  lead: homeLead(nl.content, nl.summary),               // 2문장 요약
  image1: genImg(nl.image1, nl.id), image2: genImg(nl.image2, nl.id), // 'gen'→SVG URL
} : null;

res.json({ notices, news, newsletter });   // news는 공동체본부활동 모듈
```

### `homeLead(content, summary)` — 요약 생성
- 본문을 문단 분리 후 **바이라인·저작권·기호성 짧은 문단 제거**(`기자`, `무단전재/재배포/ⓒ`, `[`·`▲` 시작 등).
- 정제 텍스트에서 **2문장 이상 + 약 180자(≈5줄)**까지. 비면 summary → 앞 240자.

---

## 3. 렌더 (`public/js/main.js`)

`fetch('/api/home')` 성공 시 `briefGrid`에 두 묶음을 순서대로 조립:

**① 데일리뉴스 피처** (`data.newsletter` 있으면):
```
<a class="nl-feature" href="/newsletter/:id">
  좌: 배지"데일리뉴스" + 제목 + 요약(lead) + 출처·날짜
  우: image1(single)  // 있을 때만
```
`.brief-grid--feature` 클래스가 그리드에 추가됨.

**② 공지 3단 카드** (`data.notices`):
- 순서 보정 `{ notice:0, business:1, press:2 }` → 공지사항 → 사업안내 → 보도자료.
- 글 있으면 `/board/:board/:id` 링크(배지·영문·제목·날짜·화살표), 없으면 "등록된 게시물이 없습니다" + 보드 링크.
- `.brief-card.brief-card--<board>` 클래스로 보드별 색.

실패 시 `briefGrid`에 "소식을 불러오지 못했습니다" 표시.

---

## 4. 재사용 체크리스트

**바꿀 것:**
1. **공지 보드** — `src/config.js` `NOTICE_BOARDS` 배열(어떤 보드 3개를 3단으로 쓸지).
2. **카드 순서** — `main.js`의 `order` 맵(`{notice:0,business:1,press:2}`).
3. **피처 원천** — 데일리뉴스 대신 다른 콘텐츠를 피처로 쓰려면 `/api/home`의 `newsletter` 블록과 `main.js` `nl-feature` 교체.
4. **섹션 제목·마크업** — `index.html` `#news-brief`.
5. **요약 규칙** — `homeLead`(문장 수·길이·제거 패턴).

**그대로 가져갈 코어:** `/api/home` JSON 패턴(정적 홈 + 비동기 채움), 고정글 우선 최신 1건 쿼리, 로딩/실패 폴백.

---

## 5. 주의사항 (Gotchas)

- **홈은 정적 `index.html`(메모리 캐시).** 섹션 **구조(HTML)**를 바꾸면 반드시 서버 재시작(`pm2 restart`). 단, 데이터는 `/api/home`이 매번 최신이라 글 추가엔 재시작 불필요.
- **피처 이미지 `gen` 치환.** 데일리뉴스 이미지가 `"gen"`이면 `/newsletter/gen/:id.svg`로 바꿔 내려줌.
- **CSP:** 외부 이미지(`background-image`)를 쓰므로 `img-src` 외부 허용 필요([[site-csp-constraint]]).
- **빈 상태 처리 필수.** 글/뉴스레터가 없을 때의 폴백이 `main.js`에 포함 — 제거 금지.
- **개인정보 금지.** `/api/home`은 공개 엔드포인트 — 민감정보(이메일 등) 내려주지 말 것.

---

## 6. 흐름 요약

```
홈 로드 → #briefGrid "불러오는 중…"
        → fetch('/api/home')
            notices: [공지·사업·보도] 각 최신1건(pinned 우선)
            newsletter: 최신1건 + homeLead 요약 + 이미지(gen치환)
        → main.js 조립: [데일리뉴스 피처] + [공지 3단 카드]
        → #briefGrid 교체 (실패 시 안내 문구)
```
