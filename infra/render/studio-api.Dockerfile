# syntax=docker/dockerfile:1
# Render build from the repository root (no named contexts); see .dockerignore for what is sent.
# Migrations run from the operator machine (pnpm db:migrate), never from this image's startup.
FROM node:26-alpine AS base
RUN npm i -g pnpm@9.15.9
WORKDIR /repo/apps/studio-api
COPY contracts /repo/contracts

FROM base AS deps
COPY apps/studio-api/package.json apps/studio-api/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/studio-api/tsconfig.json ./
COPY apps/studio-api/src ./src
RUN pnpm gen:api && pnpm typecheck && pnpm build

FROM build AS production-deps
RUN pnpm prune --prod

FROM node:26-alpine AS runner
# Render injects PORT; the API reads it from the environment.
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY --from=production-deps --chown=node:node /repo/apps/studio-api/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/studio-api/package.json ./
COPY --from=build --chown=node:node /repo/apps/studio-api/dist ./dist
USER node
EXPOSE 10000
CMD ["node", "dist/main.js"]
