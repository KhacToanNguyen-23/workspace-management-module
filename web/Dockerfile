FROM node:20-alpine AS build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
RUN npm ci

COPY web ./web
WORKDIR /workspace/web

ARG VITE_AUTH_MODE=dev
ARG VITE_API_BASE=
ARG VITE_ORG_DOMAIN=hyperdatalab.org
ARG VITE_FIREBASE_API_KEY=
ARG VITE_FIREBASE_AUTH_DOMAIN=
ARG VITE_FIREBASE_PROJECT_ID=
ARG VITE_FIREBASE_APP_ID=
ENV VITE_AUTH_MODE=${VITE_AUTH_MODE} \
    VITE_API_BASE=${VITE_API_BASE} \
    VITE_ORG_DOMAIN=${VITE_ORG_DOMAIN} \
    VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY} \
    VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN} \
    VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID} \
    VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID}
RUN npm run build

FROM nginx:stable-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/web/dist /usr/share/nginx/html
EXPOSE 80
