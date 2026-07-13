# syntax=docker/dockerfile:1

# ---- build everything (shared -> backend -> frontend) ----
FROM node:22-alpine AS builder
WORKDIR /app
# manifests first for layer caching; workspaces need every package.json
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci
COPY . .
# VITE_SERVER_URL is absent (see .dockerignore) so the SPA uses same-origin sockets
RUN npm run build

# ---- production runtime (prod deps only) ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production SERVE_CLIENT=1 PORT=4000 ASSET_DIR=/app/uploads
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev
# built output; the monorepo layout must be preserved (backend resolves
# ../../frontend/dist at runtime and imports @vtt/shared -> shared/dist)
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 4000
CMD ["node", "backend/dist/index.js"]
