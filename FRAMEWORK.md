# 기관 웹사이트 프레임워크 (UCC Framework)

> Node.js + Express + 내장 SQLite(`node:sqlite`) + EJS 기반의 **보안 내장형 기관 홈페이지 프레임워크**.
> 이 저장소(사단법인 도시공동체본부)에서 검증된 구조를 **다른 사이트 개발 시 그대로 재사용**하기 위한 레퍼런스입니다.
>
> 이 문서는 "무엇을 만들었나"가 아니라 **"어떻게 다시 쓰는가"**에 초점을 둡니다. 각 모듈은 독립적으로 떼어 쓸 수 있도록 설계되어 있습니다.

---

## 목차

1. [설계 철학 / 언제 쓰나](#1-설계-철학--언제-쓰나)
2. [기술 스택 & 요구사항](#2-기술-스택--요구사항)
3. [디렉터리 구조](#3-디렉터리-구조)
4. [부팅 파이프라인 (미들웨어 순서)](#4-부팅-파이프라인-미들웨어-순서-가장-중요)
5. 모듈 레퍼런스
   - [M1. 설정·환경변수](#m1-설정환경변수)
   - [M2. 데이터 계층 (node:sqlite)](#m2-데이터-계층-nodesqlite)
   - [M3. 보안 모듈](#m3-보안-모듈)
   - [M4. 인증·세션·CSRF](#m4-인증세션csrf)
   - [M5. 라우팅 (팩토리 패턴)](#m5-라우팅-팩토리-패턴)
   - [M6. 뷰·템플릿 & OG 메타](#m6-뷰템플릿--og-메타-시스템)
   - [M7. 디자인 시스템 (CSS 토큰)](#m7-디자인-시스템-css-토큰)
   - [M8. 파일 업로드](#m8-파일-업로드)
   - [M9. WYSIWYG 에디터 (TinyMCE)](#m9-wysiwyg-에디터-tinymce-self-host)
   - [M10. 게시판 모듈](#m10-게시판-모듈-config--posts-재사용)
   - [M11. 통계·방문자 집계](#m11-통계방문자-집계)
   - [M12. 메일·스케줄러 (선택)](#m12-메일스케줄러-선택)
6. [에셋 파이프라인 (로고·OG 이미지)](#6-에셋-파이프라인-로고og-이미지)
7. [배포](#7-배포)
8. [새 사이트에 적용하는 법 (리브랜딩 체크리스트)](#8-새-사이트에-적용하는-법-리브랜딩-체크리스트)
9. [재사용 시 핵심 주의사항](#9-재사용-시-핵심-주의사항-꼭-읽기)
10. [부록: 환경변수 전체 표 / 명령어](#10-부록)

---

## 1. 설계 철학 / 언제 쓰나

**한 줄 요약:** *외부 의존성을 최소화하고(빌드 스텝 없음·DB 드라이버 없음), 하나의 Node 프로세스로 돌아가며, 보안·세션·게시판·관리자·회원이 기본 내장된 서버 렌더링 사이트.*

### 적합한 경우
- 기관/단체/기업 홈페이지 + 게시판 + 관리자 CMS
- 회원가입·로그인·마이페이지가 필요한 중소 규모 사이트
- **단일 VPS(예: Cafe24) + PM2 + Nginx**로 저렴하게 운영
- SEO·SNS 공유(OG)·검색엔진 노출이 중요한 공개 사이트

### 적합하지 않은 경우
- 서버리스/정적 호스팅만 가능한 환경 (SQLite 파일·업로드가 유실됨 → `data/` 영구 볼륨 필수)
- 수평 확장(다중 인스턴스)이 1순위인 대규모 트래픽 — SQLite·인메모리 세션·인메모리 차단캐시는 단일 노드 전제

### 핵심 원칙
- **빌드 없음**: 번들러·트랜스파일러 없음. `node server.js`가 전부. EJS는 런타임 렌더.
- **의존성 최소**: DB는 Node 내장 `node:sqlite`. 외부 CDN 스크립트는 CSP로 차단 → **라이브러리는 self-host**.
- **설정보다 관례**: 게시판·페이지는 설정 객체 한 곳에 정의하면 목록/상세/검색/첨부/관리자 화면이 자동으로 따라옴.
- **보안 기본 내장**: CSP·보안헤더·CSRF·세션 절대만료·위협탐지·IP 자동차단·AI 크롤러 차단이 서버 부팅에 내장.

---

## 2. 기술 스택 & 요구사항

| 항목 | 값 | 비고 |
|---|---|---|
| 런타임 | **Node.js ≥ 22.5** (권장 24 LTS) | `node:sqlite`가 22.5부터 제공 |
| 웹 프레임워크 | Express 4 | |
| 뷰 | EJS (레이아웃 엔진 없이 `header`/`footer` 파셜 명시 포함) | |
| DB | **node:sqlite `DatabaseSync`** (내장, 드라이버 설치 불필요) | WAL 모드 |
| 세션 | express-session (인메모리 스토어) | |
| 비밀번호 | bcryptjs | |
| 업로드 | multer (디스크 저장) | |
| 메일 | nodemailer | 선택 |
| 폰트 | Pretendard (jsdelivr, CSP에서 style/font만 허용) | |

`package.json` 의존성은 이게 전부입니다 (DB 드라이버·빌드도구 없음):
```json
"dependencies": {
  "bcryptjs": "^2.4.3", "ejs": "^3.1.10", "express": "^4.21.2",
  "express-session": "^1.18.1", "multer": "^2.2.0", "nodemailer": "^10.3.1"
}
```

---

## 3. 디렉터리 구조

```
server.js                 ── 앱 진입점: 미들웨어 파이프라인 · CSP · 보안 · 라우트 마운트
src/
  config.js               ── 게시판 정의(BOARDS) · 공용 헬퍼(escapeHtml/nl2br/formatDate)
  db.js                   ── SQLite 초기화 · 스키마 · 마이그레이션 · 시드(관리자 등)
  pages.js                ── 정적 소개/약관 페이지 정의(간이 CMS)
  mailer.js               ── nodemailer 래퍼 (선택)
  routes/
    site.js               ── 공개 페이지 · 회원(가입/로그인) · 홈 API
    admin.js              ── 관리자(인증 · 글 CRUD · 업로드 · WYSIWYG)
    board.js              ── 공개 게시판(목록 · 상세 · 다운로드)
    exec.js               ── (선택) 권한 게이트 예시(임원 전용)
views/
  partials/
    header.ejs            ── <head>(OG 메타) · 전역 네비게이션
    footer.ejs            ── 푸터 · 모바일 네비 토글 스크립트
  *.ejs                   ── 페이지별 템플릿
public/
  index.html             ── 홈(정적; 서버가 placeholder 치환 후 서빙)
  robots.txt             ── AI 크롤러 Disallow + 그 외 Allow
  css/  js/  img/         ── 정적 자산 (라이브러리 self-host 포함)
  js/tinymce/            ── TinyMCE self-host (CSP 때문)
data/                    ── ucc.db(SQLite) + uploads/ (git 제외, 영구 볼륨)
Dockerfile · render.yaml · DEPLOY.md
```

> **원칙:** 재사용 시 `server.js`·`src/`·`views/partials/`·`public/css|js`·배포파일은 **프레임워크 코어**로 그대로 가져가고, `views/*.ejs`와 `public/index.html`·`src/pages.js`·`config.js`의 `BOARDS`만 교체합니다.

---

## 4. 부팅 파이프라인 (미들웨어 순서) — **가장 중요**

`server.js`의 미들웨어는 **순서가 곧 정책**입니다. 재사용 시 이 순서를 유지하세요.

```
1.  app.disable('x-powered-by')              // 서버 지문 숨김
2.  app.set('trust proxy', 1)                // 프록시 뒤 HTTPS·쿠키·IP 인식
3.  보안 응답 헤더 (전역)                      // CSP · X-CTO · XFO · Referrer · Permissions · HSTS
       └ 인증 경로(/admin·/mypage·/login…)는 Cache-Control: no-store
4.  view engine = ejs
5.  express.urlencoded({extended:false})     // 폼 바디
6.  session(...)                             // 쿠키 ucc.sid, secure:'auto'
7.  세션 절대 만료 (로그인 후 1시간)
8.  CSRF 토큰 발급 → res.locals.csrfToken
9.  baseLocals 주입 (모든 뷰 공통 변수)
10. express.static(public, {index:false})    // ★ index:false (홈은 11에서 직접)
11. /uploads 정적 (자체 CSP: default-src 'none')
12. AI 크롤러 차단 (User-Agent)              // 관리자 세션은 예외
13. 방문자 통계 집계 (봇·정적·관리자 제외)
14. 위협 탐지 + IP 자동 차단
15. (선택) 프로필 미완료 회원 게이트
16. 라우트:  GET '/'(홈) → /admin → /exec → /board → /
17. 404 핸들러
18. 오류 핸들러
19. app.listen() + 스케줄러 start()
```

**왜 이 순서인가 (핵심 포인트):**
- `trust proxy`가 먼저여야 `req.secure`·`req.ip`가 프록시(X-Forwarded-*) 기준으로 정확 → HSTS·secure 쿠키·IP 차단이 올바로 동작.
- CSRF·baseLocals가 **라우트보다 먼저** → 모든 뷰에서 `csrfToken` 사용 가능.
- `express.static`은 **`index: false`** — 홈 `index.html`을 자동 서빙하지 않고, 16단계에서 placeholder(OG 절대 URL·네비)를 치환해 직접 보냄.
- AI 크롤러·통계·위협탐지는 정적 서빙 **뒤** → `/css`·`/js`·`/img`·`robots.txt`는 영향 없이 통과, HTML 페이지 요청만 평가.

---

## M1. 설정·환경변수

### 무의존 `.env` 로더 (server.js 상단)
프로젝트 루트 `.env`를 읽어 `process.env`를 채웁니다. **이미 설정된 실제 환경변수(export/pm2)가 우선**이고, 미설정/빈 값만 `.env`로 채웁니다.
```js
if (!process.env[k]) process.env[k] = v;   // 실제 env 우선
```

### `src/config.js` — 게시판 정의 + 공용 헬퍼
한 곳에서 게시판을 정의하면 라우트·뷰가 공유합니다.
```js
const BOARDS = {
  notice:  { key:"notice",  name:"공지사항", en:"NOTICE",  desc:"…" },
  press:   { key:"press",   name:"보도자료", en:"PRESS",   desc:"…" },
  news:    { key:"news",    name:"활동소식", en:"NEWS", desc:"…", image:true }, // image:true = 이미지형 게시판
};
```
공용 헬퍼: `escapeHtml`, `nl2br`, `nl2brLink`(URL 자동 링크), `formatDate`/`formatDateTime`(KST `YYYY.MM.DD`).

> **보안 메모:** `escapeHtml`은 XSS 방지의 1차선. EJS `<%= %>`는 자체 이스케이프하므로, baseLocals의 `esc`는 **항등 함수(passthrough)**로 둬 이중 이스케이프를 막습니다. `<%- %>`(raw)에는 반드시 이스케이프된 값만 넣으세요.

---

## M2. 데이터 계층 (node:sqlite)

### 초기화 (`src/db.js`)
```js
const { DatabaseSync } = require("node:sqlite");   // ★ 외부 드라이버 없음
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");   // 동시 읽기 성능
db.exec("PRAGMA foreign_keys = ON;");
```
- `DATA_DIR = ../data`, `UPLOAD_DIR = data/uploads`, `DB_PATH = data/ucc.db` — 부팅 시 `mkdirSync(recursive)`.

### 스키마 = **멱등(idempotent)**
모든 테이블은 `CREATE TABLE IF NOT EXISTS`로 정의 → 서버 재시작 시 안전.
```sql
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '관리자', views INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board, pinned DESC, id DESC);
```

### 마이그레이션 패턴 (컬럼 추가)
`ALTER TABLE`을 try/catch로 감싸 **이미 있으면 무시** — 마이그레이션 테이블 없이 안전하게 컬럼 증설:
```js
try { db.exec("ALTER TABLE contacts ADD COLUMN pw_hash TEXT NOT NULL DEFAULT ''"); } catch (e) {}
```

### 시드 패턴
`SELECT COUNT(*)`로 비어있을 때만 1회 삽입. 관리자 시드는 특히 중요:
```js
// 관리자가 없으면 무작위 비번 생성 → data/INITIAL_ADMIN_PASSWORD.txt 에 기록
const password = process.env.ADMIN_PASSWORD || ("ucc-" + crypto.randomBytes(6).toString("base64url"));
db.prepare("INSERT INTO admins (username,password_hash,created_at) VALUES (?,?,?)")
  .run(username, bcrypt.hashSync(password,10), now);
```
- 클라우드 배포 시 `ADMIN_PASSWORD` 환경변수로 최초 비번 지정, 없으면 랜덤 생성 후 파일 기록.

### 쿼리 스타일 (prepared statement)
```js
const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
const rows = db.prepare("SELECT * FROM posts WHERE board = ? ORDER BY id DESC").all(board);
db.prepare("INSERT INTO ... VALUES (?,?)").run(a, b);
```
항상 **파라미터 바인딩(`?`)** — 문자열 연결 금지(SQL 인젝션 방지).

> **백업:** `data/` 폴더만 복사하면 DB+업로드 전체가 보존됩니다.

---

## M3. 보안 모듈

이 프레임워크의 핵심 가치. `server.js`에 전부 내장.

### 3-1. CSP (Content-Security-Policy)
```
default-src 'self'; base-uri 'self'; object-src 'none';
frame-ancestors 'self'; form-action 'self';
img-src 'self' data: blob: https:;
style-src  'self' 'unsafe-inline' https://cdn.jsdelivr.net;   ← 폰트(Pretendard)만 외부 허용
font-src   'self' data: https://cdn.jsdelivr.net;
script-src 'self' 'unsafe-inline' <카카오/네이버/다음 도메인만>;  ← ★ 일반 CDN 스크립트 차단
connect-src / frame-src ... (카카오/네이버/다음)
upgrade-insecure-requests
```
> ⚠️ **가장 자주 걸리는 함정:** `script-src`가 `'self'` + 특정 도메인뿐이라 **jsdelivr/unpkg 등 외부 `<script>`는 차단**됩니다. 새 프런트 라이브러리(에디터·차트 등)는 반드시 `public/`에 **self-host**하세요. (예: TinyMCE → `public/js/tinymce/`)

### 3-2. 전역 보안 헤더
`X-Content-Type-Options: nosniff` · `X-Frame-Options: SAMEORIGIN` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy`(geo/mic/cam/payment 차단) · `Cross-Origin-Opener-Policy: same-origin` · `X-XSS-Protection` · **HSTS**(HTTPS일 때만, 1년+서브도메인+preload).
- 인증·민감 경로(`/admin|/mypage|/login|/logout|/signup|/auth`)는 `Cache-Control: no-store`.

### 3-3. AI/LLM 크롤러 차단 (User-Agent 기준)
```js
const AI_CRAWLER_UA = /(GPTBot|OAI-SearchBot|ChatGPT-User|CCBot|anthropic-ai|ClaudeBot|
  Claude-Web|Claude-User|PerplexityBot|Perplexity-User|Bytespider|Amazonbot|
  Applebot-Extended|meta-externalagent|cohere-ai|Diffbot|…|Scrapy)/i;
// 매칭 시 403 + X-Robots-Tag: noai, noimageai
```
- **IP 아님 → 유동 IP 무관.** 일반 방문자·운영자 브라우저는 영향 없음.
- **예외**: 검색엔진(Googlebot·bingbot·네이버 Yeti·다음 Daumoa), SNS 미리보기(facebookexternalhit·kakaotalk·Twitterbot), **관리자 세션**은 통과.
- `public/robots.txt`로 **이중 방어**(예의 바른 봇 자진 차단).

### 3-4. 위협 탐지 + IP 자동 차단
알려진 스캔/공격 경로를 정규식으로 탐지 → 로깅 + 요청 403 + 조건부 IP 차단.
```js
const THREAT_PATTERNS = [ /wp-login|xmlrpc\.php/, /\.env|\.git|id_rsa/,
  /phpmyadmin|adminer/, /jndi:|\$\{|eval-stdin/, /\.\.\/|\/etc\/passwd/, … ];
const HIGH_SEVERITY = new Set(["rce","secret","traversal"]); // 즉시 영구성 차단(24h)
const SOFT_LIMIT = 5;   // 그 외: 1시간 내 5회 초과 시 IP 차단
const BAN_TTL = 24 * 3600 * 1000;
```
- 차단 IP는 `blocked_ips` 테이블 + **메모리 Map 캐시**(부팅 시 로드). 루프백(`127.0.0.1`)은 IP 차단 제외.
- 경로만 검사(쿼리 제외)해 정상 검색어 오탐 방지. `app.locals.blockedIps`로 관리자 화면에서 조회/해제.

### 3-5. 업로드 파일 격리
`/uploads`는 **자체 CSP** `default-src 'none'; img-src 'self'` + `nosniff` → 업로드된 파일이 스크립트로 실행되는 것을 차단.

---

## M4. 인증·세션·CSRF

### 세션
```js
session({ name:"ucc.sid", secret: process.env.SESSION_SECRET, resave:false,
  saveUninitialized:false,
  cookie:{ httpOnly:true, sameSite:"lax", secure:"auto" } }) // secure:'auto' = HTTPS면 secure, HTTP면 일반
```
- `maxAge` 미설정 = **세션 쿠키**(브라우저 종료 시 삭제).
- **서버측 절대 만료**: 로그인 후 1시간(`SESSION_MAX_MS`) 경과 시 `req.session.admin`/`member` 삭제.

### CSRF (세션 토큰 방식)
- 세션마다 `crypto.randomBytes(16)` 토큰 발급 → `res.locals.csrfToken`.
- 모든 폼에 `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`.
- `verifyCsrf`가 `req.body._csrf === req.session.csrf` 검증.
- **멀티파트(파일 업로드) 시 multer를 verifyCsrf보다 먼저** 둬야 `req.body._csrf`가 파싱됨:
  ```js
  router.post("/write", requireAdmin, handleUpload("files"), verifyCsrf, handler);
  ```

### 로그인 보호
- **로그인 시 `req.session.regenerate()`** (세션 고정 공격 방지) + CSRF 토큰 재발급.
- 로그인 **brute-force 제한**: IP당 실패 횟수 추적(`loginAllowed`/`loginFailed`), 초과 시 429.
- 비밀번호는 `bcrypt.compareSync`.

### 권한 가드 (재사용 패턴)
```js
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect("/admin/login?next=" + encodeURIComponent(req.originalUrl));
}
```
회원용 `requireMember`, 임원용 `requireExec`도 같은 패턴. 각 라우터 팩토리 안에 선언.

---

## M5. 라우팅 (팩토리 패턴)

각 라우트 모듈은 **의존성을 주입받는 팩토리 함수**를 export → 테스트·재사용 용이.
```js
// src/routes/admin.js
module.exports = function adminRoutes({ verifyCsrf }) {
  const router = express.Router();
  function requireAdmin(req,res,next){ … }
  router.get("/", requireAdmin, handler);
  return router;
};
// server.js
app.use("/admin", adminRoutes({ baseLocals, verifyCsrf }));
app.use("/exec",  execRoutes({ verifyCsrf }));
app.use("/board", boardRoutes({ baseLocals }));
app.use("/",      siteRoutes({ verifyCsrf }));
```

### `baseLocals(req)` — 모든 뷰 공통 변수
`boards`, `isAdmin`/`adminName`, `isMember`/`memberName`, `isExec`, `csrfToken`,
`fmtDate`/`fmtDateTime`, `nl2br`/`nl2brLink`, **`baseUrl`(OG 절대 URL용)**, `path`(현재 경로) 등.
한 미들웨어에서 `res.locals`에 펼쳐 넣어 전 뷰가 공유.

> **라우트 순서 함정:** 구체 경로를 `:param`보다 **먼저** 등록. 예) `POST /columns/upload-image`는 `POST /columns/:id`보다 위에 둬야 `:id="upload-image"`로 오인되지 않음.

---

## M6. 뷰·템플릿 & OG 메타 시스템

### 파셜 구조 (레이아웃 엔진 없음)
각 페이지 EJS가 `<%- include('partials/header', {title, ...}) %>` … `include('partials/footer')`를 **명시적으로** 포함. 명시적이라 페이지별 CSS/변수 주입이 쉬움(`pageCss` 변수로 페이지 전용 CSS 추가).

### OG(Open Graph) 메타 — SNS 공유 카드
`header.ejs`가 페이지별 오버라이드를 지원. 라우트에서 locals만 넘기면 됨:
```js
res.render("forum", { ...res.locals, title:"두잉새롬마당",
  ogTitle: "…", ogDescription: "…",
  ogImage: "/img/og-forum.png?v=1",            // 상대경로 → header가 baseUrl 붙여 절대화
  ogUrl: res.locals.baseUrl + "/projects/forum" });
```
`header.ejs` 기본값 폴백 + `og:image:width/height`, `twitter:card=summary_large_image`까지 자동.

> ⚠️ **OG 이미지는 PNG/JPG여야 함.** 카카오톡·페이스북 크롤러는 **SVG를 og:image로 렌더하지 않음**. 1200×630 PNG 권장. (OG용 PNG 생성은 [6. 에셋 파이프라인](#6-에셋-파이프라인-로고og-이미지) 참고)

### 홈(정적 + placeholder 주입)
`public/index.html`은 **부팅 시 1회 읽어 메모리 캐시**(`INDEX_HTML`). 요청마다 치환해 서빙:
```
__BASE__      → OG 절대 URL용 호스트
__CSRF__      → CSRF 토큰
__MEMBERNAV__ / __ADMINNAV__ / __ADMINFOOT__ → 로그인 상태별 메뉴
```
- 홈 응답은 `Cache-Control: no-store` + `Vary: Cookie` (로그인 전/후 메뉴 캐시 혼선 방지).
- ⚠️ **`index.html`을 수정하면 서버 재시작 필요**(메모리 캐시라서). CSS/JS/이미지 등 일반 정적 파일은 재시작 불필요.

### 네비게이션 이중 관리
메인(`public/index.html`)은 자체 네비, 서브페이지는 `header.ejs` 네비 → **메뉴 변경 시 두 곳 모두 수정**.

---

## M7. 디자인 시스템 (CSS 토큰)

`public/css/styles.css`의 `:root`에 전부 토큰화 → **색/간격/그림자를 한 곳에서 리브랜딩**.
```css
:root{
  --green-800:#123a2e; --green-600:#1e5a47;         /* 브랜드 메인 */
  --gold-500:#cd9b4c; --gold-400:#dcb26a;           /* 포인트 */
  --paper:#fff; --paper-warm:#f8f6f0; --line:#e4e2da; /* 중립 */
  --ink:#16211c; --muted:#6b766f;
  --radius:14px; --container:1180px; --gutter:clamp(20px,5vw,48px);
  --shadow-sm/--shadow/--shadow-lg; --ease:cubic-bezier(.22,1,.36,1);
  --font:"Pretendard Variable",…;
}
```
- CSS 파일 분리: `styles.css`(토큰+공통), `home.css`(홈/섹션), `board.css`(게시판/관리자), `column.css`(본문), `hero.css`.
- 접근성: `prefers-reduced-motion` 시 애니메이션 차단, 포커스/시맨틱 마크업.

### 재사용 패턴: 파트너 로고 마퀴
협력기관 로고를 끊김 없이 흐르게 하는 패턴 (이 저장소에서 구현·검증):
```html
<div class="marquee"><div class="marquee-track">
  <div class="marquee-group"> …로고 N개… </div>
  <div class="marquee-group" aria-hidden="true"> …동일 N개(복제)… </div>
</div></div>
```
```css
.marquee-track{ display:flex; width:max-content; animation:marquee 32s linear infinite; }
@keyframes marquee{ from{transform:translateX(0)} to{transform:translateX(-50%)} } /* 그룹 1개 폭만큼 */
.partner--logo{ background:transparent; border:0; }          /* 흰 카드 없이 */
.partner--logo img{ height:46px; width:auto; max-width:220px;
  object-fit:contain; mix-blend-mode:multiply; }             /* ★ 흰 배경 로고를 종이색에 녹임 */
.partner--logo.partner--tall img{ height:62px; }             /* 2단(세로형) 로고는 높이 ↑ */
```
- **`mix-blend-mode: multiply`**: 투명 PNG는 그대로, **흰 배경이 박힌 스캔 로고**도 밝은 배경(`--paper-warm`)에 자연스럽게 녹음. 별도 이미지 수정 없이 흰 네모 제거.
- 로고 크기 균형은 [에셋 파이프라인](#6-에셋-파이프라인-로고og-이미지)의 trim 규칙 참고.

---

## M8. 파일 업로드

`src/routes/admin.js`의 multer 설정 (재사용 코어):
```js
const storage = multer.diskStorage({
  destination: (q,f,cb)=>cb(null, UPLOAD_DIR),
  filename: (q,f,cb)=>cb(null, crypto.randomBytes(12).toString("hex") + path.extname(f.originalname).toLowerCase()),
});                                                   // ★ 랜덤 파일명 → 경로 추측·충돌 방지
const ALLOWED_EXT = new Set([".jpg",".jpeg",".png",".gif",".webp",".bmp",
  ".pdf",".hwp",".hwpx",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".zip",".txt"]);
const upload = multer({ storage, fileFilter, limits:{ fileSize:12*1024*1024, files:12 } });
```
- **확장자 화이트리스트**(`fileFilter`) + 용량/개수 제한. 거부 시 `err.publicMessage`로 친절한 오류.
- 한글 파일명 복원: `Buffer.from(name,"latin1").toString("utf8")` (multer latin1 → UTF-8).
- `handleUpload(field)` 래퍼가 `LIMIT_FILE_SIZE` 등을 413 + 안내 메시지로 변환.
- 업로드 파일은 `data/uploads/`에 저장, `/uploads`로 서빙(자체 CSP로 격리, M3-5).

---

## M9. WYSIWYG 에디터 (TinyMCE self-host)

HTML을 몰라도 본문을 편집하게 하는 모듈. **CSP 때문에 CDN 불가 → self-host 필수.**

- **배치**: `public/js/tinymce/`에 필요한 서브셋만 벤더링(`tinymce.min.js`, `icons/default`, `models/dom`, `themes/silver`, `skins/ui/oxide`, `skins/content/default`, 사용 plugins, `langs/ko_KR.js`). GPL(`license_key:'gpl'`, API 키 불필요).
- **인라인 이미지 업로드**: 별도 라우트 `POST /admin/columns/upload-image` → JSON `{location:"/uploads/…"}` 반환. CSRF는 `_csrf` 멀티파트 필드로. (★ `:id` 라우트보다 먼저 등록)
- **서버측 본문 정규화**(`normalizeColBody`): 저장 시 섹션 제목 `<h2>`를 표준형으로 통일 → 번호·목차·읽기시간 자동 생성(멱등). 편집기에선 번호를 CSS 카운터로 자동 표시(작성자가 못 건드리게).

재생성 커맨드:
```bash
npm i --no-save tinymce@7 tinymce-i18n     # 후 필요한 서브셋만 public/js/tinymce/로 복사
```

---

## M10. 게시판 모듈 (config → posts 재사용)

**새 게시판 = `config.js`의 `BOARDS`에 키 한 줄 추가.** 별도 테이블 없이 `posts`(`board='키'`)를 공유 → 목록(페이지네이션·검색)·상세(이미지·첨부)·조회수·상단고정·관리자 화면이 **전부 자동**으로 따라옴.
```js
global: { key:"global", name:"지구촌소식브리프", en:"GLOBAL BRIEF", desc:"…" },
```
- 목록/상세: `src/routes/board.js` + `views/board-list.ejs`·`board-post.ejs`.
- `image:true` 플래그 → 이미지형(썸네일) 게시판으로 렌더.
- 첨부: `attachments` 테이블(FK `post_id` ON DELETE CASCADE).

---

## M11. 통계·방문자 집계

`visits` 테이블에 순방문자 기록(쿠키 `uccv` 익명 식별자). **봇·정적파일·관리자·`/api`는 제외.**
- 유입 분류: referer 호스트로 `직접/내부/검색/소셜/기타` 판별.
- 디바이스: UA로 `모바일/데스크톱`.
- 날짜는 KST 기준. 관리자 통계 화면에서 집계.
- `security_events`·`blocked_ips` 테이블로 보안 이벤트·차단 IP도 집계.

---

## M12. 메일·스케줄러 (선택)

- **메일**: `src/mailer.js`(nodemailer). 회원 인증코드·환영메일 등. SMTP 환경변수 필요.
- **스케줄러**: `app.listen` 콜백에서 `require('./src/xxx').startScheduler()` 형태로 등록. 각 스케줄러는 **실패해도 서비스에 영향 없게** try/catch로 격리.
  - 예: 뉴스레터 자동 수집, 주간 리포트 자동 발행(Gemini), 회원 안내메일, 구글 캘린더 동기화.
- 외부 API 아웃바운드 지연 방지: `require("dns").setDefaultResultOrder("ipv4first")`.

> 이 모듈들은 도메인 특화 기능이므로 새 사이트에선 선택적으로만 가져오세요.

---

## 6. 에셋 파이프라인 (로고·OG 이미지)

빌드 스텝이 없으므로 이미지 가공은 **로컬 스크립트(gitignore된 `scripts/`)**에서 `sharp`로 처리하고 결과만 `public/`에 커밋합니다.
```bash
npm install --no-save sharp     # 런타임 의존성 아님(개발 전용)
```

### OG 공유 카드 PNG 생성
SVG로 디자인 → `sharp`로 1200×630 PNG 렌더(카카오/FB는 SVG 미지원). 한글은 Pretendard 없으면 Malgun Gothic 폴백.

### 로고 흰 배경 제거 (투명화)
스캔본 로고의 흰 배경은 **테두리 플러드필(flood-fill)**로 제거(내부의 의도된 흰색은 보존):
```
테두리에서 BFS로 '흰색 후보(모든 채널≥238)' 연결영역만 알파 0 → 가장자리 소프트 안티앨리어싱
```
→ 어떤 배경에서도 흰 네모 없이 표시. (CSS `mix-blend-mode:multiply`는 밝은 배경 한정 보조책)

### 로고 크기 균형 (trim)
로고마다 투명 여백 비율이 달라 같은 높이로 맞춰도 커 보이거나 작아 보임.
- **진단**: 각 로고의 "내용이 캔버스를 채우는 비율(fillH)" 측정.
- **처리**: 여백 과다 로고는 `sharp().trim()`으로 내용을 꽉 채움.
- **형태 보정**: 심볼+글자가 **세로로 쌓인 2단 로고**는 가로형과 같은 높이로 맞추면 글자가 작아지므로 `.partner--tall`로 높이 상향(62px).

---

## 7. 배포

**전제:** Node 22.5+ 서버 + **영구 저장소 `data/`**. (서버리스·정적 호스팅 부적합 — SQLite/업로드 유실)

핵심 환경변수: `NODE_ENV=production`, `SESSION_SECRET`(32자 이상 `openssl rand -hex 32`), `PORT`(호스트 지정).

### A. VPS + PM2 + Nginx (권장 — Cafe24 등)
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs
cd /var/www/site && npm install --omit=dev
export NODE_ENV=production SESSION_SECRET=$(openssl rand -hex 32)
sudo npm i -g pm2 && pm2 start server.js --name site && pm2 startup && pm2 save
```
→ Nginx 리버스 프록시(→ localhost:3000) + Certbot(HTTPS) + 도메인 연결. 보안 설정 예시: `deploy/nginx-security.conf`.

**운영 중 배포(이 저장소 관례):**
```bash
cd ~/<앱폴더> && git pull && pm2 restart <앱>
```
- CSS/JS/이미지만 바뀌면 `git pull`만으로 반영.
- **`index.html`·`server.js`·`views`·`.ejs`가 바뀌면 `pm2 restart` 필요**(정적 홈은 메모리 캐시, 서버 코드는 재기동).
- 의존성 변경 시 `npm ci --omit=dev` 추가.

### B. Docker
```bash
docker build -t site . && docker run -d -p 3000:3000 \
  -e NODE_ENV=production -e SESSION_SECRET=$(openssl rand -hex 32) \
  -v site-data:/app/data --restart unless-stopped site
```
`Dockerfile`: `node:24-alpine`, `VOLUME ["/app/data"]`.

### C. Render (빠른 테스트)
`render.yaml` 블루프린트 자동 구성(`SESSION_SECRET` 자동생성, `ADMIN_PASSWORD` 대시보드 입력). ※ 무료 플랜은 디스크 미지원(재배포 시 초기화).

**배포 후 체크:** 관리자 비밀번호 변경 · 지도 Client ID 도메인 등록 · `data/` 정기 백업.

---

## 8. 새 사이트에 적용하는 법 (리브랜딩 체크리스트)

프레임워크 코어(`server.js`·`src/db.js`·`src/config.js`의 헬퍼·보안·세션·업로드·라우트 뼈대)는 그대로 두고 아래만 교체:

- [ ] **브랜드 토큰**: `public/css/styles.css` `:root`의 색/폰트/radius 교체.
- [ ] **사이트명/메타**: `header.ejs` 타이틀·`og:site_name`·기본 description, `footer.ejs` 기관정보.
- [ ] **네비게이션**: `header.ejs`(서브) + `public/index.html`(메인) **두 곳**의 메뉴.
- [ ] **홈**: `public/index.html` 콘텐츠 교체(placeholder `__BASE__`/`__CSRF__`/`__*NAV*__` 유지).
- [ ] **게시판**: `src/config.js` `BOARDS` 재정의.
- [ ] **정적 페이지**: `src/pages.js`(소개/약관) 내용 교체.
- [ ] **OG 기본 이미지**: `public/img/og.jpg`(1200×630 PNG/JPG) 교체.
- [ ] **파비콘/심볼**: `public/img/` 로고 교체, `header`/`footer`의 `ucc-symbol.png` 경로.
- [ ] **DB 시드**: `src/db.js`의 시드 데이터(기관명·초기 콘텐츠) 교체. 테이블명은 유지하거나 일괄 변경.
- [ ] **환경변수**: `SESSION_SECRET`·`ADMIN_PASSWORD`·도메인·(선택)SMTP/지도/카카오 키.
- [ ] **CSP 외부 도메인**: 카카오/네이버/다음을 안 쓰면 `server.js` CSP `script-src`/`connect-src`에서 제거.
- [ ] **쿠키/세션 이름**: `ucc.sid`·`uccv` 등 접두어 변경(선택).
- [ ] **robots.txt**·**패키지명**(`package.json`)·**README/DEPLOY** 갱신.

---

## 9. 재사용 시 핵심 주의사항 (꼭 읽기)

1. **CSP가 외부 `<script>`를 차단** → 프런트 라이브러리는 `public/`에 self-host. (에디터·차트 등)
2. **정적 홈은 메모리 캐시** → `index.html` 수정 후 반드시 서버 재시작. 일반 정적 파일(css/js/img)은 재시작 불필요.
3. **이미지 교체 시 캐시** → 내용만 바꾸고 파일명이 같으면 `?v=2`로 캐시버스트.
4. **OG 이미지는 PNG/JPG** (SVG는 카카오/FB 미렌더).
5. **메뉴는 두 곳**(메인 index.html + header.ejs) 동시 수정.
6. **멀티파트 업로드는 multer를 CSRF보다 먼저**.
7. **구체 라우트를 `:param`보다 먼저** 등록.
8. **`data/`는 git 제외 + 영구 볼륨 + 정기 백업**. 민감 업로드/개인정보 파일은 커밋 금지.
9. **Node 22.5+ 필수**(`node:sqlite`). 18 이하 불가.
10. **단일 노드 전제**: 인메모리 세션·차단캐시·SQLite는 수평 확장 시 공유 스토어로 교체 필요.

---

## 10. 부록

### 환경변수 전체 표

| 변수 | 필수 | 설명 |
|---|---|---|
| `NODE_ENV` | 운영 | `production` 권장 |
| `PORT` | – | 기본 3000 (호스트가 지정) |
| `SESSION_SECRET` | **운영 필수** | 32자 이상 임의 문자열. 미설정 시 경고 |
| `ADMIN_USERNAME` | – | 기본 `admin` |
| `ADMIN_PASSWORD` | – | 최초 관리자 비번(없으면 랜덤 생성 → `data/INITIAL_ADMIN_PASSWORD.txt`) |
| `KAKAO_JS_KEY` | – | 카카오 리치 공유 SDK (선택) |
| `NAVER_MAP_CLIENT_ID` | – | 오시는길 지도 (선택) |
| `GEMINI_API_KEY` | – | 자동 리포트 집필 (선택) |
| SMTP 관련 | – | 메일 발송 시 (선택) |

### 자주 쓰는 명령어
```bash
npm install            # 의존성 설치
npm start              # 운영 실행 (node server.js)
npm run dev            # 개발 (node --watch server.js)
pm2 restart <앱>       # 서버 코드/HTML 변경 반영
```

### 부팅 로그에서 확인할 것
- `[env] .env 로드됨`
- `[security] 차단 IP N건 로드`
- 최초 실행 시 관리자 계정 안내 박스 (`data/INITIAL_ADMIN_PASSWORD.txt`)

---

*이 문서는 현재 저장소의 실제 코드(`server.js`, `src/`, `views/partials/`, `public/css`)를 기준으로 작성되었습니다. 코드가 바뀌면 함께 갱신하세요.*
