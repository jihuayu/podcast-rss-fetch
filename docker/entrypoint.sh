#!/bin/sh
# entrypoint.sh: 自动完成数据库迁移并启动应用
set -e

# 运行数据库迁移
pnpm db:migrate

# 启用主应用
node dist/main.js
