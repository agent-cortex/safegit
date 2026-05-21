FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache git
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/only-pnpm.js ./scripts/only-pnpm.js
RUN pnpm install --prod --frozen-lockfile
COPY . .
EXPOSE 8787
CMD ["node", "bin/safegit-server.js"]
