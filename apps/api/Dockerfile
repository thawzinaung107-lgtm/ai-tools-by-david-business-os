FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --filter @atd/api... --frozen-lockfile=false
COPY apps/api apps/api
COPY database database
RUN pnpm --filter @atd/api build
ENV NODE_ENV=production
EXPOSE 10000
CMD ["pnpm", "--filter", "@atd/api", "start"]
