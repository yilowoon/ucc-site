# 모듈 M‑ADMIN · 관리페이지(Admin)

> 사이트 전체를 운영하는 **관리자 백오피스**. 로그인 뒤 `/admin` 대시보드(허브)에서 게시판·회원·문의·뉴스레터·기고문·통계·보안·일정·카카오 등 모든 운영 기능으로 들어간다.
> 이 문서 하나로 관리페이지의 **메뉴구성 + 인증/보안 + 라우트 전체 + 업로드 + 뷰 + 재사용**을 파악하고, 타 사이트에 코어를 그대로 이식할 수 있도록 정리한다.
>
> 상위 문서: [`FRAMEWORK.md`](../FRAMEWORK.md) · 형제 모듈: [데일리뉴스](daily-news.md).
> 코어 파일: `src/routes/admin.js`(라우트 전체) · `views/admin-*.ejs`(화면) · `server.js`(세션·CSRF·마운트) · `src/db.js`(`admins` 시드).

---

## 0. 한눈에 보기

| 항목 | 값 |
|---|---|
| 진입 URL | `/admin/login` → `/admin`(대시보드) |
| 마운트 | `server.js`: `app.use("/admin", adminRoutes({ baseLocals, verifyCsrf }))` |
| 라우트 | `src/routes/admin.js` (단일 파일, `express.Router`) |
| 인증 | 세션 기반. `req.session.admin` 존재 = 로그인. 가드 `requireAdmin` |
| 세션 쿠키 | `ucc.sid` (세션 쿠키 = 브라우저 종료 시 만료) + 서버측 1시간 절대만료 |
| CSRF | 모든 상태변경 POST에 `verifyCsrf`(`_csrf` 토큰) |
| 업로드 | multer diskStorage → `data/uploads/`, 랜덤 hex 파일명, 확장자 화이트리스트 |
| 계정 저장 | `admins` 테이블(bcrypt). 최초 1회 `seedAdmin()` 자동 생성 |
| 뷰 | `views/admin-*.ejs` 21종 |
| 공통 로컬 | `isAdmin`, `adminName`, `csrfToken` (server.js `baseLocals`) |

---

## 1. 메뉴구성

관리페이지는 **단일 대시보드(`/admin`)**가 허브다. 상단 액션 + 허브 카드(기능별 바로가기) + 게시판 관리 섹션으로 구성된다. 메뉴 정의는 전부 `views/admin-dashboard.ejs`.

### 1-1. 상단 액션 (admin-head)
- **사이트 보기**(새 탭 `/`) · **비밀번호 변경**(`/admin/password`) · **로그아웃**(POST `/admin/logout`, CSRF)
- 부제: `<adminName> 님으로 로그인됨`

### 1-2. 관리 허브 카드 (`.admin-hub`) — 14개
표시 순서 그대로:

| # | 카드 | 링크 | 설명 |
|---|---|---|---|
| 1 | 📈 트래픽 통계 | `/admin/stats` | 방문·유입 분석 |
| 2 | 🌐 접속기록(IP) | `/admin/access-log` | IP·경로 로그 |
| 3 | 🛡️ 보안 모니터링 | `/admin/security` | 의심 접속·IP 차단 |
| 4 | ✉️ 문의 관리 | `/admin/contacts` | 문의+PIN 재설정 (신규 뱃지) |
| 5 | 👤 회원 관리 | `/admin/members` | 승인·회비·임원 |
| 6 | 🏢 임원사 관리 | `/admin/partners` | 기업회원 로고·소개 |
| 7 | ✍️ 기고문 관리 | `/admin/columns` | 두잉새롬마당 칼럼 |
| 8 | 📝 교육 신청 내역 | `/admin/applications` | 교육신청 접수 |
| 9 | 📅 교육일정 관리 | `/admin/calendar` | 연간 캘린더 |
| 10 | 🗓️ 일정 관리 | `/admin/schedule` | 멤버십캘린더(구글 연동) |
| 11 | ☀️ 햇빛소득마을 | `/admin/solar` | 지역 현황 |
| 12 | 🤖 AI과정 현황 | `/admin/ai-course` | 수료생 통계·소속기관 |
| 13 | 📋 게시판 관리 | `#board-manage` | 하단 섹션 앵커 |
| 14 | 💬 카카오톡 자동발송 | `/admin/kakao-memo` | 지구촌소식브리프 발송 |
| 15 | 🧠 챗봇 지식베이스 | `/admin/kb` | RAG 색인·재색인 |

### 1-3. 게시판 관리 섹션 (`#board-manage`)
- 카드 순서: `['notice','press','business','newsletter','global','news']`
- 일반 게시판 카드 = 글 수 + **＋글쓰기**(`/admin/write?board=k`).
- **데일리뉴스**(newsletter)만 글쓰기 대신 **목록 →**(`/admin?board=newsletter`) — 자동 수집 전용이라 수동 작성 없음.
- 하단에 board 필터 탭 + 글 목록(최근 100건). 필터값 `all` | 각 board | `newsletter`.

> **메뉴 추가/변경 시:** `admin-dashboard.ejs`의 허브 카드 + (게시판이면) `adminBoardOrder` 배열만 고치면 된다. 알림마당 공개 메뉴(header/index/board-tabs)와는 **독립**이다.

---

## 2. 인증 · 세션 · CSRF · 접근제어

관리페이지 보안의 핵심은 전부 `admin.js` 상단 + `server.js` 세션 파이프라인에 있다.

### 2-1. 접근 가드 `requireAdmin`
```js
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect("/admin/login?next=" + encodeURIComponent(req.originalUrl));
}
```
- 모든 관리 라우트(로그인/로그아웃 제외)에 첫 미들웨어로 붙는다.
- 미로그인 시 `?next=` 로 원래 경로 보존 → 로그인 후 복귀. 복귀 경로는 `safeNext()`로 **내부 경로만 허용**(오픈 리다이렉트 차단).

### 2-2. 로그인 (POST `/admin/login`)
1. **무차별 대입 방어:** IP당 10분 내 실패 10회 초과 시 429(`LOGIN_WIN_MS`, `LOGIN_MAX_FAILS`). 성공 시 카운트 즉시 해제. IP는 `::ffff:`/`::1` 정규화.
2. `admins`에서 `username` 조회 → `bcrypt.compareSync(password, password_hash)`.
3. 성공 시 **`req.session.regenerate()`** 로 세션 ID 재발급(세션 고정 공격 방지) → `session.admin = { id, username, loginAt }` + 새 `session.csrf` 발급.
4. 실패/오류는 `admin-login` 재렌더(401/429/500).

### 2-3. 세션 만료 (server.js)
- 쿠키 `ucc.sid` 는 **maxAge 미설정 = 세션 쿠키**: 브라우저 종료 시 삭제.
- 추가로 **서버측 1시간 절대만료**: `SESSION_MAX_MS = 1h`. 매 요청에서 `now - session.admin.loginAt > 1h` 이면 세션 파기(회원도 동일).
- `resave:false`, `saveUninitialized:false`. `cookie.secure`는 환경에 따라(`'auto'`).

### 2-4. CSRF (`verifyCsrf`)
```js
function verifyCsrf(req, res, next){
  const token = req.body && req.body._csrf;
  if (!token || token !== req.session.csrf) return res.status(403).render("message", {...});
  next();
}
```
- 토큰은 세션당 1개(`req.session.csrf`), `res.locals.csrfToken`으로 뷰에 주입 → 모든 폼에 `<input name="_csrf">`.
- **모든 상태변경 POST**에 적용. 실패 시 `message` 뷰로 403.
- **업로드 라우트 순서 주의:** `handleUpload(...) → verifyCsrf` 순. multer가 multipart 바디를 먼저 파싱해야 `req.body._csrf`가 생기므로 **multer가 CSRF보다 앞**에 와야 한다.

### 2-5. 로그아웃
`POST /admin/logout`(CSRF) → `req.session.destroy()` → `/`.

---

## 3. 라우트 전체 맵 (`src/routes/admin.js`)

모든 경로는 `/admin` 프리픽스. `requireAdmin` 기본 생략 표기(로그인/로그아웃만 예외). 상태변경 POST는 모두 `verifyCsrf`.

### 로그인·대시보드
| 메서드 | 경로 | 비고 |
|---|---|---|
| GET | `/login` | 로그인 폼(미들웨어 없음) |
| POST | `/login` | 인증·brute-force·regenerate |
| POST | `/logout` | 세션 파기 |
| GET | `/` | 대시보드(허브+게시판 목록, `?board=` 필터) |

### 게시판 글
| GET | `/write` · `/edit/:id` | 작성/수정 폼 |
| POST | `/write` · `/edit/:id` | `handleUpload("files")`→CSRF, 첨부 저장 |
| POST | `/delete/:id` | 글+첨부 삭제 |

### 기고문(columns, TinyMCE)
| GET | `/columns` · `/columns/new` · `/columns/:id/edit` |
| POST | `/columns`(coverUpload) · `/columns/:id` · `/columns/:id/delete` |
| POST | `/columns/upload-image` | 본문 이미지 업로드(TinyMCE, 단일) |

### 문의(contacts)
| GET | `/contacts` | 상태 필터(신규/확인/완료) |
| POST | `/contacts/:id/status` · `/delete` · `/reply` · `/pin-reset` | 답변·PIN 재설정 → [데일리뉴스와 별개, 문의 PIN 모듈] |

### 회원(members)
| GET | `/members` · `/members/:id` |
| POST | `/members/:id/approve`(정회원+환영메일) · `/revert` · `/exec` · `/fee` · `/delete` |

### 임원사(partners)
| GET | `/partners` · `/partners/new` · `/partners/:id/edit` |
| POST | `/partners`(로고 업로드) · `/partners/:id` · `/partners/:id/delete` · `/partners/generate-intro`(AI 소개문) |

### 교육(신청·일정)
| GET | `/applications` | 교육 신청 내역 |
| GET | `/calendar` , POST `/calendar` · `/calendar/delete/:id` | 교육 연간 캘린더 |

### 멤버십 일정(schedule, 구글 캘린더 양방향)
| GET | `/schedule` · `/schedule/:id/edit` |
| POST | `/schedule` · `/schedule/:id/delete` |

### 콘텐츠 자동화
| GET | `/newsletter` , POST `/newsletter/collect` · `/newsletter/:id/delete` | 데일리뉴스 |
| POST | `/global/collect` | 지구촌소식브리프 수동 발행 |
| GET/POST | `/kakao-memo` 외 connect·callback·test·autosend·disconnect·friendtalk/* | 카카오 자동발송 |
| GET | `/kb` , POST `/kb/rebuild` | 챗봇 RAG 재색인 |

### 지역·과정 콘텐츠
| GET | `/solar` , POST `/solar/:code` | 햇빛소득마을 |
| GET | `/ai-course` , POST `/ai-course/stats` · `/org` · `/org/:id` · `/org/:id/delete` | AI과정 현황 |

### 운영·보안·계정
| GET | `/stats` | 트래픽 통계 |
| GET | `/access-log` | 접속기록(IP) |
| GET | `/security` , POST `/security/block` · `/security/unblock` | IP 차단 관리 |
| GET/POST | `/password` | 관리자 비밀번호 변경 |

---

## 4. 파일 업로드 (multer)

```js
const storage = multer.diskStorage({
  destination: (req,f,cb)=>cb(null, UPLOAD_DIR),               // data/uploads/
  filename: (req,f,cb)=>cb(null, crypto.randomBytes(12).toString("hex") + ext), // 랜덤 hex
});
const upload = multer({ storage, fileFilter, limits:{ fileSize: 12MB, files: 12 } });
```
- **확장자 화이트리스트** `ALLOWED_EXT`: 이미지(jpg/png/gif/webp/bmp) + 문서(pdf/hwp/hwpx/doc(x)/xls(x)/ppt(x)/zip/txt). 그 외 400.
- **용량:** 게시판 12MB×12개 / 임원사 로고 20MB(`MAX_PARTNER_FILE`).
- **원본 파일명 복원:** `fixName()` latin1→utf8(한글 파일명 깨짐 방지).
- **에러 렌더:** `handleUpload()`가 `LIMIT_FILE_SIZE`→413 등 친절한 `publicMessage` 부여.
- **실패 정리:** 저장 중 오류 시 `cleanupFiles()`로 업로드된 파일 unlink(고아 파일 방지).
- 업로드 전용 변형: `coverUpload`(기고문 커버), `uploadImageSingle`(TinyMCE 본문), `partnerUpload`, `upload.single("logo")`(AI 소속기관).

---

## 5. 데이터 · 계정 (`admins`)

```sql
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT ...,
  password_hash TEXT ...,   -- bcrypt
  created_at    TEXT ...
);
```
- **최초 시드 `seedAdmin()`:** 계정이 0개면 자동 생성.
  - username = `ADMIN_USERNAME`(기본 `admin`).
  - password = `ADMIN_PASSWORD` 환경변수, 없으면 **무작위 생성** 후 `data/INITIAL_ADMIN_PASSWORD.txt`에 1회 기록 + 콘솔 출력.
  - 로그인 후 **반드시 비밀번호 변경**(`/admin/password`). ※ 본 사이트는 이미 변경됨.
- 관리 대상 테이블(운영 데이터): `posts`·`attachments`·`columns`·`members`·`contacts`·`newsletter`·`edu_applications`·`partners`·`visits` 등 — 각 기능 라우트가 CRUD.

---

## 6. 뷰 (`views/admin-*.ejs` 21종)

| 뷰 | 화면 |
|---|---|
| `admin-login` | 로그인 |
| `admin-dashboard` | 대시보드(허브+게시판) |
| `admin-form` | 게시판 글 작성/수정 |
| `admin-columns` · `admin-column-form` | 기고문 목록·작성(TinyMCE) |
| `admin-contacts` | 문의 관리(+PIN 재설정) |
| `admin-members` · `admin-member` | 회원 목록·상세 |
| `admin-partners` · `admin-partner-form` | 임원사 목록·등록 |
| `admin-applications` | 교육 신청 내역 |
| `admin-calendar` | 교육일정 |
| `admin-schedule` | 멤버십 일정(구글 연동) |
| `admin-solar` | 햇빛소득마을 |
| `admin-ai-course` | AI과정 현황 |
| `admin-newsletter` | 데일리뉴스 관리 |
| `admin-kakao` | 카카오톡 자동발송 |
| `admin-kb` | 챗봇 지식베이스 |
| `admin-stats` · `admin-access-log` · `admin-security` | 통계·접속로그·보안 |
| `admin-password` | 비밀번호 변경 |

- 공통 로컬(server.js `baseLocals`): `isAdmin`, `adminName`, `csrfToken`, `path`, 날짜 헬퍼.
- 모든 뷰는 `partials/header`→본문→`partials/footer`. 폼은 반드시 `<input name="_csrf" value="<%= csrfToken %>">` 포함.

---

## 7. 설정 · 보안 상수

| 상수/키 | 값 | 위치 |
|---|---|---|
| `SESSION_MAX_MS` | 1시간 절대만료 | server.js |
| 세션 쿠키명 | `ucc.sid` (세션 쿠키) | server.js |
| `LOGIN_WIN_MS` / `LOGIN_MAX_FAILS` | 10분 / 10회 | admin.js |
| `MAX_FILE` / `MAX_FILES` | 12MB / 12개 | admin.js |
| `MAX_PARTNER_FILE` | 20MB | admin.js |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 최초 시드용(.env) | db.js |
| CSP `/admin` 예외 | `/admin`·`/api`는 전역 가드 일부 우회 | server.js |

---

## 8. 재사용 체크리스트 (타 사이트 이식)

**그대로 가져갈 코어(수정 불필요):** `requireAdmin`, 로그인 brute-force 방어, `session.regenerate`, `SESSION_MAX_MS`, `verifyCsrf`, multer(랜덤 hex·화이트리스트·fixName·cleanup), `safeNext` 오픈리다이렉트 차단, `seedAdmin`.

**바꿀 것:**
1. **허브 메뉴** — `admin-dashboard.ejs`의 `.admin-hub` 카드 목록을 그 사이트 기능에 맞게 교체(아이콘·링크·설명).
2. **게시판 목록** — `adminBoardOrder` + `src/config.js` `BOARDS`.
3. **기능 라우트** — 불필요한 라우트(solar·ai-course·kakao 등) 제거, 필요한 기능만 유지.
4. **뷰** — 사용하는 `admin-*.ejs`만 남김.
5. **계정 환경변수** — `.env`의 `ADMIN_USERNAME`/`ADMIN_PASSWORD`(최초 1회).
6. **디자인 토큰** — `.hub-card`·`.admin-*` 스타일을 사이트 토큰에 맞춤.

---

## 9. 주의사항 (Gotchas)

- **업로드는 multer→CSRF 순서 고정.** 뒤집으면 `req.body._csrf`가 없어 전 업로드가 403.
- **대시보드 글 목록은 최근 100건 한도.** 대량 운영 시 페이지네이션 필요.
- **데일리뉴스는 글쓰기 없음.** 대시보드 카드가 '목록 →'인 이유(자동 수집 전용).
- **최초 비밀번호는 `data/INITIAL_ADMIN_PASSWORD.txt`.** 공개 저장소에 올리지 말 것(반드시 변경 후 운영).
- **세션 쿠키라 브라우저 종료 시 로그아웃.** '로그인 유지'가 필요하면 쿠키 `maxAge`를 명시(단, 1시간 서버 만료는 별도).
- **CSP가 `/admin`을 일부 예외 처리**하지만 외부 CDN 스크립트는 여전히 차단 → 라이브러리 self-host([[site-csp-constraint]]).
- **라우트 변경은 서버 재시작 필요**(`pm2 restart`). 뷰(EJS)·CSS는 pull만으로 반영.
- **`safeNext`로 `?next=`는 내부 경로만** — 외부 URL 리다이렉트 불가(오픈 리다이렉트 방지).

---

## 10. 요청 흐름 요약

```
비로그인 → /admin/* ──requireAdmin──▶ /admin/login?next=원래경로
                                         │ POST /login (brute-force 체크)
                                         │   bcrypt 검증 OK
                                         ▼
                              session.regenerate → session.admin + csrf
                                         ▼
                                   next 경로로 복귀(safeNext)
                                         ▼
  /admin 대시보드(허브) ──▶ 각 기능 라우트(requireAdmin)
          상태변경 POST ──verifyCsrf(_csrf)──▶ DB 반영
          업로드 POST  ──multer→verifyCsrf──▶ data/uploads/ 저장
                                         ▼
                        매 요청 loginAt+1h 초과 시 세션 파기
```
