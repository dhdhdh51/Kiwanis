# ---------- Build ----------
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY server/prisma server/prisma
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- Runtime ----------
FROM node:22-bookworm-slim
# ffmpeg enables server-side duration probing, thumbnails and quality renditions
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy --schema server/prisma/schema.prisma && node server/dist/index.js"]
