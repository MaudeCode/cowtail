FROM node:22-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN npm install --frozen-lockfile
COPY . .
RUN npx tsc -b && npx vite build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
