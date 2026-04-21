# syntax=docker/dockerfile:1.6
FROM --platform=linux/amd64 node:24-slim AS base

ENV PNPM_HOME="/pnpm" \
    PATH="$PNPM_HOME:$PATH" \
    NODE_ENV=production \
    PORT=8080 \
    CI=true

RUN npm install -g pnpm@10.33.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm fetch --reporter=silent

COPY . .

RUN test -d /app/third_party/materialx-samples/materials

RUN pnpm install --frozen-lockfile --prefer-offline

RUN pnpm --filter @materialx-fidelity/viewer build

EXPOSE 8080

CMD ["node", "/app/packages/viewer/dist/server/server.js"]
