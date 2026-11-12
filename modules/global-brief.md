# 모듈 M‑GB · 지구촌소식브리프(Global Brief)

> 매일 하나의 주제를 정해 **해외 사회연대경제·공동체경제** 자료를 조사하고, Gemini로 A4 약 10쪽의 **심층 이슈 보고서**를 집필해 자동 발행하는 AI 발간 시스템.
> 단순 기사 수집이 아니라 **주제 선정 → 리서치 → 설계 → 절별 심층 집필 → docx 조판 → 게시글+첨부 발행 → 카카오/친구톡 발송**까지 완전 자동(매일 07:00 KST).
> 이 문서 하나로 전체 파이프라인·설정·연동·재사용을 파악한다.
>
> 상위 문서: [`FRAMEWORK.md`](../FRAMEWORK.md) · 형제 모듈: [데일리뉴스](daily-news.md)(수집 함수 `fromDaum`/`fromGoogle`를 여기서 재사용), [관리페이지](admin.md).
> 핵심 파일: `src/globalnews.js`(엔진 전체, ~1,340줄) · `src/docx.js`(조판) · `src/kakao.js`·`src/solapi.js`(발송).

---

## 0. 한눈에 보기

| 항목 | 값 |
|---|---|
| 공개 URL | `/board/global`(목록), `/board/global/:id`(상세) — **일반 게시판**(`board.js`) |
| 보드 정의 | `src/config.js` `BOARDS.global` (name "지구촌소식브리프", en "GLOBAL BRIEF") |
| 저장 | `posts` 테이블(`board='global'`) + `attachments`(docx). **전용 테이블 없음** |
| 엔진 | `src/globalnews.js` |
| 발행 주기 | 매일 **07:00 KST**(서버 타임존 무관) + 매시간 캐치업 |
| 카카오 발송 | 매일 **08:00 KST** '나에게 보내기'(한 통 ≤200자+링크) |
| 친구톡(회원) | 08:00 동시, 솔라피 1,000자(유료, [[deferred-tasks]]) |
| AI | Gemini(무료 티어) 텍스트 집필. `GEMINI_API_KEY` 필수 |
| 중복 방지 | `posts.source_guid = report:<YYYY-Dddd>:<주제키>` |
| 수동 발행 | 관리자 → `POST /admin/global/collect`(force) |
| 저작권 | 원문 전문 저장 안 함 — 우리가 쓴 분석·요약 + 출처 링크만 |

> **발행 주체:** 도시공동체본부 / **발간물명:** 지구촌소식브리프 / **발행인:** 이형구.

---

## 1. 메뉴구성 · 공개 노출

지구촌소식브리프는 **일반 게시판(`global`)**이라 목록/상세/검색/첨부/관리자 화면이 다른 게시판과 완전히 동일하게 동작한다(별도 라우트 없음, `board.js`가 처리).

### 1-1. 네비게이션(알림마당 서브메뉴) — 4곳
데일리뉴스 바로 뒤에 위치. 메뉴 변경 시 아래를 모두 맞춘다([[main-nav-separate]]):

| 파일 | 위치 |
|---|---|
| `public/index.html` | 데스크톱 드롭다운 + 모바일 (`/board/global`) |
| `views/partials/header.ejs` | 데스크톱 드롭다운 + 모바일 |
| `views/partials/board-tabs.ejs` | 알림마당 상단 탭 (`boards.global.name`) |

순서(고정): 공지사항 → 사업안내 → 보도자료 → 데일리뉴스 → **지구촌소식브리프** → 도시공동체본부 활동.

### 1-2. 목록 상단 소개 히어로
`views/board-list.ejs`의 `currentBoard === 'global'` 분기가 `.brief-intro` 히어로를 렌더(GLOBAL BRIEF · 일일 발간 / "세계는 지금, 공동체로 도시를 다시 세운다" / 발간일 매일 오전 7시). 스타일 `public/css/board.css`의 `.brief-intro`.

---

## 2. 발행 파이프라인 (`collectOnce`)

하루 1회 멱등 발행. 동시 실행 방지 플래그 `_collectRunning` + 날짜·주제 guid 중복 체크.

```
collectOnce({force})
 └ _collectOnceInner
   1) 주제 선정    daySeq(오늘).dayOfYear % THEMES.length  (일자 로테이션)
                   force면 오늘 미발행 주제로 밀어 발행
   2) 중복/키 체크  guid=report:<YYYY-Dddd>:<theme> 이미 있으면 skip(=멱등)
                   GEMINI_KEY 없으면 skip / 하루 시도상한 6회(429 할당량 보호)
   3) 리서치       researchSources(theme, 12건)
                     ① Daum 국문(본문)  ② Bing 국문  ③ Bing 영문(해외)
                     관련성+해외 필터(isRelevant) — 국내 기사 배제
   4) 보강·번역    enrichIntlSources(영문 본문 fetch) → translateSourcesToKorean
   5) 집필         writeFullReport
                     a. 설계안(outline): 제목·한줄요약·핵심내용·사례 3~4개
                     b. sectionPlan: 개요/배경/국제담론/사례별/비교/시사점/결론
                     c. 절별 심층 집필(1개씩 순차, 전역 스로틀)
                   koreanizeReport(잔여 영문 한국어화)
   6) 발행         publishReport
                     - posts INSERT(board=global, source_guid)
                     - makePostBody: [주요내용][시사점][참고자료][오늘의 명언][고지]
                     - makeReportDocx → data/uploads/*.docx → attachments
   7) (별도) 카카오 08:00 스케줄러가 오늘자 글을 읽어 발송
```

품질 게이트(저품질 발행 차단): 관련 자료 0건이면 skip, LLM 집필 전부 실패하면 **fallback 미발행**(완결 한국어 심층 보고서만 발행).

---

## 3. 주제 로테이션 (`THEMES`)

`src/globalnews.js` 상단 `THEMES` 배열(6개). 하루 1개씩 `dayOfYear` 기준 순환.

| key | 주제 |
|---|---|
| `sse-policy` | 해외 사회연대경제 정책의 최신 흐름 |
| `coops` | 협동조합이 떠받치는 지역경제 |
| `community` | 주민이 소유하는 공동체경제 |
| `energy` | 주민참여 에너지전환과 연대경제 |
| `care` | 돌봄을 다시 짜는 사회적경제 |
| `finance` | 연대금융 — 사회적경제를 지탱하는 돈의 구조 |

각 테마: `{ title, focus, queries[](국문 검색어), match[](관련성 키워드) }` + 영문 검색어 `QUERIES_EN[key]`.
**주제를 바꾸려면 `THEMES`만 수정**하면 된다.

### 관련성 필터 (`isRelevant`)
- **CORE_KEYWORDS**(사회연대경제·협동조합 등) + 테마 `match` 중 1개 이상 → 주제 적합.
- **OVERSEAS_KEYWORDS**(해외·EU·유럽·cooperative 등) 1개 이상 필수 → 국내 기사 배제.
- **DOMESTIC_MARKERS**(국회·서울시 등) 있고 해외 신호 약하면 배제.

---

## 4. 리서치 소스

| 함수 | 소스 | 용도 |
|---|---|---|
| `fromDaum(q)` | Daum 뉴스(본문 크롤) | 국문 해외보도, 심층 근거 — **newsletter.js에서 import** |
| `fromGoogle(q)` | Google 뉴스 RSS | 폴백 — **newsletter.js에서 import** |
| `fromBingNews(q, lang)` | Bing 뉴스 RSS | 국문 보강 + **영문 해외뉴스**(실제 URL·스니펫) |
| `enrichIntlSources` | 영문 기사 본문 fetch | 심층 분석 근거 보강 |
| `translateSourcesToKorean` | Gemini | 영문 발췌 → 한국어 정리 |

모든 외부 호출: 타임아웃·`sleep` 간격·실패 무시(수집 0건이어도 서버 정상).

---

## 5. Gemini 집필 (무료 티어 안정화)

무료 Gemini는 분당 요청 한도가 엄격해 몰아치면 503이 난다. 이를 견디는 장치가 핵심:

- **전역 직렬 큐 `throttleGemini`** — 모든 호출을 한 줄로, 간격 `GEMINI_MIN_GAP_MS`(기본 5초 ≈ 12req/min) 강제.
- **모델 자동 선택 `resolveModel`** — `GEMINI_TEXT_MODEL` 우선, 없으면 ListModels에서 `flash-lite` 계열 우선 선택(404 회피). 기본 `gemini-3.1-flash-lite`.
- **재시도 `geminiJson`** — 429/503/타임아웃 백오프(8s→최대 45s), 404 시 모델 재해결. 할당량 보호를 위해 최대 4회.
- **하루 시도 상한** — `report_attempts:<날짜>` 설정값으로 자동 캐치업 6회 제한(무료 할당량을 챗봇 등과 공유하므로 보호). 수동 '지금 발행'은 예외.
- **이미지 생성은 쓰지 않음** — 텍스트(JSON)만. (무료 티어 이미지 불가 [[image-generation-constraint]])

집필 지침(`RULES`, `PERSONA_PROMPT`): 해외 전용·한국어·출처 사실만(환각 방지)·완결 문장·국가 다양성(한 나라 2개 초과 금지).

---

## 6. 게시글 본문 & docx

### 게시글 본문 (`makePostBody`) — 순수 텍스트
머리글 + `[주요내용]`(buildHighlight, ~1분 분량) + `[시사점]`(extractImplications) + `[참고자료]`(상위 10건, URL은 뷰가 새 창 링크) + `[오늘의 명언]`(검증된 격언 풀 `QUOTES`) + 저작권 고지.

### docx 조판 (`makeReportDocx` → `src/docx.js`)
표지·발행정보·판권(`COLOPHON`) + 한 줄 요약 + 핵심 내용 + 본문 절 + 참고자료. 파일명 `safeFileName(제목 (날짜)).docx`, `data/uploads/`에 랜덤 hex로 저장 후 `attachments` 연결.

---

## 7. 스케줄러 (KST 고정)

서버 타임존과 무관하게 항상 KST 계산(`kstTargetMs`/`msUntilDaily`/`kstPassedToday`).

| 스케줄러 | 시각 | 동작 |
|---|---|---|
| `startScheduler` | 매일 **07:00** | 발행(`collectOnce`). 정시 `setTimeout` 재귀 + **매시간 캐치업**(07시 지났는데 오늘자 없으면 즉시 발행, 멱등). 시작 즉시 재시작 캐치업 1회 |
| `startKakaoScheduler` | 매일 **08:00** | 오늘자 글 읽어 카카오 '나에게 보내기' + 친구톡. 매시간 캐치업 |

부팅 와이어링(`server.js`):
```js
require("./src/globalnews").startScheduler();       // 07:00 발행
require("./src/globalnews").startKakaoScheduler();  // 08:00 발송
```
각 try/catch로 감싸 하나가 죽어도 부팅 계속.

---

## 8. 카카오 / 친구톡 발송

발행(07:00)과 **분리**. 08:00에 오늘자 글을 읽어 전송(하루 1회 멱등: `kakao_memo_last_sent_daykey` / `friendtalk_last_sent_daykey`).

- **카카오 '나에게 보내기'** (`sendTodayKakao` → `src/kakao.js`): `buildKakaoShortFromPost`로 한 통(≤200자, 날짜+주요내용 압축+링크). 조건: `isConnected()`(리프레시 토큰) && `autoSendOn()`. 링크 `BASE_URL/board/global/:id`.
- **친구톡(회원)** (`sendTodayFriendtalk` → `src/solapi.js`): `memberPhones()`(회원 전화) 대상 1,000자. 조건: `isConfigured()` && `onFlag()`. **유료라 기본 보류** [[deferred-tasks]].
- 저장 글 파싱 `parseGlobalPost`: 본문에서 날짜·주요내용·관련소식10·명언 추출(재발송·미리보기용).

---

## 9. 관리자 연동 (`admin.md` 참조)

- **수동 발행**: 문의 관리가 아닌, 대시보드 게시판 필터 `?board=global`에서 `POST /admin/global/collect` → `collectOnce({force:true})` 백그라운드 실행(자료 조사·집필로 3~6분).
- **카카오 자동발송 관리**: `/admin/kakao-memo`(`admin-kakao.ejs`) — 카카오 연결(connect/callback), 테스트 발송, 자동발송 on/off, 친구톡 토글. 허브 카드 "💬 카카오톡 자동발송".

---

## 10. 설정 / 환경변수

| 변수 | 필수 | 용도 |
|---|---|---|
| `GEMINI_API_KEY` | **필수** | 집필·번역. 없으면 발행 skip |
| `GEMINI_TEXT_MODEL` | 선택 | 지정 시 신뢰(기본 자동선택 `flash-lite`) |
| `GEMINI_BASE_URL` | 선택 | 기본 generativelanguage.googleapis.com |
| `GEMINI_MIN_GAP_MS` | 선택 | 호출 간격(기본 5000) |
| `BASE_URL` | 선택 | 카카오/친구톡 링크 절대주소(기본 ucc.or.kr) |
| 카카오 REST/리프레시 | 선택 | 나에게 보내기(관리자 연결로 획득) |
| 솔라피 키 | 선택 | 친구톡(유료, 보류) |

---

## 11. 재사용 체크리스트

**바꿀 것:**
1. **주제** — `THEMES`(+`QUERIES_EN`) 교체. 관련성은 `CORE_KEYWORDS`·`OVERSEAS_KEYWORDS`·`DOMESTIC_MARKERS` 조정.
2. **브랜드** — `AUTHOR`·`PUBLISHER_NAME`·`PERSONA`·`COLOPHON`·`BOARD`(보드 키), `config.js` `BOARDS`의 해당 보드.
3. **히어로** — `board-list.ejs`의 `currentBoard==='키'` 소개 블록.
4. **발행/발송 시각** — `startScheduler`(H,M)·`startKakaoScheduler`.
5. **명언 풀** — `QUOTES`.
6. **발송 채널** — 카카오/친구톡 불필요하면 `startKakaoScheduler` 미등록.

**그대로 가져갈 코어:** 멱등 발행(guid), 일자 주제 로테이션, 리서치 폴백 체인, Gemini 스로틀·모델 자동선택·재시도·시도상한, 품질 게이트, KST 스케줄러+캐치업, docx 조판, 저작권 설계(전문 미저장).

---

## 12. 주의사항 (Gotchas)

- **일반 게시판이다.** `global`은 `posts`의 한 board일 뿐 — 전용 라우트/테이블 만들지 말 것. 목록·상세·검색·관리자 CRUD는 `board.js`가 공통 처리.
- **GEMINI_KEY 없으면 발행 안 됨.** `.env` 설정 후 `pm2 restart ucc`.
- **무료 할당량 공유.** 챗봇·번역과 같은 키를 쓰면 소진 위험 → 하루 시도상한 6회로 보호. 과도한 수동 발행 자제.
- **발행 3~6분 소요.** 리서치+절별 순차 집필(스로틀) 때문. 수동 '지금 발행'은 백그라운드 실행.
- **스케줄러는 KST 고정.** 서버가 UTC여도 07:00/08:00 KST에 동작(자체 환산).
- **외부 뉴스 소스 취약성.** Daum/Bing 구조 변경 시 파서 수정 필요. 수집 0건이면 그날 발행 skip(서버는 정상).
- **친구톡은 유료·보류.** 지시 전 활성화 금지 [[deferred-tasks]].
- **저작권.** 원문 전문 저장 금지 — 분석·요약+출처 링크만. 재사용 시에도 이 원칙 유지.

---

## 13. 데이터 흐름 요약

```
[07:00 KST] startScheduler ─▶ collectOnce
   주제(일자 로테이션) → 리서치(Daum/Bing 국문·영문) → 관련성·해외 필터
      → 영문 본문 보강 → 한국어 번역
      → Gemini 설계안 → 절별 심층 집필(스로틀) → 한국어화
      → posts INSERT(board=global, guid) + docx 첨부
                         │
                         ├─▶ /board/global           목록(히어로) · 상세(board.js)
                         └─▶ [08:00] startKakaoScheduler
                                ├ 카카오 '나에게 보내기'(≤200자+링크)
                                └ 친구톡(회원 1000자, 보류)
   ※ 매시간 캐치업: 놓친 발행/발송을 멱등으로 보완
```
