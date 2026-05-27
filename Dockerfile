FROM node:22-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate && pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm db:seed && pnpm start"]
