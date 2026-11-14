# ---------- Сборка ----------
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm install
RUN npm run build

# ---------- Раздача ----------
FROM nginx:alpine AS runtime

COPY --from=build /app/build /usr/share/nginx/html
# Конфиг собирается из шаблона: entrypoint подставляет KODIK_TOKEN через envsubst
# (подставляются только переменные окружения, $uri/$host остаются переменными nginx).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80
