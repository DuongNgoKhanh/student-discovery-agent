# syntax=docker/dockerfile:1
FROM node:26-alpine AS base
ARG http_proxy
ARG https_proxy
RUN npm i -g pnpm@9.15.9
WORKDIR /repo/apps/studio-api
COPY --from=contracts . /repo/contracts

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm gen:api && pnpm typecheck && pnpm build

FROM deps AS migration
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
ENV NODE_ENV=production
USER node
CMD ["pnpm", "db:migrate"]

FROM build AS production-deps
RUN pnpm prune --prod

FROM node:26-alpine AS runner
ENV NODE_ENV=production PORT=3001
WORKDIR /app
COPY --from=production-deps --chown=node:node /repo/apps/studio-api/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/studio-api/package.json ./
COPY --from=build --chown=node:node /repo/apps/studio-api/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
