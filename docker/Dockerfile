# Single image: the Node API also serves the built frontend.
# Build from the repo root: docker build -f docker/Dockerfile .

# Frontend build
FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js svelte.config.js jsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

# Server production dependencies
FROM node:22-alpine AS server-deps
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev

# Runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public

COPY --from=server-deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/scripts ./scripts
COPY server/migrations ./migrations
COPY --from=frontend /app/dist ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "src/index.js"]
