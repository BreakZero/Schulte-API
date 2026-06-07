# 舒尔特方格训练 RESTful API 用户管理设计 V0.1

> 适用范围：为舒尔特训练项目提供用户管理、认证授权、用户资料、设备会话、训练记录归属能力。  
> 暂不包含：排行榜、线上 PK、好友关系、社区分享、公开个人主页。  
> 设计原则：移动端优先、低打扰登录、隐私最小化、训练记录可从本地逐步同步到云端。

---

## 1. 目标与边界

### 1.1 目标

1. 支持用户注册、登录、退出和 Token 刷新。
2. 支持用户查看和更新基础资料。
3. 支持训练记录与用户账号绑定，为后续云同步和多设备使用预留能力。
4. 支持设备级会话管理，便于用户退出当前设备或全部设备。
5. 支持基础账号安全能力，例如修改密码、注销账号。

### 1.2 不做范围

1. 不提供排行榜接口。
2. 不提供线上 PK、匹配、房间、战绩接口。
3. 不提供用户之间的关注、好友、私信能力。
4. 不公开用户训练数据。
5. 不提供医学诊断、治疗或注意力评估结论。

---

## 2. API 基础约定

### 2.1 Base URL

```text
https://api.example.com/api/v1
```

本地开发可使用：

```text
http://localhost:8080/api/v1
```

### 2.2 数据格式

请求和响应均使用 JSON。

```http
Content-Type: application/json
Accept: application/json
```

### 2.3 认证方式

登录后客户端保存：

1. `accessToken`：短有效期，例如 2 小时。
2. `refreshToken`：长有效期，例如 30 天。

需要登录的接口使用：

```http
Authorization: Bearer <accessToken>
```

### 2.4 通用响应结构

成功响应：

```json
{
  "data": {},
  "requestId": "req_20260606153000123"
}
```

失败响应：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数不合法",
    "details": [
      {
        "field": "email",
        "reason": "邮箱格式不正确"
      }
    ]
  },
  "requestId": "req_20260606153000123"
}
```

### 2.5 时间与 ID

1. 时间字段统一使用 ISO 8601 UTC 字符串，例如 `2026-06-06T07:30:00Z`。
2. 客户端训练完成时间如需保留本地时间，可额外上传 `clientCreatedAt`。
3. 服务端资源 ID 使用不可枚举字符串，例如 `usr_...`、`rec_...`、`ses_...`。

---

## 3. 核心资源模型

### 3.1 User

```json
{
  "id": "usr_01J...",
  "email": "user@example.com",
  "nickname": "小明",
  "avatarUrl": null,
  "status": "ACTIVE",
  "createdAt": "2026-06-06T07:30:00Z",
  "updatedAt": "2026-06-06T07:30:00Z"
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 用户唯一 ID |
| email | string | 登录邮箱，唯一 |
| nickname | string | 昵称，默认可由系统生成 |
| avatarUrl | string? | 头像 URL，当前可为空 |
| status | string | `ACTIVE` / `DISABLED` / `DELETED` |
| createdAt | string | 创建时间 |
| updatedAt | string | 更新时间 |

### 3.2 Session

```json
{
  "id": "ses_01J...",
  "deviceName": "iPhone 15",
  "platform": "IOS",
  "lastActiveAt": "2026-06-06T07:30:00Z",
  "createdAt": "2026-06-01T12:00:00Z"
}
```

### 3.3 TrainingRecord

与 V0.4 训练记录需求保持一致，云端增加用户归属字段。

```json
{
  "id": "rec_01J...",
  "userId": "usr_01J...",
  "clientRecordId": "local_8f2a",
  "createdAt": "2026-06-06T07:30:00Z",
  "clientCreatedAt": "2026-06-06T15:30:00+08:00",
  "gridSize": 5,
  "ageGroup": "ADULT",
  "trainingMode": "STANDARD",
  "elapsedTimeMillis": 18420,
  "errorCount": 1,
  "scoreLevel": "GOOD",
  "isPersonalBest": true,
  "previousRecordId": "rec_01J...",
  "improvementStatus": "PERSONAL_BEST",
  "timeDeltaMillis": -1260,
  "errorDelta": 0
}
```

---

## 4. 枚举定义

### 4.1 AgeGroup

```text
CHILD
TEEN
ADULT
SENIOR
```

如客户端已有更细分年龄段，应以产品配置为准，服务端只校验枚举合法性。

### 4.2 TrainingMode

```text
STANDARD
ASSISTED
```

标准模式和辅助模式必须分开统计。

### 4.3 ScoreLevel

```text
EXCELLENT
GOOD
NORMAL
NEEDS_PRACTICE
```

### 4.4 ImprovementStatus

```text
FIRST_RECORD
IMPROVED_SPEED
IMPROVED_ACCURACY
PERSONAL_BEST
STABLE
MIXED
DECLINED
```

---

## 5. 认证与账号接口

### 5.1 注册

```http
POST /auth/register
```

请求：

```json
{
  "email": "user@example.com",
  "password": "StrongPassword123",
  "nickname": "小明",
  "device": {
    "deviceName": "iPhone 15",
    "platform": "IOS"
  }
}
```

响应 `201 Created`：

```json
{
  "data": {
    "user": {
      "id": "usr_01J...",
      "email": "user@example.com",
      "nickname": "小明",
      "avatarUrl": null,
      "status": "ACTIVE",
      "createdAt": "2026-06-06T07:30:00Z",
      "updatedAt": "2026-06-06T07:30:00Z"
    },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresIn": 7200
  },
  "requestId": "req_..."
}
```

规则：

1. `email` 必须唯一。
2. 密码最少 8 位，建议包含字母和数字。
3. 注册成功后自动登录并创建当前设备会话。

### 5.2 登录

```http
POST /auth/login
```

请求：

```json
{
  "email": "user@example.com",
  "password": "StrongPassword123",
  "device": {
    "deviceName": "iPhone 15",
    "platform": "IOS"
  }
}
```

响应 `200 OK`：同注册响应。

### 5.3 刷新 Token

```http
POST /auth/refresh
```

请求：

```json
{
  "refreshToken": "eyJ..."
}
```

响应：

```json
{
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresIn": 7200
  },
  "requestId": "req_..."
}
```

规则：

1. 刷新成功后轮换 refresh token。
2. 旧 refresh token 立即失效。
3. 异常刷新行为应使对应会话失效。

### 5.4 退出当前设备

```http
POST /auth/logout
Authorization: Bearer <accessToken>
```

请求：

```json
{
  "refreshToken": "eyJ..."
}
```

响应：

```http
204 No Content
```

### 5.5 退出全部设备

```http
POST /auth/logout-all
Authorization: Bearer <accessToken>
```

响应：

```http
204 No Content
```

---

## 6. 用户资料接口

### 6.1 获取当前用户

```http
GET /me
Authorization: Bearer <accessToken>
```

响应：

```json
{
  "data": {
    "id": "usr_01J...",
    "email": "user@example.com",
    "nickname": "小明",
    "avatarUrl": null,
    "status": "ACTIVE",
    "createdAt": "2026-06-06T07:30:00Z",
    "updatedAt": "2026-06-06T07:30:00Z"
  },
  "requestId": "req_..."
}
```

### 6.2 更新当前用户资料

```http
PATCH /me
Authorization: Bearer <accessToken>
```

请求：

```json
{
  "nickname": "新的昵称",
  "avatarUrl": "https://cdn.example.com/avatar/usr_01J.png"
}
```

响应：

```json
{
  "data": {
    "id": "usr_01J...",
    "email": "user@example.com",
    "nickname": "新的昵称",
    "avatarUrl": "https://cdn.example.com/avatar/usr_01J.png",
    "status": "ACTIVE",
    "createdAt": "2026-06-06T07:30:00Z",
    "updatedAt": "2026-06-06T08:00:00Z"
  },
  "requestId": "req_..."
}
```

规则：

1. 昵称长度建议 1 到 20 个字符。
2. 不允许通过该接口修改邮箱、状态或密码。

### 6.3 修改密码

```http
POST /me/password
Authorization: Bearer <accessToken>
```

请求：

```json
{
  "oldPassword": "OldPassword123",
  "newPassword": "NewPassword123"
}
```

响应：

```http
204 No Content
```

规则：

1. 修改成功后建议使其他设备会话失效。
2. 当前设备可继续登录，也可要求客户端重新登录，由产品安全策略决定。

### 6.4 注销账号

```http
DELETE /me
Authorization: Bearer <accessToken>
```

请求：

```json
{
  "password": "StrongPassword123",
  "confirm": "DELETE_MY_ACCOUNT"
}
```

响应：

```http
202 Accepted
```

规则：

1. 账号进入软删除状态 `DELETED`。
2. Access token 和 refresh token 全部失效。
3. 训练记录默认保留 7 到 30 天用于撤销期，之后异步物理删除或匿名化。
4. 注销策略必须在隐私政策中说明。

---

## 7. 会话与设备接口

### 7.1 获取当前登录设备列表

```http
GET /me/sessions
Authorization: Bearer <accessToken>
```

响应：

```json
{
  "data": {
    "items": [
      {
        "id": "ses_01J...",
        "deviceName": "iPhone 15",
        "platform": "IOS",
        "lastActiveAt": "2026-06-06T07:30:00Z",
        "createdAt": "2026-06-01T12:00:00Z"
      }
    ]
  },
  "requestId": "req_..."
}
```

### 7.2 删除指定会话

```http
DELETE /me/sessions/{sessionId}
Authorization: Bearer <accessToken>
```

响应：

```http
204 No Content
```

规则：

1. 只能删除当前用户自己的会话。
2. 删除后对应设备的 refresh token 立即失效。

---

## 8. 训练记录接口

训练记录接口用于登录用户的云端记录归属和同步。客户端仍可保留本地优先策略：未登录时只写本地，登录后再按需同步。

### 8.1 创建训练记录

```http
POST /me/training-records
Authorization: Bearer <accessToken>
```

请求：

```json
{
  "clientRecordId": "local_8f2a",
  "clientCreatedAt": "2026-06-06T15:30:00+08:00",
  "gridSize": 5,
  "ageGroup": "ADULT",
  "trainingMode": "STANDARD",
  "elapsedTimeMillis": 18420,
  "errorCount": 1,
  "scoreLevel": "GOOD"
}
```

响应 `201 Created`：

```json
{
  "data": {
    "id": "rec_01J...",
    "userId": "usr_01J...",
    "clientRecordId": "local_8f2a",
    "createdAt": "2026-06-06T07:30:00Z",
    "clientCreatedAt": "2026-06-06T15:30:00+08:00",
    "gridSize": 5,
    "ageGroup": "ADULT",
    "trainingMode": "STANDARD",
    "elapsedTimeMillis": 18420,
    "errorCount": 1,
    "scoreLevel": "GOOD",
    "isPersonalBest": true,
    "previousRecordId": null,
    "improvementStatus": "FIRST_RECORD",
    "timeDeltaMillis": null,
    "errorDelta": null
  },
  "requestId": "req_..."
}
```

规则：

1. 只允许保存完整完成训练后的记录。
2. `gridSize` 建议限制为 `3`、`4`、`5`、`7`。
3. 服务端根据同用户、同规格、同年龄段、同模式计算 `previousRecordId`、`isPersonalBest` 和 `improvementStatus`。
4. `clientRecordId` 用于幂等去重；同一用户重复提交同一 `clientRecordId` 应返回已有记录。

### 8.2 批量同步训练记录

```http
POST /me/training-records:batchCreate
Authorization: Bearer <accessToken>
```

请求：

```json
{
  "items": [
    {
      "clientRecordId": "local_8f2a",
      "clientCreatedAt": "2026-06-06T15:30:00+08:00",
      "gridSize": 5,
      "ageGroup": "ADULT",
      "trainingMode": "STANDARD",
      "elapsedTimeMillis": 18420,
      "errorCount": 1,
      "scoreLevel": "GOOD"
    }
  ]
}
```

响应：

```json
{
  "data": {
    "createdCount": 1,
    "duplicateCount": 0,
    "items": [
      {
        "clientRecordId": "local_8f2a",
        "serverRecordId": "rec_01J...",
        "status": "CREATED"
      }
    ]
  },
  "requestId": "req_..."
}
```

规则：

1. 单次批量建议最多 100 条。
2. 部分失败时返回每条记录状态，不整体回滚已成功记录。
3. 同步完成后客户端可根据 `serverRecordId` 建立本地映射。

### 8.3 查询训练记录列表

```http
GET /me/training-records?gridSize=5&trainingMode=STANDARD&range=LAST_30_DAYS&page=1&pageSize=20
Authorization: Bearer <accessToken>
```

响应：

```json
{
  "data": {
    "items": [
      {
        "id": "rec_01J...",
        "createdAt": "2026-06-06T07:30:00Z",
        "gridSize": 5,
        "ageGroup": "ADULT",
        "trainingMode": "STANDARD",
        "elapsedTimeMillis": 18420,
        "errorCount": 1,
        "scoreLevel": "GOOD",
        "isPersonalBest": true,
        "improvementStatus": "PERSONAL_BEST",
        "timeDeltaMillis": -1260,
        "errorDelta": 0
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1
  },
  "requestId": "req_..."
}
```

支持筛选：

| 参数 | 说明 |
|---|---|
| gridSize | `3` / `4` / `5` / `7` |
| ageGroup | 年龄段 |
| trainingMode | `STANDARD` / `ASSISTED` |
| range | `LAST_7_DAYS` / `LAST_30_DAYS` / `ALL` |
| page | 页码，从 1 开始 |
| pageSize | 每页数量，建议最大 100 |

### 8.4 获取训练记录详情

```http
GET /me/training-records/{recordId}
Authorization: Bearer <accessToken>
```

响应：

```json
{
  "data": {
    "id": "rec_01J...",
    "createdAt": "2026-06-06T07:30:00Z",
    "gridSize": 5,
    "ageGroup": "ADULT",
    "trainingMode": "STANDARD",
    "elapsedTimeMillis": 18420,
    "errorCount": 1,
    "scoreLevel": "GOOD",
    "isPersonalBest": true,
    "previousRecordId": "rec_01J...",
    "improvementStatus": "PERSONAL_BEST",
    "timeDeltaMillis": -1260,
    "errorDelta": 0
  },
  "requestId": "req_..."
}
```

### 8.5 获取训练统计摘要

```http
GET /me/training-summary?gridSize=5&ageGroup=ADULT&trainingMode=STANDARD
Authorization: Bearer <accessToken>
```

响应：

```json
{
  "data": {
    "totalCount": 26,
    "recent7DaysCount": 5,
    "bestRecord": {
      "id": "rec_01J...",
      "elapsedTimeMillis": 16800,
      "errorCount": 0,
      "createdAt": "2026-06-05T12:00:00Z"
    },
    "latestRecord": {
      "id": "rec_01J...",
      "elapsedTimeMillis": 18420,
      "errorCount": 1,
      "createdAt": "2026-06-06T07:30:00Z"
    },
    "recentAverageTimeMillis": 19020,
    "recentAverageErrorCount": 0.8
  },
  "requestId": "req_..."
}
```

### 8.6 清空当前用户训练记录

```http
DELETE /me/training-records
Authorization: Bearer <accessToken>
```

请求：

```json
{
  "confirm": "CLEAR_MY_TRAINING_RECORDS"
}
```

响应：

```http
202 Accepted
```

规则：

1. 该接口只清空当前用户自己的训练记录。
2. 建议软删除并异步清理。
3. 客户端必须在调用前完成二次确认。
4. 清空后统计摘要应返回无记录状态。

---

## 9. 管理端用户接口

管理端接口仅供后台运营或客服使用，必须使用管理员权限。

### 9.1 查询用户列表

```http
GET /admin/users?keyword=user@example.com&status=ACTIVE&page=1&pageSize=20
Authorization: Bearer <adminAccessToken>
```

响应：

```json
{
  "data": {
    "items": [
      {
        "id": "usr_01J...",
        "email": "user@example.com",
        "nickname": "小明",
        "status": "ACTIVE",
        "createdAt": "2026-06-06T07:30:00Z"
      }
    ],
    "page": 1,
    "pageSize": 20,
    "total": 1
  },
  "requestId": "req_..."
}
```

### 9.2 获取用户详情

```http
GET /admin/users/{userId}
Authorization: Bearer <adminAccessToken>
```

响应应包含账号状态、注册时间、最近登录时间和训练记录数量，但不返回密码哈希、refresh token 等敏感信息。

### 9.3 禁用或恢复用户

```http
PATCH /admin/users/{userId}/status
Authorization: Bearer <adminAccessToken>
```

请求：

```json
{
  "status": "DISABLED",
  "reason": "违反服务条款"
}
```

响应：

```http
204 No Content
```

规则：

1. 禁用用户后，其所有会话立即失效。
2. 管理操作必须写入审计日志。

---

## 10. 进步计算规则

服务端保存训练记录时，按以下条件查找上一条记录和最佳记录：

```text
userId + gridSize + ageGroup + trainingMode
```

判断规则：

1. 没有上一条同条件记录：`FIRST_RECORD`。
2. 快于历史最佳：`PERSONAL_BEST`。
3. 时间有效减少且错误不增加：`IMPROVED_SPEED`。
4. 时间变化小但错误减少：`IMPROVED_ACCURACY`。
5. 时间减少但错误增加：`MIXED`。
6. 时间和错误变化均较小：`STABLE`。
7. 时间增加且错误增加：`DECLINED`。

最小有效时间变化阈值：

```text
max(300ms, previousElapsedTimeMillis * 1%)
```

---

## 11. 错误码

| HTTP 状态 | code | 说明 |
|---:|---|---|
| 400 | VALIDATION_ERROR | 请求参数不合法 |
| 401 | UNAUTHORIZED | 未登录或 Token 无效 |
| 403 | FORBIDDEN | 无权限访问 |
| 404 | NOT_FOUND | 资源不存在 |
| 409 | EMAIL_ALREADY_EXISTS | 邮箱已注册 |
| 409 | DUPLICATE_CLIENT_RECORD | 本地记录已同步 |
| 429 | RATE_LIMITED | 请求过于频繁 |
| 500 | INTERNAL_ERROR | 服务端错误 |

---

## 12. 数据库表建议

### 12.1 users

| 字段 | 说明 |
|---|---|
| id | 用户 ID |
| email | 邮箱，唯一索引 |
| password_hash | 密码哈希 |
| nickname | 昵称 |
| avatar_url | 头像 URL |
| status | 用户状态 |
| created_at | 创建时间 |
| updated_at | 更新时间 |
| deleted_at | 注销时间 |

### 12.2 user_sessions

| 字段 | 说明 |
|---|---|
| id | 会话 ID |
| user_id | 用户 ID |
| refresh_token_hash | refresh token 哈希 |
| device_name | 设备名称 |
| platform | 平台 |
| last_active_at | 最近活跃时间 |
| created_at | 创建时间 |
| revoked_at | 失效时间 |

### 12.3 training_records

| 字段 | 说明 |
|---|---|
| id | 记录 ID |
| user_id | 用户 ID |
| client_record_id | 客户端本地记录 ID |
| created_at | 服务端创建时间 |
| client_created_at | 客户端训练完成时间 |
| grid_size | 方格规格 |
| age_group | 年龄段 |
| training_mode | 训练模式 |
| elapsed_time_millis | 完成耗时 |
| error_count | 错误次数 |
| score_level | 成绩等级 |
| is_personal_best | 是否个人最佳 |
| previous_record_id | 上一条同条件记录 |
| improvement_status | 进步状态 |
| time_delta_millis | 时间差 |
| error_delta | 错误数差 |
| deleted_at | 删除时间 |

建议索引：

```sql
unique(user_id, client_record_id)
index(user_id, grid_size, age_group, training_mode, created_at)
index(user_id, created_at)
```

---

## 13. 安全与隐私要求

1. 密码必须使用 Argon2id 或 bcrypt 加盐哈希保存，不能明文存储。
2. Refresh token 只保存哈希值。
3. 登录、注册、刷新 Token 和批量同步接口需要限流。
4. 用户只能访问自己的 `/me/**` 资源。
5. 管理端接口必须有独立角色校验和审计日志。
6. 训练记录默认私有，不提供公开查询接口。
7. 删除账号和清空训练记录必须支持审计和异步清理。

---

## 14. 推荐开发顺序

1. 实现用户注册、登录、刷新 Token、退出登录。
2. 实现 `/me` 用户资料读取和更新。
3. 实现训练记录创建、列表、统计摘要。
4. 实现本地记录批量同步和幂等去重。
5. 实现会话列表、删除会话、退出全部设备。
6. 实现账号注销、清空训练记录。
7. 最后补充管理端用户查询和禁用能力。

---

## 15. 验收标准

1. 用户可以注册、登录、刷新 Token、退出登录。
2. 未登录用户访问 `/me/**` 返回 `401`。
3. 用户只能查看和修改自己的资料、会话和训练记录。
4. 同一条本地训练记录重复同步不会产生重复云端数据。
5. 同规格、同年龄段、同训练模式下能正确计算上一条记录、个人最佳和进步状态。
6. 清空训练记录后，列表为空，统计摘要进入无记录状态。
7. 禁用用户后，该用户所有 Token 失效。
8. API 不返回排行榜、线上 PK 或其他用户的训练数据。
