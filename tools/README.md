# tools — 보고서 자동 게시

문서 파일을 게시판에 글로 등록하고 첨부파일로 붙이는 도구입니다.
메인페이지 '주요 전달 소식'은 `notice`/`press`/`business` 게시판의
**최신 글 1건씩**을 자동으로 읽어가므로(`src/routes/site.js` → `GET /api/home`),
글만 등록하면 요약본 노출은 따라옵니다. 메인을 따로 손댈 필요가 없습니다.

## 준비 (최초 1회)

관리자 계정을 Windows 사용자 환경변수로 등록합니다. 스크립트에 비밀번호를
직접 적지 마세요.

```cmd
setx UCC_BASE_URL   "https://ucc.or.kr"
setx UCC_ADMIN_USER "admin"
setx UCC_ADMIN_PASS "실제-관리자-비밀번호"
```

등록 후 명령 프롬프트를 새로 열어야 값이 반영됩니다.

## 사용법

### 1. 메타 파일 방식 (권장)

문서 옆에 같은 이름의 `.meta.json`을 두면 자동으로 찾습니다.

```
보고서.docx
보고서.meta.json
```

```json
{
  "board": "press",
  "title": "[증시 브리프] 한·미 증시 현황 통합 보고서 (2026. 8. 26. 기준)",
  "author": "도시공동체본부",
  "pinned": false,
  "summary": [
    "첫 문단입니다.",
    "",
    "○ 소제목",
    "내용을 씁니다."
  ]
}
```

`summary`는 문자열 또는 문자열 배열(배열은 줄바꿈으로 이어붙임)입니다.

```cmd
node tools/publish-report.mjs --file "C:\경로\보고서.docx"
```

### 2. 인자로 직접 지정

```cmd
node tools/publish-report.mjs --file 보고서.docx --board press ^
  --title "제목" --summary-file 요약.txt
```

### 3. 미리보기 (아무것도 전송하지 않음)

```cmd
node tools/publish-report.mjs --file 보고서.docx --dry-run
```

## 옵션

| 옵션 | 설명 |
|---|---|
| `--file` | 올릴 문서 (필수) |
| `--meta` | 메타 JSON 경로 (기본: `<파일명>.meta.json` 자동 탐색) |
| `--board` | `notice` / `press` / `business` / `news` / `global` (기본 `press`) |
| `--title` | 글 제목 (200자 이내) |
| `--summary` / `--summary-file` | 본문에 들어갈 요약본 |
| `--author` | 작성자 (기본 `도시공동체본부`) |
| `--pinned` | 상단 고정 |
| `--mode` | `http`(기본) 또는 `db` |
| `--base-url` | 대상 사이트 (기본 `https://ucc.or.kr`) |
| `--dry-run` | 전송하지 않고 결과만 출력 |

## 동작 모드

| 모드 | 동작 | 언제 쓰나 |
|---|---|---|
| `http` | 관리자로 로그인 → `POST /admin/write` 로 등록 | **기본.** 어디서 실행하든 동작 |
| `db` | `data/ucc.db` 에 직접 INSERT + `data/uploads/` 로 복사 | 서버 안에서 실행할 때. 로그인 불필요, 더 빠름 |

`db` 모드는 `data/` 폴더가 있는 환경(서버 또는 로컬 개발본)에서만 동작합니다.
운영 서버가 원격이면 `http` 모드를 쓰세요.

## 제약 (서버 설정과 일치)

- 첨부 최대 **12MB** — `src/routes/admin.js` 의 `MAX_FILE`
- 허용 확장자 — 이미지 + `pdf hwp hwpx doc docx xls xlsx ppt pptx zip txt`
- **본문에 HTML을 쓰면 태그가 글자 그대로 보입니다.**
  `board-post.ejs` 가 `nl2br(escapeHtml(content))` 로 렌더하기 때문입니다.
  스크립트가 태그를 자동으로 제거하지만, 애초에 순수 텍스트로 작성하세요.

## 매일 자동 실행 (Windows 작업 스케줄러)

1. `tools/publish-report.bat` 를 사용합니다.
2. 작업 스케줄러 → 작업 만들기
   - 트리거: 매일 원하는 시각
   - 동작: 프로그램 시작 → `tools\publish-report.bat`
   - 인수: 올릴 문서의 전체 경로
   - 시작 위치: 이 프로젝트 폴더
3. "사용자가 로그온하지 않아도 실행"을 켜면 PC가 켜져 있기만 하면 됩니다.

## 종료 코드

성공 `0`, 실패 `1` (오류 메시지는 `✗` 로 시작). 스케줄러에서 실패 감지에 쓰세요.

