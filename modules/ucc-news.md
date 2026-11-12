# 모듈 M‑UN · 도시공동체본부 활동(UCC News)

> 본부의 활동 소식을 **이미지 중심**으로 전하는 게시판(`news`). 공개 URL은 일반 게시판(`board.js`)이고, 홈에는 별도 **"도시공동체본부 활동"**(UCC NEWS) 이미지 그리드로도 노출된다.
>
> 상위 문서: [`FRAMEWORK.md`](../FRAMEWORK.md) · 형제: [주요 최근 소식](home-latest.md)(같은 `/api/home`의 다른 묶음), [관리페이지](admin.md).

---

## 0. 한눈에 보기

| 항목 | 값 |
|---|---|
| 공개 URL | `/board/news`(목록), `/board/news/:id`(상세) — **일반 게시판**(`board.js`) |
| 보드 정의 | `src/config.js` `BOARDS.news` (name "도시공동체본부 활동", en "UCC NEWS", **image:true**) |
| 저장 | `posts`(`board='news'`) + `attachments`(이미지) |
| 홈 노출 | `/` 섹션 `#ucc-news`, 그리드 `#uccNewsGrid`(최대 3개 이미지 카드) |
| 데이터(홈) | `GET /api/home` → `news[]`(최신 8건, 첫 이미지 썸네일) |
| 작성·관리 | `/admin/write?board=news` 등 일반 게시판 CRUD([관리페이지](admin.md)) |

---

## 1. 보드 정의 · `image:true`

```js
// src/config.js
news: { key:"news", name:"도시공동체본부 활동", en:"UCC NEWS",
        desc:"본부의 활동 소식과 이미지 자료입니다.", image:true },
```

- `news`는 다른 게시판(`notice`·`press`…)과 동일하게 `posts` 테이블 + `board.js` 공통 라우트로 동작한다.
- **`image:true`는 선언적 플래그**다. 현재 렌더 로직(`board.js`/뷰)은 이 값을 직접 참조하지 않는다(= 목록/상세는 일반 게시판과 동일). 이미지 성격은 ① 홈 그리드가 `board='news'`를 썸네일 카드로 뽑고, ② 운영상 이미지 첨부 위주로 작성하는 관례에서 나온다. 플래그는 "이미지 중심 게시판" 의미 표식 겸 향후 분기용으로 남겨둔 것.

---

## 2. 메뉴구성 · 공개 노출

### 2-1. 네비게이션(알림마당 서브메뉴) — 마지막 항목, 4곳
| 파일 | 위치 |
|---|---|
| `public/index.html` | 데스크톱 드롭다운 + 모바일 (`/board/news`) |
| `views/partials/header.ejs` | 데스크톱 드롭다운 + 모바일 |
| `views/partials/board-tabs.ejs` | 알림마당 상단 탭 (`boards.news.name`) |

순서(고정): …데일리뉴스 → 지구촌소식브리프 → **도시공동체본부 활동**. 변경 시 전부 동기화([[main-nav-separate]]).

### 2-2. 게시판 목록/상세 (`board.js` 공통)
- `GET /:board` → `board-list`(배너 `meta.name`/`en`/`desc`, 검색, 썸네일 점 `thumb`, 페이지네이션).
- `GET /:board/:id` → `board-post`(이미지 첨부는 `isImage` 필터로 본문에 표시, 그 외 첨부 다운로드).
- 상세 첨부: `mimetype LIKE 'image/%'`를 `images`로 분리해 `post-image`로 렌더.

### 2-3. 홈 그리드 "도시공동체본부 활동"
```html
<!-- index.html -->
<section class="section section--alt ucc-news" id="ucc-news">
  <h2 class="section-title">도시공동체본부 활동</h2><span class="section-en">UCC NEWS</span>
  <a class="section-more" href="/board/news">전체보기 →</a>
  <div class="ucc-news-grid" id="uccNewsGrid">불러오는 중…</div>
</section>
```
- 데이터: `/api/home`의 `news` — `board='news'` 최신 8건, 각 글 **첫 이미지 첨부**를 썸네일로.
  ```sql
  SELECT p.id, p.title, p.created_at,
    (SELECT filename FROM attachments a WHERE a.post_id=p.id AND a.mimetype LIKE 'image/%'
       ORDER BY sort, id LIMIT 1) AS thumb
  FROM posts p WHERE p.board='news' ORDER BY p.pinned DESC, p.id DESC LIMIT 8
  ```
- 렌더: `main.js`가 `#uccNewsGrid`에 **최대 3개** `ucc-card`(썸네일 + 제목 + 날짜, `/board/news/:id` 링크). 이미지 없으면 "이미지 없음" 플레이스홀더. 비면 "등록된 소식이 없습니다".

---

## 3. 작성 · 관리

일반 게시판 CRUD([관리페이지](admin.md) §게시판 글):
- `GET /admin/write?board=news` · `POST /admin/write`(`handleUpload("files")`→CSRF) — 제목·본문 + **이미지 첨부**(multer, 랜덤 hex, 12MB×12).
- `GET /admin/edit/:id` · `POST /admin/edit/:id` · `POST /admin/delete/:id`.
- 대시보드 게시판 카드/필터에서 `news`로 글쓰기·목록. 작성 순서 배열 `['notice','press','business','global','news']`.
- 홈 썸네일이 제대로 나오려면 **이미지 1장 이상 첨부**해야 함(첫 이미지가 썸네일).

---

## 4. 재사용 체크리스트

**바꿀 것:**
1. **보드 정의** — `config.js` `BOARDS.news`(key·name·en·desc·image).
2. **홈 그리드** — `index.html` `#ucc-news` 섹션 + `main.js` `uccGrid` 블록(개수·레이아웃). 안 쓰면 둘 다 제거.
3. **홈 쿼리** — `/api/home`의 `news` 쿼리(보드 키·건수).
4. **네비 4곳.**

**그대로 가져갈 코어:** 일반 게시판 공통(`board.js` 목록/상세/검색/첨부), 홈 썸네일 추출 쿼리(첫 이미지 첨부), 카드 렌더·빈 상태 폴백.

---

## 5. 주의사항 (Gotchas)

- **일반 게시판이다.** `news` 전용 라우트/테이블 만들지 말 것 — `board.js`가 공통 처리. 다른 점은 ‘홈 그리드가 이 보드를 이미지 카드로 뽑는다’는 것뿐.
- **`image:true`는 현재 렌더에 영향 없음.** 목록/상세를 이미지 레이아웃으로 바꾸려면 뷰에서 `meta.image` 분기를 새로 추가해야 한다(현재는 미사용 플래그).
- **홈 썸네일 = 첫 이미지 첨부.** 이미지 없는 글은 홈에서 "이미지 없음"으로 나옴 → 활동 글엔 대표 이미지 첨부 권장.
- **홈 HTML은 정적(메모리 캐시).** `#ucc-news` 구조 변경 시 `pm2 restart`. 글 추가는 `/api/home`이 최신이라 재시작 불필요.
- **홈 그리드는 최대 3개** 표시(쿼리는 8건) — 개수 조정은 `main.js` `slice(0,3)`.
- **CSP:** 썸네일 `background-image` → `img-src` 자기 호스트(`/uploads`) 허용 확인([[site-csp-constraint]]).

---

## 6. 흐름 요약

```
관리자 /admin/write?board=news (이미지 첨부)
        ▼
 posts(board=news) + attachments(image)
        │
        ├─▶ /board/news            목록(배너·검색·썸네일점) · 상세(이미지 본문)  [board.js 공통]
        └─▶ /api/home news[]       첫 이미지 썸네일 → main.js #uccNewsGrid (최대 3 카드)
                                   홈 "도시공동체본부 활동" 섹션
```
