# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app


FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/tsconfig.build.json packages/contracts/
COPY apps/api/package.json apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/

RUN pnpm install --frozen-lockfile --filter @dataroom/api...

COPY packages/contracts packages/contracts
COPY apps/api apps/api

RUN pnpm --filter @dataroom/contracts build \
    && pnpm --filter @dataroom/api build


FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --prod --filter @dataroom/api...


FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=production-dependencies /app/packages/contracts ./packages/contracts
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

WORKDIR /app/apps/api

USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
