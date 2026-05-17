FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY scripts/only-pnpm.js ./scripts/only-pnpm.js
RUN pnpm install --prod --frozen-lockfile
COPY . .
EXPOSE 8787
CMD ["node", "bin/safegit-server.js"]
