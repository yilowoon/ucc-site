# 배포 안내 (도시공동체본부 홈페이지)

이 앱은 **Node.js 22.5+ 서버 + 영구 저장소(`data/`)** 가 필요합니다.
(정적 호스팅·서버리스는 SQLite/업로드가 유실되어 부적합)

핵심 환경변수
- `NODE_ENV=production`
- `SESSION_SECRET` : 32자 이상 임의 문자열 (`openssl rand -hex 32`)
- `PORT` : 호스트가 지정 (기본 3000)

데이터 영구 보존: **볼륨을 `/app/data` (또는 프로젝트의 `data/`)에 마운트**.
`data/` 폴더만 백업하면 전체 데이터(DB+업로드)가 보존됩니다.

---

## A. 클라우드 서버(VPS) — 가장 안정적
Ubuntu 예시:
```bash
# Node 24 설치
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
# 코드 배치 후
cd /var/www/ucc-site
npm install --omit=dev
export NODE_ENV=production SESSION_SECRET=$(openssl rand -hex 32)
# 상시 실행 (PM2)
sudo npm i -g pm2
pm2 start server.js --name ucc-site
pm2 startup && pm2 save
```
그다음 Nginx 리버스 프록시(→ localhost:3000) + Certbot(HTTPS) + 도메인(ucc.or.kr) 연결.

## B. Docker (어디서나)
```bash
docker build -t ucc-site .
docker run -d --name ucc-site -p 3000:3000 \
  -e NODE_ENV=production -e SESSION_SECRET=$(openssl rand -hex 32) \
  -v ucc-data:/app/data --restart unless-stopped ucc-site
```

## C. Render (무료·카드 불필요) — 빠른 테스트용
1. 코드를 GitHub 저장소에 push
2. render.com → New → Web Service → 저장소 연결
3. Build: `npm install`  /  Start: `node server.js`
4. Environment: `NODE_ENV=production`, `SESSION_SECRET=<임의값>`
5. (영구 보존 필요 시) Disk 추가 → Mount Path `/app/data`  ※ 무료 플랜은 디스크 미지원(재배포 시 초기화)

## D. Railway / Fly.io — 영구 볼륨 지원
- Railway: `railway login` → `railway up` (로컬에서 바로 배포) + Volume `/app/data`
- Fly.io: `fly launch` (Dockerfile 자동 인식) + `fly volumes create data` → `/app/data`

---
배포 후: 관리자 비밀번호 변경, 네이버 지도 Client ID 등록, `data/` 정기 백업.
