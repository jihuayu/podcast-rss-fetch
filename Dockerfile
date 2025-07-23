# 基于官方Node镜像
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

COPY package.json pnpm-lock.yaml* tsconfig.json ./

# 安装依赖
RUN corepack enable && pnpm install --frozen-lockfile

# 拷贝源码
COPY src ./src
COPY drizzle.config.ts ./
COPY src/db/schema ./src/db/schema
COPY .env.example ./


# 构建TypeScript
RUN pnpm run build

# 生产镜像
FROM node:20-alpine AS runner
WORKDIR /app


# 只拷贝生产依赖和编译产物
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env.example ./
COPY --from=builder /app/drizzle.config.ts ./

# 启动命令
CMD ["node", "dist/main.js"]
