# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=secret,id=npm_token,target=/run/secrets/npm_token,required=true \
    test -s /run/secrets/npm_token && \
    npm ci --omit=dev && \
    npm cache clean --force


FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=secret,id=npm_token,target=/run/secrets/npm_token,required=true \
    test -s /run/secrets/npm_token && \
    npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build


FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist
COPY --chown=65532:65532 package.json ./

USER 65532:65532

CMD ["dist/main.js"]