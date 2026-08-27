# 사단법인 도시공동체본부 홈페이지

Node.js + Express + 내장 SQLite(`node:sqlite`) 기반의 기관 홈페이지 및 게시판.

## 구성

- **랜딩 페이지** (`/`) — 기관 소개 원페이지 (정적 `public/index.html`)
- **게시판 3종** — 공지사항 `/board/notice`, 보도자료 `/board/press`, 사업안내 `/board/business`
  - 목록(페이지네이션·검색) · 상세(이미지 표시·첨부 다운로드) · 조회수 · 상단 고정(공지)
- **관리자** (`/admin`) — 로그인 후 글 작성·수정·삭제, 이미지/문서 다중 업로드, 비밀번호 변경

## 실행

```bash
npm install
npm start
```

- 접속: http://localhost:3000
- 관리자: http://localhost:3000/admin/login
- 포트 변경: `PORT=8080 npm start`

### 최초 관리자 계정

서버를 처음 실행하면 관리자 계정이 자동 생성되고, 아이디(`admin`)와 임시 비밀번호가
- 콘솔에 출력되고
- `data/INITIAL_ADMIN_PASSWORD.txt` 파일에 기록됩니다.

로그인 후 **[비밀번호 변경]**에서 반드시 변경하세요.

## 데이터 저장 위치

- DB: `data/ucc.db` (SQLite)
- 업로드 파일: `data/uploads/`

> `data/` 폴더를 백업하면 전체 게시판 데이터가 보존됩니다.

## 폴더 구조

```
server.js              Express 앱 진입점
src/
  db.js                SQLite 초기화·스키마·관리자 시드
  config.js            게시판 정의·공용 헬퍼
  routes/board.js      공개 게시판(목록·상세·다운로드)
  routes/admin.js      관리자(인증·CRUD·업로드)
  newsletter.js        데일리뉴스 자동 수집(매일 08:00·18:00)
  globalnews.js        지구촌소식브리프 주간 리포트 자동 발행(매주 월 07:00)
tools/                 문서 자동 게시 도구 (tools/README.md 참고)
views/                 EJS 템플릿
public/                정적 자산(index.html, css, js)
data/                  DB·업로드(자동 생성, git 제외)
```

## 배포 메모

- 운영 환경에서는 환경변수 `SESSION_SECRET`(임의 문자열)와 `PORT`를 설정하고,
  HTTPS 사용 시 `server.js`의 세션 쿠키 `secure: true`로 변경하세요.
- Node 18 이하에는 `node:sqlite`가 없습니다. **Node 22.5+** 필요(권장 LTS 24).


## 지구촌소식브리프

`src/config.js` 의 `BOARDS` 에 `global` 키로 정의된 **일반 게시판**입니다.
별도 테이블 없이 `posts` 테이블(`board='global'`)을 쓰므로 목록·상세·검색·
첨부파일·관리자 화면이 다른 게시판과 완전히 동일하게 동작합니다.
목록 상단에는 발간 취지를 소개하는 hero(`board-list.ejs` 의 `currentBoard==='global'`)가 붙습니다.

여기에 `src/globalnews.js` 가 **주간 이슈 브리프**를 자동 발행합니다.

- **결과물**: 매주 하나의 주제를 정해 관련 자료를 조사·종합한 **한 편의 보고서**.
  요약·주요 시사점·참고자료는 게시글 본문으로, 해외사례 심층 보고서는 **docx 첨부**로.
- **집필**: 개요(outline) → 절(section)별 개별 집필 다단계로 Gemini 호출(`GEMINI_API_KEY`).
  키가 없거나 실패하면 수집 자료로 만든 **다이제스트 폴백**으로 발행됨.
- **주제**: 사회연대경제 정책 · 협동조합 · 공동체경제 · 에너지전환 · 돌봄 · 연대금융
  (`THEMES` 배열에서 주차별 로테이션)
- **소스**: Daum 뉴스 검색(본문까지) → 실패 시 Google 뉴스 RSS
- **주기**: 매주 월요일 07:00 (`startScheduler`)
- **발행/발간물명**: 발행 도시공동체본부 / 발간물 `지구촌소식브리프`
- **중복 방지**: `posts.source_guid = report:<주차>:<주제키>`
- **저작권**: 원문 전문 저장 안 함. 우리가 쓴 분석·요약 + 출처 링크만
- **수동 실행**: 관리자 → 지구촌소식브리프 탭 → `📄 지금 리포트 발행`
- **환경변수(선택)**: `GEMINI_TEXT_MODEL`(기본 `gemini-2.0-flash`; 심층에는 상위 모델 권장)

### 주제를 바꾸려면

`src/globalnews.js` 의 `THEMES` 만 고치면 됩니다.

```js
{
  key: "coops",                       // source_guid 중복방지 키
  title: "협동조합이 떠받치는 지역경제, 해외의 실험",
  focus: "노동자·소비자·플랫폼 협동조합이 지역 고용과 돌봄을 지탱하는 사례",
  queries: ["해외 협동조합 지역경제", "노동자협동조합 사례"],  // 리서치 검색어
}
```
