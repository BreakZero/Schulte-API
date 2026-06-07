# SchulteApi

SchulteApi 是 [BreakZero/Schulte](https://github.com/BreakZero/Schulte) 项目的服务端实现，主要为舒尔特方格训练应用提供 RESTful API，支持线上数据管理、账号数据同步和训练记录管理。

## 项目说明

本仓库提供 Schulte 客户端所需的后端接口能力，当前重点包括：

- 用户注册、登录、刷新 Token、退出登录
- 用户资料读取与更新
- 训练记录创建、查询、批量同步与清理
- 游客训练记录保存、查询与账号关联
- 训练汇总数据统计
- 线上 PK 状态与用户竞赛资料预留接口

服务默认使用本地 JSON 文件作为数据存储，适合当前项目的轻量化部署与接口验证。

## 技术栈

- Runtime: Node.js 20+
- Module: ESM
- API: HTTP RESTful API
- Test: Node.js built-in test runner
- Data Store: local JSON file

## 快速开始

安装依赖：

```bash
npm install
```

启动开发服务：

```bash
npm run dev
```

服务默认监听：

```text
http://127.0.0.1:8080/api/v1
```

## 环境变量

可参考 `.env.example`：

```text
PORT=8080
DATA_FILE=data/store.json
```

说明：

- `PORT`: API 服务监听端口
- `DATA_FILE`: 本地数据文件路径

## 常用命令

```bash
npm run dev
npm run start
npm run build
npm test
```

## API 概览

所有接口默认以 `/api/v1` 为前缀。

认证相关：

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/logout-all`

当前用户：

- `GET /me`
- `GET /me/profile`
- `PATCH /me`
- `POST /me/password`
- `DELETE /me`
- `GET /me/sessions`
- `DELETE /me/sessions/:sessionId`

训练记录：

- `POST /me/training-records`
- `POST /me/training-records:batchCreate`
- `GET /me/training-records`
- `GET /me/training-records/:recordId`
- `DELETE /me/training-records`
- `POST /me/training-records:associateGuest`
- `GET /me/training-summary`

游客数据：

- `POST /guest/training-records`
- `GET /guest/training-records`
- `GET /guest/training-summary`

线上 PK：

- `GET /me/pk-status`

更详细的接口设计与数据结构说明可查看 `docs/` 目录。

## 数据与部署

默认数据文件为 `data/store.json`。部署时可以通过 `DATA_FILE` 指定实际数据文件路径，并确保运行进程拥有该文件所在目录的读写权限。

构建发布包：

```bash
npm run package:release
```
