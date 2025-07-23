# Podcast RSS Fetch - TypeScript Version

TypeScript版本的播客RSS抓取器，使用Drizzle ORM和MinIO存储。

## 功能特性

- 从RSS feed抓取播客信息和节目
- 支持OPML文件导入
- 下载音频文件到MinIO存储
- 使用Drizzle ORM进行数据库操作
- TypeScript编写，类型安全
- 支持多种音频格式 (MP3, M4A, WAV, FLAC, OGG)

## 技术栈

- **Runtime**: Node.js
- **Language**: TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Storage**: MinIO (S3-compatible)
- **RSS Parsing**: rss-parser
- **OPML Parsing**: fast-xml-parser
- **CLI**: Commander.js
- **Logging**: Winston

## 安装和设置

### 1. 安装依赖

```bash
cd ts
npm install
```

### 2. 环境配置

复制环境配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置数据库和MinIO连接信息。

### 3. 数据库设置

确保PostgreSQL运行，然后运行数据库迁移：

```bash
npm run db:generate
npm run db:migrate
```

### 4. 构建项目

```bash
npm run build
```

## 使用方法

### RSS抓取模式 (默认)

```bash
npm start
```

从以下文件中读取RSS链接并抓取：
- `fedd.txt` - 每行一个RSS URL
- `feed.xml` - OPML格式文件
- `feed.opml`, `podcasts.opml`, `subscriptions.opml` - 其他OPML文件

### 下载模式

```bash
npm start -- --download
```

下载所有未下载的音频文件到MinIO存储。

### 开发模式

```bash
npm run dev
```

使用tsx直接运行TypeScript代码。

## 数据库结构

### tenants 表
- 多租户支持，默认创建一个默认租户

### podcasts 表
- 播客基本信息
- RSS URL
- 分类、作者等元数据

### episodes 表
- 节目详细信息
- 下载状态
- MinIO存储路径

## 文件格式支持

### RSS文件格式
- `fedd.txt`: 纯文本文件，每行一个RSS URL
- 支持 `#` 开头的注释行

### OPML文件格式
支持标准OPML格式，自动解析嵌套的outline结构。

## 配置选项

所有配置通过环境变量设置：

| 变量名 | 默认值 | 描述 |
|--------|--------|------|
| DB_HOST | localhost | 数据库主机 |
| DB_PORT | 5432 | 数据库端口 |
| DB_USER | postgres | 数据库用户名 |
| DB_PASSWORD | password | 数据库密码 |
| DB_NAME | podcast_db | 数据库名 |
| MINIO_ENDPOINT | localhost:9000 | MinIO端点 |
| MINIO_ACCESS_KEY | minioadmin | MinIO访问密钥 |
| MINIO_SECRET_KEY | minioadmin | MinIO秘密密钥 |
| MINIO_USE_SSL | false | 是否使用SSL |
| MINIO_BUCKET | podcasts | 存储桶名称 |
| LOG_LEVEL | info | 日志级别 |

## 开发

### 项目结构

```
src/
├── config/          # 配置管理
├── db/              # 数据库相关
│   └── schema/      # Drizzle schema定义
├── services/        # 业务逻辑服务
├── utils/           # 工具函数
└── main.ts          # 主程序入口
```

### 添加新功能

1. 在相应的服务类中添加方法
2. 更新数据库schema（如需要）
3. 运行 `npm run db:generate` 生成迁移
4. 测试功能

## 日志

日志文件：
- `error.log` - 错误日志
- `combined.log` - 所有日志
- 开发环境同时输出到控制台

## 故障排除

### 常见问题

1. **数据库连接失败**
   - 检查PostgreSQL是否运行
   - 验证数据库连接配置

2. **MinIO连接失败**
   - 检查MinIO服务是否运行
   - 验证访问凭据

3. **下载失败**
   - 检查网络连接
   - 验证RSS URL是否有效

### 调试

设置环境变量启用详细日志：

```bash
LOG_LEVEL=debug npm start
```

## 许可证

MIT
