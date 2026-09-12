FROM node:22-alpine
# build context คือ project root (ดู docker-compose.yml) เพื่อให้ COPY migration ได้
WORKDIR /app/apps/api
COPY apps/api/package.json ./
RUN npm install
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
COPY db/migrations /app/db/migrations
RUN npm run build && npm prune --omit=dev
EXPOSE 4000
# dist/src เพราะ tsconfig ใช้ rootDir "." (src + tests) และ outDir "dist"
CMD ["node", "dist/src/index.js"]
