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
  globalnews.js        지구촌소식 AI기자 자동 수집(매일 07:00·19:00)
tools/                 문서 자동 게시 도구 (tools/README.md 참고)
views/                 EJS 템플릿
public/                정적 자산(index.html, css, js)
data/                  DB·업로드(자동 생성, git 제외)
```

## 배포 메모

- 운영 환경에서는 환경변수 `SESSION_SECRET`(임의 문자열)와 `PORT`를 설정하고,
  HTTPS 사용 시 `server.js`의 세션 쿠키 `secure: true`로 변경하세요.
- Node 18 이하에는 `node:sqlite`가 없습니다. **Node 22.5+** 필요(권장 LTS 24).


## 지구촌소식 AI기자

`src/config.js` 의 `BOARDS` 에 `global` 키로 정의된 **일반 게시판**입니다.
별도 테이블 없이 `posts` 테이블(`board='global'`)을 쓰므로 목록·상세·검색·
첨부파일·관리자 화면이 다른 게시판과 완전히 동일하게 동작합니다.

여기에 `src/globalnews.js` 가 자동 수집을 붙입니다.

- **주제**: 도시재생 · 사회연대경제 · 에너지전환 · 지방소멸 · 협동조합 · 기후적응
  (`TOPICS` 배열에서 검색어와 '왜 주목하나' 문구를 함께 관리)
- **소스**: Daum 뉴스 검색 → 실패 시 Google 뉴스 RSS
  (`newsletter.js` 의 수집 함수를 재사용)
- **주기**: 매일 07:00 / 19:00. 데일리뉴스(08:00/18:00)와 겹치지 않게 어긋냄
- **분량**: 1회 최대 2건, 주제당 1건 — 게시판이 한꺼번에 밀리지 않도록 의도적으로 적게
- **중복 방지**: `posts.source_guid` + 부분 유니크 인덱스
  (수동 작성 글은 빈 값이라 충돌하지 않음)
- **저작권**: 원문 전문을 저장하지 않고 제목 + 요약 발췌 + 출처·링크만 남김
- **수동 실행**: 관리자 → 지구촌소식AI기자 탭 → `🌏 지금 수집`

### 주제를 바꾸려면

`src/globalnews.js` 의 `TOPICS` 만 고치면 됩니다.

```js
{
  name: "도시재생",                 // 제목 앞에 [도시재생] 으로 붙음
  query: "해외 도시재생 사례",       // 실제 검색어
  angle: "쇠퇴한 도심을 되살린 …",   // 본문 '왜 주목하나'에 들어갈 한 줄
}
```
