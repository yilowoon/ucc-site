# 모듈 M‑DN · 데일리뉴스(Daily News)

> 키워드 기반 외부 뉴스를 매일 자동으로 큐레이션해 보여주는 **자동 수집형 알림마당 콘텐츠**.
> 사용자가 글을 쓰지 않는다. 스케줄러가 기사를 모아 `newsletter` 테이블에 쌓고, 전용 페이지(`/newsletter`)와 홈 피처 박스에 노출한다.
> 이 문서 하나로 데일리뉴스를 **타 사이트에 그대로 이식**하거나 **키워드·주기·디자인만 바꿔 재사용**할 수 있도록 메뉴구성 + 전체 설정을 정리한다.
>
> 상위 프레임워크 문서: [`FRAMEWORK.md`](../FRAMEWORK.md) · 형제 모듈: 지구촌소식브리프(`src/globalnews.js`, board `global`) — 수집 함수(`fromDaum`/`fromGoogle`)를 공유한다.

---

## 0. 한눈에 보기

| 항목 | 값 |
|---|---|
| 공개 URL | `/newsletter` (목록), `/newsletter/:id` (상세), `/newsletter/gen/:id.svg` (생성 이미지) |
| 관리 URL | `/admin/newsletter`, `/admin?board=newsletter` |
| 엔진 | `src/newsletter.js` |
| 라우트 | 공개: `src/routes/site.js` / 관리: `src/routes/admin.js` |
| 데이터 | `newsletter` 테이블 (전용 테이블, `posts` 와 분리) |
| 뷰 | `views/newsletter.ejs`, `views/newsletter-post.ejs`, `views/admin-newsletter.ejs` |
| 수집 주기 | 매일 **08:00 / 18:00** (서버 로컬 시간) + 콜드스타트 시 1회 |
| 수집량 | 1회 **2건** (키워드당 1건, 이미지 2컷 이상인 기사만) |
| 소스 우선순위 | Daum 뉴스 → (키 있으면) 네이버 API → Google 뉴스 RSS |
| 필수 설정 | 없음(무키로도 동작). 선택: `GEMINI_API_KEY`, `NAVER_CLIENT_ID/SECRET` |
| 저작권 설계 | 원문 전문 저장 안 함 — **제목 + 요약 발췌 + 출처 링크**만 |

데일리뉴스는 **게시판(`posts`)이 아니다.** `board/:key` 라우트를 타지 않고 `/newsletter` 전용 라우트와 전용 테이블을 쓴다. 다만 UI(탭·관리자 목록)에서는 게시판처럼 **나란히** 보이도록 특수 처리한다.

---

## 1. 메뉴구성 (네비게이션 노출 위치)

데일리뉴스는 **‘알림마당’ 서브메뉴**의 한 항목이며, 총 5곳에 손으로 박아 넣는다. 메뉴를 바꾸면 **아래 5곳을 모두** 맞춰야 한다(메인 홈은 자체 네비라 별도 — 메모리 규칙 `main-nav-separate`).

| # | 파일 | 위치 | 코드 |
|---|---|---|---|
| 1 | `public/index.html` | 데스크톱 드롭다운 | `<li><a href="/newsletter">데일리뉴스</a></li>` (line ~75) |
| 2 | `public/index.html` | 모바일 메뉴 | `<a class="sub-link" href="/newsletter">데일리뉴스</a>` (line ~146) |
| 3 | `views/partials/header.ejs` | 데스크톱 드롭다운 | `<li><a href="/newsletter">데일리뉴스</a></li>` (line ~80) |
| 4 | `views/partials/header.ejs` | 모바일 메뉴 | `<a class="sub-link" href="/newsletter">데일리뉴스</a>` (line ~163) |
| 5 | `views/partials/board-tabs.ejs` | 알림마당 상단 탭 | `<a href="/newsletter" class="<%= onNewsletter ? 'active' : '' %>">데일리뉴스</a>` |

**알림마당 서브메뉴 순서(고정):** 공지사항 → 사업안내 → 보도자료 → **데일리뉴스** → 지구촌소식브리프 → 도시공동체본부 활동.
header/index 와 `board-tabs.ejs` 의 순서를 반드시 일치시킨다.

### 1-1. `board-tabs.ejs` 의 active 처리
게시판 탭은 `currentBoard === 'notice'` 식으로 활성화하지만, 데일리뉴스는 `board` 가 없으므로 **경로**로 판단한다:

```ejs
<% var onNewsletter = (typeof path !== 'undefined' && path && path.indexOf('/newsletter') === 0); %>
...
<a href="/newsletter" class="<%= onNewsletter ? 'active' : '' %>">데일리뉴스</a>
```

> `path` 는 `baseLocals`(server.js)가 모든 렌더에 넣어주는 `res.locals.path`(현재 경로). 재사용 시 이 로컬이 있는지 확인.

### 1-2. 홈 ‘주요 최근 소식’ 피처 박스
홈 상단 소식 영역에서 **최신 1건**을 큰 피처 카드로 보여준다.

- 데이터: `GET /api/home` → `newsletter` 객체(`src/routes/site.js`).
- 렌더: `public/js/main.js` 의 `nl-feature` 블록(배지 "데일리뉴스" + 제목 + 요약 + 이미지1).

```js
// /api/home 응답(발췌)
const newsletter = nl ? {
  id, title, source, url,
  date: cfg.formatDate(nl.created_at),
  lead: (nl.summary || "").slice(0, 160),
  image1: genImg(nl.image1, nl.id),   // 'gen' 이면 /newsletter/gen/:id.svg 로 치환
} : null;
```

---

## 2. 라우트

### 2-1. 공개 (`src/routes/site.js`)

```
GET /newsletter              목록(페이지네이션 12건/페이지, id DESC)
GET /newsletter/gen/:id.svg  생성 이미지(SVG) — 기사 사진 부족 시 즉석 생성, 24h 캐시
GET /newsletter/:id          상세(조회수 +1, 이전/다음 글, image 'gen' 치환)
```

핵심 규칙:
- `nlImg(v, id)` : 저장값이 문자열 `"gen"` 이면 `/newsletter/gen/:id.svg` URL 로 치환해 렌더.
- 상세 진입 시 `UPDATE newsletter SET views = views + 1`.
- 이전/다음은 id 기준(이전 = 더 오래된 글 `id < ?`, 다음 = 더 최신 글 `id > ?`).

### 2-2. 관리 (`src/routes/admin.js`, 모두 `requireAdmin`)

```
GET  /admin/newsletter             관리 목록(30건/페이지) + 소스 상태(naver 여부)
POST /admin/newsletter/collect     지금 수집(백그라운드 실행, 즉시 리다이렉트)  [verifyCsrf]
POST /admin/newsletter/:id/delete  삭제                                        [verifyCsrf]
GET  /admin?board=newsletter       통합 관리 대시보드에서 데일리뉴스 필터로 보기
```

- `collect` 는 응답을 막지 않도록 `collectOnce()` 를 **await 없이** 실행하고 바로 리다이렉트한다(약 1분 소요). 결과는 콘솔 로그로 확인.
- `from=admin` 바디 값에 따라 리다이렉트 경로를 분기(`/admin?board=newsletter` vs `/admin/newsletter`).

### 2-3. 통합 대시보드 특수 처리 (`admin.js` `GET /`)
데일리뉴스는 게시판이 아니지만 **같은 하단 목록**에 끼워 보여주기 위해 특수 필터값 `newsletter` 를 허용하고, 행을 `posts` 형태로 매핑한다:

```js
rows = db.prepare("SELECT id, title, views, created_at FROM newsletter ORDER BY id DESC LIMIT 100")
  .all()
  .map(n => ({ id:n.id, board:"newsletter", title:n.title, created_at:n.created_at,
               views:n.views||0, attach_count:0, pinned:0, _nl:true }));
```

템플릿(`admin-dashboard.ejs`)은 `p._nl` 플래그로 분기해 라벨("데일리뉴스")과 삭제 폼 경로(`/admin/newsletter/:id/delete`)를 바꾼다.

---

## 3. 데이터 레이어 (`src/db.js`)

```sql
CREATE TABLE IF NOT EXISTS newsletter (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',   -- 요약 발췌(원문 전문 금지)
  source       TEXT NOT NULL DEFAULT '',   -- 언론사명
  url          TEXT NOT NULL DEFAULT '',   -- 원문 링크
  keyword      TEXT NOT NULL DEFAULT '',   -- 매칭 키워드
  image1       TEXT NOT NULL DEFAULT '',   -- 'gen' 이면 SVG 즉석 생성
  image2       TEXT NOT NULL DEFAULT '',
  guid         TEXT NOT NULL DEFAULT '',   -- 중복 방지 키(daum:<id> 등)
  published_at TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_guid ON newsletter(guid);
CREATE INDEX        IF NOT EXISTS idx_newsletter_id   ON newsletter(id DESC);

-- 뒤에 추가된 컬럼은 멱등 ALTER 로 마이그레이션(try/catch 로 재실행 안전)
ALTER TABLE newsletter ADD COLUMN content TEXT NOT NULL DEFAULT '';  -- 기사 본문(요약 보강)
ALTER TABLE newsletter ADD COLUMN views   INTEGER NOT NULL DEFAULT 0; -- 조회수
```

- **중복 방지:** `INSERT OR IGNORE` + `guid` UNIQUE 인덱스. `guid` 는 소스별로 `daum:<기사ID>`, 네이버/구글은 링크에서 유도.
- 프레임워크의 멱등 스키마 원칙(`CREATE TABLE IF NOT EXISTS` + try/catch `ALTER`)을 그대로 따른다 — 재시작/재배포에 안전.

---

## 4. 수집 엔진 (`src/newsletter.js`)

### 4-1. 설정 상수
```js
const KEYWORDS = [
  "사회적경제", "사회연대경제", "마을기업", "협동조합",
  "자활기업", "사회적기업", "소셜벤처", "혁신생태계",
];
// collectOnce() 내부 규칙
const MAX_PER_KEYWORD = 1;  // 키워드당 최대 1건
const MAX_TOTAL       = 2;  // 1회 수집 총 2건
const MIN_IMAGES      = 2;  // 실제 기사 사진이 2장 이상인 기사만 채택(두 컷 모두 원문 사진)
```

### 4-2. 소스 우선순위(폴백 체인)
```
fromDaum(kw)                         ① 기본: Daum 뉴스 검색 → 기사 크롤링(제목·본문·대표사진·출처)
  ↓ (결과 없음 & 네이버 키 있음)
fromNaver(kw)                        ② 네이버 뉴스 API(og:image 보강)
  ↓ (그래도 없음)
fromGoogle(kw)                       ③ Google 뉴스 RSS(제목·출처·링크만, 이미지 없음)
```

- `fromDaum`: `search.daum.net` 검색 → `v.daum.net/v/<id>` 기사 링크 추출 → `og:*` 메타 + `dmcf-ptype="general"` 문단 + daumcdn 썸네일 수집. 키워드당 최대 8개 링크, 6건까지.
- `fromNaver`: `NAVER_CLIENT_ID/SECRET` 있을 때만. `openapi.naver.com/v1/search/news.json`.
- `fromGoogle`: 최후 폴백. RSS 파싱, 이미지 없음 → `MIN_IMAGES=2` 규칙상 저장 안 될 수 있음(그래서 Daum 이 주력).
- 모든 요청은 공통 UA + `Accept-Language: ko`, 10초 타임아웃, 호출 간 `sleep`(220~300ms)로 예의 바른 크롤링.

### 4-3. 이미지 2컷 보장
- 1순위: 기사 원문 사진(`og:image` + 본문 `daumcdn` 썸네일). 2장 이상이어야 채택.
- `buildGenSvg(keyword, title, dateStr)` : 사진이 부족할 때 **키워드·제목 기반 SVG 카드**를 즉석 생성(흰 배경 + 액센트 무늬 + 가상 인물 일러스트 + 제목/날짜). 저장값은 `"gen"` 이고 렌더 시 `/newsletter/gen/:id.svg` 로 치환. 실존 인물·로고·워터마크 없음.
- `geminiImage(title, keyword)` : `GEMINI_API_KEY` + 이미지 모델(`imagen-3.0-generate-002` 등)이 있을 때 사실적 편집 이미지 생성(선택). **무료 티어는 이미지 생성 쿼터 0이라 사실상 SVG 폴백으로 동작**(메모리 `image-generation-constraint`).

### 4-4. 저작권·환각 방지 설계
- 원문 **전문을 저장하지 않는다**. `title` + `summary`(발췌, 최대 1000자) + `content`(본문 발췌 8000자 상한) + `url` 링크만.
- 요약이 20자 미만이면 "‘<키워드>’ 관련 최신 보도입니다…" 템플릿 문구로 대체.
- 상세·목록 하단에 저작권 고지 + ‘원문 보기’ 링크 고정.

---

## 5. 스케줄러 (`startScheduler`)

```js
// 매일 08:00 / 18:00(서버 로컬 시간)
function startScheduler() {
  const run = async () => {
    try { await collectOnce(); } catch (e) { /* log */ }
    setTimeout(run, msUntilNext([8, 18]));   // 다음 정각까지 대기 후 재귀
  };
  const count = db.prepare("SELECT COUNT(*) AS n FROM newsletter").get().n;
  if (count === 0) setTimeout(() => collectOnce().catch(()=>{}), 60*1000); // 최초 콜드스타트 시딩
  setTimeout(run, msUntilNext([8, 18]));
}
```

- `msUntilNext([8,18])` : 지금 기준 가장 가까운 08시/18시까지의 ms. cron 없이 순수 `setTimeout` 재귀.
- **콜드스타트 시딩:** 테이블이 비어 있으면 부팅 60초 뒤 1회 즉시 수집(빈 화면 방지).
- **시간대 주의:** 서버 **로컬 시간** 기준. KST 서버가 아니면 `[8,18]` 숫자를 보정하거나 TZ 를 KST 로 맞춰야 한다(지구촌소식브리프는 KST 환산을 직접 하지만, 데일리뉴스는 로컬 시간 그대로 사용 — 재사용 시 차이점 확인).

### 5-1. 부팅 와이어링 (`server.js`)
```js
try { require("./src/newsletter").startScheduler(); }
catch (e) { console.error("[newsletter] 스케줄러 시작 실패:", e.message); }
```
각 스케줄러는 try/catch 로 감싸 **하나가 죽어도 서버 부팅은 계속**된다(프레임워크 부팅 파이프라인 원칙).

---

## 6. 뷰

| 뷰 | 역할 | 핵심 |
|---|---|---|
| `newsletter.ejs` | 공개 목록 | 페이지 배너(DAILY NEWS) + `brief-intro` 소개 + 리스트(번호·제목·출처·키워드·등록일·조회) + 페이지네이션 + 저작권 고지 |
| `newsletter-post.ejs` | 공개 상세 | 키워드/출처 태그 + 공유바 + 이미지 2컷 + 본문(`nl2br`) + 원문 보기 버튼 + 이전/다음 + (관리자) 삭제 |
| `admin-newsletter.ejs` | 관리 | 소스 상태 표시 + ‘지금 수집’ + 통계(총건수·총조회) + 목록/삭제 |
| `admin-dashboard.ejs` | 통합 관리 | `board=newsletter` 필터, `_nl` 플래그 분기, ‘지금 수집’ 버튼 |

- 목록·상세는 `partials/header` → `partials/board-tabs` → 본문 → `partials/footer` 순서(알림마당 공통 레이아웃).
- 날짜 헬퍼 `fmtDate` / `fmtDateTime` 는 `baseLocals` 제공(재사용 시 로컬 존재 확인).
- 생성 이미지 안내 문구: 이미지 URL 에 `nl-gen` 또는 `/newsletter/gen/` 가 포함되면 "실제 보도 사진이 아닐 수 있음" 노트 표시.

---

## 7. 설정 / 환경변수 (`.env`)

| 변수 | 필수 | 용도 |
|---|---|---|
| `GEMINI_API_KEY` | 선택 | 이미지 생성(및 지구촌소식브리프 텍스트). 없으면 SVG 폴백 |
| `GEMINI_IMAGE_MODEL` | 선택 | 기본 `imagen-3.0-generate-002` |
| `GEMINI_BASE_URL` | 선택 | 기본 `https://generativelanguage.googleapis.com` |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 선택 | 네이버 뉴스 API 보강. 둘 다 있을 때만 활성 |

> 데일리뉴스는 **키가 하나도 없어도** Daum→Google 폴백으로 동작한다. 키는 품질 보강용.

---

## 8. 재사용 체크리스트 (타 사이트 이식)

데일리뉴스를 다른 사이트에 올릴 때 **바꿀 것**:

1. **키워드** — `src/newsletter.js` `KEYWORDS` 배열을 그 사이트 주제어로 교체.
2. **수집량·주기** — `MAX_TOTAL` / `MAX_PER_KEYWORD` / `MIN_IMAGES`, `msUntilNext([8,18])` 시각.
3. **브랜드 문구** — `newsletter.ejs` 배너/소개(`brief-intro`), SVG 의 `UCC NEWSLETTER`·`사단법인 도시공동체본부` 문자열(`buildGenSvg`).
4. **SVG 액센트 색** — `buildGenSvg` 의 `accents` 팔레트를 사이트 디자인 토큰에 맞춤.
5. **메뉴 5곳** — §1 표의 5개 위치에 링크 추가(순서 일치). 홈 자체 네비(`index.html`)와 `header.ejs` 둘 다.
6. **홈 피처** — 홈 소식 영역을 쓰면 `/api/home` 의 `newsletter` 블록과 `main.js` `nl-feature` 유지, 아니면 제거.
7. **환경변수** — 필요 시 네이버/Gemini 키.

**그대로 가져갈 코어(수정 불필요):** `newsletter` 테이블 스키마, 수집 폴백 체인, 중복 방지(guid), 스케줄러 구조, 라우트 골격, 관리자 CRUD, 저작권 고지 패턴.

---

## 9. 주의사항 (Gotchas)

- **게시판 아님.** `posts`/`BOARDS` 에 넣지 말 것. 전용 테이블·전용 라우트를 쓴다. 관리자 목록에서만 `_nl` 플래그로 섞어 보여준다.
- **메뉴는 5곳 수동 동기화.** 한 곳만 바꾸면 메뉴가 어긋난다(메모리 `main-nav-separate`).
- **스케줄러는 서버 로컬 시간.** KST 가 아니면 발행 시각이 틀어진다.
- **Google 폴백은 이미지가 없다.** `MIN_IMAGES=2` 때문에 Google 로만 잡힌 기사는 저장이 안 될 수 있다(의도된 동작 — Daum 주력).
- **크롤링 취약성.** Daum/네이버 HTML·메타 구조가 바뀌면 파서(`daumBody`, `metaTag`)를 손봐야 한다. 외부 의존이므로 수집 0건이어도 서버는 정상.
- **무료 Gemini 이미지 생성 불가.** 쿼터 0 → 실질적으로 항상 SVG 폴백(메모리 `image-generation-constraint`). 이미지 모델에 의존하지 말 것.
- **HTML 캐시와 무관.** 데일리뉴스 뷰는 EJS 라 즉시 반영된다. (정적 홈 `index.html` 메모리 캐시 주의는 메뉴 수정 시에만 해당 — `pm2 restart` 필요.)
- **CSP.** 외부 이미지(`daumcdn.net` 등)를 `background-image` 로 쓰므로 `img-src` 에 외부 허용이 필요. server.js 전역 CSP 확인(메모리 `site-csp-constraint`).

---

## 10. 데이터 흐름 요약

```
[스케줄러 08:00/18:00]  또는  [관리자 '지금 수집']
        │
        ▼
 collectOnce()
   KEYWORDS 순회 → fromDaum → (네이버) → (구글)
        │  이미지 2컷 이상 + guid 중복 아님
        ▼
 INSERT OR IGNORE INTO newsletter
        │
        ├─▶ /newsletter            목록
        ├─▶ /newsletter/:id        상세(+조회수) ── 이미지 'gen' ▶ /newsletter/gen/:id.svg
        ├─▶ /api/home → main.js    홈 피처 카드
        └─▶ /admin/newsletter      관리·삭제
```
