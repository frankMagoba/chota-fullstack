FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY test ./test
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:4000/health || exit 1
# Migrate, seed (idempotent), then serve.
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/scripts/seed.js && node dist/src/server.js"]
