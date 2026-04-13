FROM oven/bun:1.3.11-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY protocol/package.json protocol/package.json
RUN bun install --frozen-lockfile

COPY web web
COPY protocol protocol
RUN cd web && bun run build

FROM nginx:1.27-alpine
ENV CONVEX_API_UPSTREAM=http://convex-backend:3210 \
    CONVEX_ACTIONS_UPSTREAM=http://convex-backend:3211/ \
    PROMETHEUS_UPSTREAM=http://prometheus:9090/ \
    UNIVERSAL_LINKS_APP_ID=TEAMID.com.example.cowtail \
    NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx

COPY web/nginx.conf /etc/nginx/templates/nginx.conf.template
COPY web/docker-entrypoint.d/40-render-public-files.sh /docker-entrypoint.d/40-render-public-files.sh
COPY web/templates/apple-app-site-association.template /opt/cowtail/templates/apple-app-site-association.template
COPY --from=build /app/web/dist /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-render-public-files.sh \
    && mkdir -p /usr/share/nginx/html/.well-known
EXPOSE 80
