# 도시공동체본부 홈페이지 - 프로덕션 이미지
FROM node:24-alpine

WORKDIR /app

# 의존성 먼저 (레이어 캐시)
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 앱 소스
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# data/ (SQLite + 업로드)는 영구 볼륨으로 마운트하세요: /app/data
VOLUME ["/app/data"]

CMD ["node", "server.js"]
