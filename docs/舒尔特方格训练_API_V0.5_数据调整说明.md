# 舒尔特方格训练 API V0.5 数据调整说明

本文档记录根据 `舒尔特方格训练_design_V0.5.md` 对后端 API 和数据模型做出的调整。

## 账号模型调整

V0.5 不再以邮箱作为主要登录凭证，注册成功后由服务端生成唯一注册 ID。

用户新增字段：

- `registrationId`: 注册 ID，例如 `SQT-100001`，不可修改。
- `gender`: `MALE` / `FEMALE` / `UNDISCLOSED`，默认 `UNDISCLOSED`。
- `rankStatus`: 当前固定为 `UNRANKED`。
- `rankDisplayName`: 当前固定为 `未定级`。
- `rankPoints`: 当前为 `null`。
- `winRateText`: 当前固定为 `暂无对战数据`。
- `matchTotal`、`matchWin`、`matchLoss`、`matchDraw`: 当前均为 `0`。

注册接口：

```http
POST /api/v1/auth/register
```

请求字段：

```json
{
  "nickname": "小明",
  "password": "StrongPassword123",
  "gender": "MALE",
  "acceptedTerms": true
}
```

登录接口：

```http
POST /api/v1/auth/login
```

请求字段：

```json
{
  "registrationId": "SQT-100001",
  "password": "StrongPassword123"
}
```

## 游客记录与账号归属

V0.5 要求未登录用户仍可训练并查看本地记录，因此训练记录新增归属概念：

- `ownerType`: `GUEST` / `USER`
- `guestId`: 游客设备 ID，游客记录使用。
- `userId`: 登录账号 ID，账号记录使用。

游客创建训练记录：

```http
POST /api/v1/guest/training-records
```

登录后关联游客记录：

```http
POST /api/v1/me/training-records:associateGuest
```

关联后，游客记录会转为当前用户记录，并重新计算同条件下的：

- `previousRecordId`
- `isPersonalBest`
- `improvementStatus`
- `timeDeltaMillis`
- `errorDelta`

## 个人中心与 PK 占位

个人中心聚合接口：

```http
GET /api/v1/me/profile
```

返回账号资料、训练统计和竞技资料占位。

PK 状态接口：

```http
GET /api/v1/me/pk-status
```

当前固定返回 `available: false`，用于展示「线上 PK 即将上线」。后端不返回虚假排行榜、虚假对手、虚假段位或虚假胜率。

## 当前未实现

- 真实线上 PK。
- 好友邀请。
- 排行榜。
- 段位积分计算。
- 胜率计算。
- 第三方登录。
- 手机号验证码登录。

这些能力只保留数据展示结构和入口状态，不参与当前训练记录计算。
