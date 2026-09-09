# syntax=docker/dockerfile:1

# ---- frontend build ----
FROM node:20-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- backend deps (native build tools for better-sqlite3's prebuild/node-gyp) ----
FROM node:20-bookworm-slim AS backend-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=backend-deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY --from=web-build /app/web/dist ./web/dist

RUN useradd --system --create-home --shell /usr/sbin/nologin stage2prod \
    && mkdir -p /app/data \
    && chown -R stage2prod:stage2prod /app

USER stage2prod
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
