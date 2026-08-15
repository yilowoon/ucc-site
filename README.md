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
views/                 EJS 템플릿
public/                정적 자산(index.html, css, js)
data/                  DB·업로드(자동 생성, git 제외)
```

## 배포 메모

- 운영 환경에서는 환경변수 `SESSION_SECRET`(임의 문자열)와 `PORT`를 설정하고,
  HTTPS 사용 시 `server.js`의 세션 쿠키 `secure: true`로 변경하세요.
- Node 18 이하에는 `node:sqlite`가 없습니다. **Node 22.5+** 필요(권장 LTS 24).
