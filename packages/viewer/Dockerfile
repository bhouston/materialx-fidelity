# syntax=docker/dockerfile:1.6
FROM --platform=linux/amd64 node:24-slim AS base

ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH" \
    NODE_ENV=production \
    PORT=8080 \
    VIEWER_RENDERERS="materialxview,blender-io-mtlx,blender-new,threejs-current,threejs-new" \
    CI=true

RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm fetch --reporter=silent

COPY . .

RUN test -d /app/third_party/material-samples/materials
RUN test -d /app/third_party/material-viewer/packages/materialx/src

RUN pnpm install --frozen-lockfile --prefer-offline

RUN pnpm --filter @material-viewer/materialx build

# Viewer bundle reads metadata env vars at build time (Vite `define`). Override via `docker build --build-arg BASE_URL=https://…`.
ARG BASE_URL=""
ARG SITE_NAME=""
ARG SITE_DESCRIPTION=""
ARG DEFAULT_SITE_IMAGE=""
ARG TWITTER_SITE=""
ENV BASE_URL=${BASE_URL} \
    SITE_NAME=${SITE_NAME} \
    SITE_DESCRIPTION=${SITE_DESCRIPTION} \
    DEFAULT_SITE_IMAGE=${DEFAULT_SITE_IMAGE} \
    TWITTER_SITE=${TWITTER_SITE}

RUN pnpm build

EXPOSE 8080

CMD ["pnpm", "--filter", "@material-fidelity/viewer", "start"]
