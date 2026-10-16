# syntax=docker/dockerfile:1
# Build context: apps/web. Contracts are supplied via the named context "contracts"
# (compose: build.additional_contexts.contracts = ./contracts).
FROM node:22-alpine AS base
ARG http_proxy
ARG https_proxy
# corepack cannot download pnpm through the proxy; install it directly.
RUN npm i -g pnpm@9.15.9
WORKDIR /repo/apps/web
COPY --from=contracts . /repo/contracts

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts=false

FROM deps AS build
COPY . .
RUN pnpm gen:api && pnpm build

# Product migration CLI: full source + tsx + SQL migrations. Run explicitly, never on startup.
FROM deps AS migration
COPY . .
ENV NODE_ENV=production
USER node
CMD ["pnpm", "db:migrate"]

FROM node:22-alpine AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
