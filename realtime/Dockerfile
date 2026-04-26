FROM oven/bun:1.3.11-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY protocol/package.json protocol/package.json
COPY realtime/package.json realtime/package.json
RUN bun install --frozen-lockfile

COPY protocol protocol
COPY realtime realtime
COPY web/convex/_generated web/convex/_generated
RUN bun run check:realtime

FROM oven/bun:1.3.11-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787

COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY protocol/package.json protocol/package.json
COPY realtime/package.json realtime/package.json
RUN bun install --frozen-lockfile --production

COPY protocol protocol
COPY realtime realtime
COPY web/convex/_generated web/convex/_generated

USER bun
WORKDIR /app/realtime
EXPOSE 8787
CMD ["bun", "run", "start"]
