FROM node:20-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

COPY lib/db ./lib/db
COPY artifacts/discord-bot ./artifacts/discord-bot

RUN pnpm install --filter "@workspace/discord-bot..." --frozen-lockfile

CMD ["sh", "-c", "pnpm --filter @workspace/db run push && pnpm --filter @workspace/discord-bot run start"]
