import { execFileSync } from "node:child_process";
import pg from "pg";
import { ApiError } from "./errors.js";
import { Genders, calculateImprovement, utcNow } from "./domain.js";
import { hashPassword, hashToken, makeToken, verifyPassword } from "./security.js";
import { InMemoryStore } from "./store.js";

const { Pool } = pg;

export class DsqlStore extends InMemoryStore {
  constructor(config) {
    super();
    this.config = config;
    this.pool = new Pool({
      host: config.host,
      port: config.port || 5432,
      database: config.database || "postgres",
      user: config.user || "admin",
      password: () => this.password(),
      ssl: { rejectUnauthorized: true },
      max: Number(config.poolSize || 5)
    });
  }

  async init() {
    await this.pool.query(schemaSql);
    for (const sql of indexSql) {
      await this.pool.query(sql);
    }
  }

  async close() {
    await this.pool.end();
  }

  password() {
    if (this.config.password) return this.config.password;
    if (!this.config.region) {
      throw new Error("AWS_REGION is required when DSQL_PASSWORD is not set");
    }
    const args = [
      "dsql",
      "generate-db-connect-admin-auth-token",
      "--region",
      this.config.region,
      "--expires-in",
      String(this.config.tokenExpiresIn || 3600),
      "--hostname",
      this.config.host
    ];
    if (this.config.profile) args.push("--profile", this.config.profile);
    try {
      return execFileSync("aws", args, { encoding: "utf8" }).trim();
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("AWS CLI is required to generate Aurora DSQL auth tokens. Install AWS CLI or set DSQL_PASSWORD.");
      }
      throw error;
    }
  }

  async register({ email, password, nickname, gender = "UNDISCLOSED", acceptedTerms, device }) {
    this.validateRegistration({ nickname, password, gender, acceptedTerms });

    const existingEmail = email ? await this.userByEmail(email) : null;
    if (existingEmail) throw new ApiError(409, "CONFLICT", "邮箱已被注册");

    const now = utcNow();
    const user = {
      id: await this.nextId("usr"),
      registrationId: await this.nextRegistrationId(),
      email: email ? String(email).toLowerCase() : null,
      passwordHash: hashPassword(password),
      nickname: String(nickname).trim(),
      gender,
      avatarUrl: null,
      status: "ACTIVE",
      rankStatus: "UNRANKED",
      rankDisplayName: "未定级",
      rankPoints: null,
      winRateText: "暂无对战数据",
      matchTotal: 0,
      matchWin: 0,
      matchLoss: 0,
      matchDraw: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };

    await this.query(
      `INSERT INTO users (
        id, registration_id, email, password_hash, nickname, gender, avatar_url, status,
        rank_status, rank_display_name, rank_points, win_rate_text, match_total,
        match_win, match_loss, match_draw, created_at, updated_at, deleted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19
      )`,
      [
        user.id,
        user.registrationId,
        user.email,
        user.passwordHash,
        user.nickname,
        user.gender,
        user.avatarUrl,
        user.status,
        user.rankStatus,
        user.rankDisplayName,
        user.rankPoints,
        user.winRateText,
        user.matchTotal,
        user.matchWin,
        user.matchLoss,
        user.matchDraw,
        user.createdAt,
        user.updatedAt,
        user.deletedAt
      ]
    );

    return this.issueTokens(user, device);
  }

  async login({ registrationId, email, password, device }) {
    const user = registrationId ? await this.userByRegistrationId(registrationId) : await this.userByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new ApiError(401, "UNAUTHORIZED", "注册 ID 或密码不正确");
    }
    if (user.status !== "ACTIVE") {
      throw new ApiError(403, "FORBIDDEN", "账号不可用");
    }
    return this.issueTokens(user, device);
  }

  async refresh(refreshToken) {
    const refreshTokenHash = hashToken(refreshToken || "");
    const session = await this.one("SELECT * FROM user_sessions WHERE refresh_token_hash = $1", [refreshTokenHash], sessionFromRow);
    if (!session || session.revokedAt) throw new ApiError(401, "UNAUTHORIZED", "Refresh token 无效");

    const user = await this.userById(session.userId);
    if (!user || user.status !== "ACTIVE") throw new ApiError(401, "UNAUTHORIZED", "账号不可用");

    const accessToken = makeToken("acc");
    const newRefreshToken = makeToken("ref");
    const newRefreshTokenHash = hashToken(newRefreshToken);
    const now = utcNow();
    await this.query(
      "UPDATE user_sessions SET refresh_token_hash = $1, last_active_at = $2 WHERE id = $3",
      [newRefreshTokenHash, now, session.id]
    );
    await this.query("INSERT INTO access_tokens (token, user_id, created_at) VALUES ($1, $2, $3)", [accessToken, user.id, now]);
    return { accessToken, refreshToken: newRefreshToken, expiresIn: 7200 };
  }

  async requireUser(authorization) {
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError(401, "UNAUTHORIZED", "缺少访问令牌");
    }

    const token = authorization.slice("Bearer ".length);
    const user = await this.one(
      `SELECT u.*
       FROM access_tokens at
       JOIN users u ON u.id = at.user_id
       WHERE at.token = $1`,
      [token],
      userFromRow
    );
    if (!user || user.status !== "ACTIVE") {
      throw new ApiError(401, "UNAUTHORIZED", "访问令牌无效");
    }
    return { user, accessToken: token };
  }

  async logout(accessToken, refreshToken) {
    if (accessToken) await this.query("DELETE FROM access_tokens WHERE token = $1", [accessToken]);
    if (refreshToken) {
      await this.query("UPDATE user_sessions SET revoked_at = $1 WHERE refresh_token_hash = $2", [utcNow(), hashToken(refreshToken)]);
    }
  }

  async logoutAll(userId) {
    const now = utcNow();
    await this.query("DELETE FROM access_tokens WHERE user_id = $1", [userId]);
    await this.query("UPDATE user_sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL", [now, userId]);
  }

  async updateUser(userId, payload) {
    const user = await this.userById(userId);
    if (!user) throw new ApiError(404, "NOT_FOUND", "用户不存在");

    if (payload.nickname !== undefined) {
      const nickname = String(payload.nickname).trim();
      if (nickname.length < 1 || nickname.length > 20) {
        throw new ApiError(400, "VALIDATION_ERROR", "昵称长度必须为 1 到 20 个字符");
      }
      user.nickname = nickname;
    }
    if (payload.avatarUrl !== undefined) user.avatarUrl = payload.avatarUrl;
    if (payload.gender !== undefined) {
      if (!Genders.has(payload.gender)) {
        throw new ApiError(400, "VALIDATION_ERROR", "性别枚举值不合法");
      }
      user.gender = payload.gender;
    }
    user.updatedAt = utcNow();

    await this.query("UPDATE users SET nickname = $1, avatar_url = $2, gender = $3, updated_at = $4 WHERE id = $5", [
      user.nickname,
      user.avatarUrl,
      user.gender,
      user.updatedAt,
      user.id
    ]);
    return this.publicUser(user);
  }

  async changePassword(userId, payload) {
    const user = await this.userById(userId);
    if (!verifyPassword(payload.oldPassword, user.passwordHash)) {
      throw new ApiError(401, "UNAUTHORIZED", "原密码不正确");
    }
    this.validatePassword(payload.newPassword);
    await this.query("UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3", [hashPassword(payload.newPassword), utcNow(), userId]);
  }

  async deleteUser(userId, payload) {
    const user = await this.userById(userId);
    if (payload.confirm !== "DELETE_MY_ACCOUNT") {
      throw new ApiError(400, "VALIDATION_ERROR", "缺少注销确认");
    }
    if (!verifyPassword(payload.password, user.passwordHash)) {
      throw new ApiError(401, "UNAUTHORIZED", "密码不正确");
    }
    const now = utcNow();
    await this.query("UPDATE users SET status = 'DELETED', deleted_at = $1, updated_at = $1 WHERE id = $2", [now, userId]);
    await this.logoutAll(userId);
  }

  async listSessions(userId) {
    const result = await this.query(
      "SELECT * FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
      [userId]
    );
    return result.rows.map(sessionFromRow).map(({ id, deviceName, platform, lastActiveAt, createdAt }) => ({
      id,
      deviceName,
      platform,
      lastActiveAt,
      createdAt
    }));
  }

  async revokeSession(userId, sessionId) {
    const result = await this.query("UPDATE user_sessions SET revoked_at = $1 WHERE id = $2 AND user_id = $3", [utcNow(), sessionId, userId]);
    if (result.rowCount === 0) throw new ApiError(404, "NOT_FOUND", "会话不存在");
  }

  async createTrainingRecord(userId, payload) {
    return this.createOwnedTrainingRecord({ ownerType: "USER", userId, guestId: null, payload });
  }

  async createGuestTrainingRecord(guestId, payload) {
    if (!guestId) throw new ApiError(400, "VALIDATION_ERROR", "缺少游客 ID");
    return this.createOwnedTrainingRecord({ ownerType: "GUEST", userId: null, guestId: String(guestId), payload });
  }

  async createOwnedTrainingRecord({ ownerType, userId, guestId, payload }) {
    this.validateTrainingRecord(payload);
    const duplicate = await this.recordByOwnerClientId(ownerType, userId, guestId, payload.clientRecordId);
    if (duplicate) return { record: duplicate, created: false };

    const previous = await this.latestRecordForOwner(ownerType, userId, guestId, payload);
    const best = await this.bestRecordForOwner(ownerType, userId, guestId, payload);
    const progress = calculateImprovement(payload, previous, best);
    const now = utcNow();
    const record = {
      id: await this.nextId("rec"),
      ownerType,
      userId,
      guestId,
      clientRecordId: String(payload.clientRecordId),
      createdAt: now,
      clientCreatedAt: payload.clientCreatedAt || now,
      gridSize: payload.gridSize,
      ageGroup: payload.ageGroup,
      trainingMode: payload.trainingMode,
      elapsedTimeMillis: payload.elapsedTimeMillis,
      errorCount: payload.errorCount,
      scoreLevel: payload.scoreLevel,
      isPersonalBest: progress.isPersonalBest,
      previousRecordId: progress.previousRecordId,
      improvementStatus: progress.improvementStatus,
      timeDeltaMillis: progress.timeDeltaMillis,
      errorDelta: progress.errorDelta,
      deletedAt: null
    };
    await this.insertRecord(record);
    return { record, created: true };
  }

  async listRecords(userId, query) {
    const { where, params } = recordFilters({ ownerType: "USER", userId, query });
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const count = await this.query(`SELECT COUNT(*)::int AS total FROM training_records WHERE ${where}`, params);
    const result = await this.query(
      `SELECT * FROM training_records WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    return { items: result.rows.map(recordFromRow).map(dsqlPublicRecord), page, pageSize, total: count.rows[0].total };
  }

  async getRecord(userId, recordId) {
    const record = await this.one(
      "SELECT * FROM training_records WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
      [recordId, userId],
      recordFromRow
    );
    if (!record) throw new ApiError(404, "NOT_FOUND", "训练记录不存在");
    return dsqlPublicRecord(record);
  }

  async trainingSummary(userId, query) {
    const records = await this.filteredRecords({ ownerType: "USER", userId, query });
    return dsqlRecordsSummary(records);
  }

  async clearRecords(userId, payload) {
    if (payload.confirm !== "CLEAR_MY_TRAINING_RECORDS") {
      throw new ApiError(400, "VALIDATION_ERROR", "缺少清空确认");
    }
    await this.query("UPDATE training_records SET deleted_at = $1 WHERE user_id = $2", [utcNow(), userId]);
  }

  async listGuestRecords(guestId, query) {
    const { where, params } = recordFilters({ ownerType: "GUEST", guestId: String(guestId), query });
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const count = await this.query(`SELECT COUNT(*)::int AS total FROM training_records WHERE ${where}`, params);
    const result = await this.query(
      `SELECT * FROM training_records WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    return { items: result.rows.map(recordFromRow).map(dsqlPublicRecord), page, pageSize, total: count.rows[0].total };
  }

  async guestTrainingSummary(guestId, query) {
    return dsqlRecordsSummary(await this.filteredRecords({ ownerType: "GUEST", guestId: String(guestId), query }));
  }

  async associateGuestRecords(userId, payload) {
    const guestId = payload.guestId;
    if (!guestId) throw new ApiError(400, "VALIDATION_ERROR", "缺少游客 ID");

    const records = await this.filteredRecords({ ownerType: "GUEST", guestId: String(guestId), query: {} });
    let associatedCount = 0;
    for (const record of records) {
      const duplicate = await this.recordByOwnerClientId("USER", userId, null, record.clientRecordId);
      if (duplicate) {
        await this.query("UPDATE training_records SET deleted_at = $1 WHERE id = $2", [utcNow(), record.id]);
      } else {
        await this.query("UPDATE training_records SET owner_type = 'USER', user_id = $1, guest_id = NULL WHERE id = $2", [userId, record.id]);
        associatedCount += 1;
      }
    }
    await this.recalculateUserProgress(userId);
    return { associatedCount, skippedDuplicateCount: records.length - associatedCount };
  }

  async issueTokens(user, device = {}) {
    const now = utcNow();
    const accessToken = makeToken("acc");
    const refreshToken = makeToken("ref");
    const session = {
      id: await this.nextId("ses"),
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      deviceName: device.deviceName || "Unknown Device",
      platform: device.platform || "UNKNOWN",
      lastActiveAt: now,
      createdAt: now,
      revokedAt: null
    };
    await this.query(
      `INSERT INTO user_sessions
       (id, user_id, refresh_token_hash, device_name, platform, last_active_at, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [session.id, session.userId, session.refreshTokenHash, session.deviceName, session.platform, session.lastActiveAt, session.createdAt, session.revokedAt]
    );
    await this.query("INSERT INTO access_tokens (token, user_id, created_at) VALUES ($1, $2, $3)", [accessToken, user.id, now]);
    return { user: this.publicUser(user), accessToken, refreshToken, expiresIn: 7200 };
  }

  async latestRecordForOwner(ownerType, userId, guestId, payload) {
    const records = await this.sameConditionRecordsForOwner(ownerType, userId, guestId, payload);
    return records[0] || null;
  }

  async bestRecordForOwner(ownerType, userId, guestId, payload) {
    const records = await this.sameConditionRecordsForOwner(ownerType, userId, guestId, payload);
    return records.length ? records.reduce((a, b) => (a.elapsedTimeMillis <= b.elapsedTimeMillis ? a : b)) : null;
  }

  async sameConditionRecordsForOwner(ownerType, userId, guestId, payload) {
    return this.filteredRecords({
      ownerType,
      userId,
      guestId,
      query: {
        gridSize: payload.gridSize,
        ageGroup: payload.ageGroup,
        trainingMode: payload.trainingMode
      }
    });
  }

  async recalculateUserProgress(userId) {
    const records = await this.filteredRecords({ ownerType: "USER", userId, query: {} });
    const groups = new Map();
    for (const record of records) {
      const key = `${record.gridSize}:${record.ageGroup}:${record.trainingMode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }

    for (const groupRecords of groups.values()) {
      groupRecords.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let best = null;
      let previous = null;
      for (const record of groupRecords) {
        const progress = calculateImprovement(record, previous, best);
        await this.query(
          `UPDATE training_records
           SET is_personal_best = $1, previous_record_id = $2, improvement_status = $3,
               time_delta_millis = $4, error_delta = $5
           WHERE id = $6`,
          [progress.isPersonalBest, progress.previousRecordId, progress.improvementStatus, progress.timeDeltaMillis, progress.errorDelta, record.id]
        );
        if (!best || record.elapsedTimeMillis < best.elapsedTimeMillis) best = record;
        previous = record;
      }
    }
  }

  async userByEmail(email) {
    return this.one("SELECT * FROM users WHERE email = $1", [String(email || "").toLowerCase()], userFromRow);
  }

  async userByRegistrationId(registrationId) {
    return this.one("SELECT * FROM users WHERE registration_id = $1", [String(registrationId || "").toUpperCase()], userFromRow);
  }

  async userById(userId) {
    return this.one("SELECT * FROM users WHERE id = $1", [userId], userFromRow);
  }

  async recordByOwnerClientId(ownerType, userId, guestId, clientRecordId) {
    const idColumn = ownerType === "GUEST" ? "guest_id" : "user_id";
    const ownerId = ownerType === "GUEST" ? guestId : userId;
    return this.one(
      `SELECT * FROM training_records WHERE owner_type = $1 AND ${idColumn} = $2 AND client_record_id = $3`,
      [ownerType, ownerId, String(clientRecordId)],
      recordFromRow
    );
  }

  async filteredRecords({ ownerType, userId, guestId, query }) {
    const { where, params } = recordFilters({ ownerType, userId, guestId, query });
    const result = await this.query(`SELECT * FROM training_records WHERE ${where} ORDER BY created_at DESC`, params);
    return result.rows.map(recordFromRow);
  }

  async insertRecord(record) {
    await this.query(
      `INSERT INTO training_records (
        id, owner_type, user_id, guest_id, client_record_id, created_at, client_created_at,
        grid_size, age_group, training_mode, elapsed_time_millis, error_count, score_level,
        is_personal_best, previous_record_id, improvement_status, time_delta_millis,
        error_delta, deleted_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19
      )`,
      [
        record.id,
        record.ownerType,
        record.userId,
        record.guestId,
        record.clientRecordId,
        record.createdAt,
        record.clientCreatedAt,
        record.gridSize,
        record.ageGroup,
        record.trainingMode,
        record.elapsedTimeMillis,
        record.errorCount,
        record.scoreLevel,
        record.isPersonalBest,
        record.previousRecordId,
        record.improvementStatus,
        record.timeDeltaMillis,
        record.errorDelta,
        record.deletedAt
      ]
    );
  }

  async nextId(prefix) {
    const next = await this.nextCounter(prefix);
    return `${prefix}_${String(next).padStart(6, "0")}`;
  }

  async nextRegistrationId() {
    const next = await this.nextCounter("registration");
    return `SQT-${String(100000 + next).padStart(6, "0")}`;
  }

  async nextCounter(name) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT value FROM store_counters WHERE name = $1", [name]);
      const next = current.rows.length ? Number(current.rows[0].value) + 1 : 1;
      if (current.rows.length) {
        await client.query("UPDATE store_counters SET value = $1 WHERE name = $2", [next, name]);
      } else {
        await client.query("INSERT INTO store_counters (name, value) VALUES ($1, $2)", [name, next]);
      }
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async one(sql, params, mapper) {
    const result = await this.query(sql, params);
    return result.rows[0] ? mapper(result.rows[0]) : null;
  }

  query(sql, params = []) {
    return this.pool.query(sql, params);
  }
}

function recordFilters({ ownerType, userId, guestId, query }) {
  const params = [ownerType];
  const clauses = ["owner_type = $1", "deleted_at IS NULL"];
  if (ownerType === "GUEST") {
    params.push(String(guestId));
    clauses.push(`guest_id = $${params.length}`);
  } else {
    params.push(userId);
    clauses.push(`user_id = $${params.length}`);
  }
  if (query.gridSize) {
    params.push(Number(query.gridSize));
    clauses.push(`grid_size = $${params.length}`);
  }
  if (query.ageGroup) {
    params.push(query.ageGroup);
    clauses.push(`age_group = $${params.length}`);
  }
  if (query.trainingMode) {
    params.push(query.trainingMode);
    clauses.push(`training_mode = $${params.length}`);
  }
  return { where: clauses.join(" AND "), params };
}

function userFromRow(row) {
  return {
    id: row.id,
    registrationId: row.registration_id,
    email: row.email,
    passwordHash: row.password_hash,
    nickname: row.nickname,
    gender: row.gender,
    avatarUrl: row.avatar_url,
    status: row.status,
    rankStatus: row.rank_status,
    rankDisplayName: row.rank_display_name,
    rankPoints: row.rank_points,
    winRateText: row.win_rate_text,
    matchTotal: row.match_total,
    matchWin: row.match_win,
    matchLoss: row.match_loss,
    matchDraw: row.match_draw,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIso(row.deleted_at)
  };
}

function sessionFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    refreshTokenHash: row.refresh_token_hash,
    deviceName: row.device_name,
    platform: row.platform,
    lastActiveAt: toIso(row.last_active_at),
    createdAt: toIso(row.created_at),
    revokedAt: toIso(row.revoked_at)
  };
}

function recordFromRow(row) {
  return {
    id: row.id,
    ownerType: row.owner_type,
    userId: row.user_id,
    guestId: row.guest_id,
    clientRecordId: row.client_record_id,
    createdAt: toIso(row.created_at),
    clientCreatedAt: toIso(row.client_created_at),
    gridSize: row.grid_size,
    ageGroup: row.age_group,
    trainingMode: row.training_mode,
    elapsedTimeMillis: row.elapsed_time_millis,
    errorCount: row.error_count,
    scoreLevel: row.score_level,
    isPersonalBest: row.is_personal_best,
    previousRecordId: row.previous_record_id,
    improvementStatus: row.improvement_status,
    timeDeltaMillis: row.time_delta_millis,
    errorDelta: row.error_delta,
    deletedAt: toIso(row.deleted_at)
  };
}

function dsqlPublicRecord(record) {
  const { deletedAt, ...safeRecord } = record;
  return safeRecord;
}

function dsqlSummaryRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    elapsedTimeMillis: record.elapsedTimeMillis,
    errorCount: record.errorCount,
    createdAt: record.createdAt
  };
}

function dsqlRecordsSummary(records) {
  const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recent = sorted.slice(0, 5);
  const best = sorted.length ? sorted.reduce((a, b) => (a.elapsedTimeMillis <= b.elapsedTimeMillis ? a : b)) : null;
  const latest = sorted[0] || null;

  return {
    totalCount: sorted.length,
    recent7DaysCount: sorted.length,
    bestRecord: dsqlSummaryRecord(best),
    latestRecord: dsqlSummaryRecord(latest),
    recentAverageTimeMillis: recent.length ? Math.floor(recent.reduce((sum, record) => sum + record.elapsedTimeMillis, 0) / recent.length) : null,
    recentAverageErrorCount: recent.length ? Number((recent.reduce((sum, record) => sum + record.errorCount, 0) / recent.length).toFixed(2)) : null
  };
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'UNDISCLOSED',
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  rank_status TEXT NOT NULL DEFAULT 'UNRANKED',
  rank_display_name TEXT NOT NULL DEFAULT '未定级',
  rank_points INTEGER,
  win_rate_text TEXT NOT NULL DEFAULT '暂无对战数据',
  match_total INTEGER NOT NULL DEFAULT 0,
  match_win INTEGER NOT NULL DEFAULT 0,
  match_loss INTEGER NOT NULL DEFAULT 0,
  match_draw INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_name TEXT NOT NULL DEFAULT 'Unknown Device',
  platform TEXT NOT NULL DEFAULT 'UNKNOWN',
  last_active_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS access_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS training_records (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  user_id TEXT,
  guest_id TEXT,
  client_record_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  client_created_at TIMESTAMPTZ NOT NULL,
  grid_size INTEGER NOT NULL,
  age_group TEXT NOT NULL,
  training_mode TEXT NOT NULL,
  elapsed_time_millis INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  score_level TEXT NOT NULL,
  is_personal_best BOOLEAN NOT NULL,
  previous_record_id TEXT,
  improvement_status TEXT NOT NULL,
  time_delta_millis INTEGER,
  error_delta INTEGER,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS store_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

const indexSql = [
  `CREATE UNIQUE INDEX ASYNC IF NOT EXISTS training_records_user_client_record_uidx
   ON training_records (owner_type, user_id, client_record_id)`,
  `CREATE UNIQUE INDEX ASYNC IF NOT EXISTS training_records_guest_client_record_uidx
   ON training_records (owner_type, guest_id, client_record_id)`,
  `CREATE INDEX ASYNC IF NOT EXISTS training_records_user_filter_idx
   ON training_records (owner_type, user_id, grid_size, age_group, training_mode, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS training_records_guest_filter_idx
   ON training_records (owner_type, guest_id, grid_size, age_group, training_mode, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS training_records_user_created_idx
   ON training_records (owner_type, user_id, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS user_sessions_user_active_idx
   ON user_sessions (user_id, revoked_at, created_at)`,
  `CREATE INDEX ASYNC IF NOT EXISTS access_tokens_user_idx
   ON access_tokens (user_id, created_at)`
];
