import { ApiError } from "./errors.js";
import fs from "node:fs";
import path from "node:path";
import {
  AgeGroups,
  Genders,
  GridSizes,
  ScoreLevels,
  TrainingModes,
  calculateImprovement,
  utcNow
} from "./domain.js";
import { hashPassword, hashToken, makeToken, verifyPassword } from "./security.js";

export class InMemoryStore {
  constructor() {
    this.users = new Map();
    this.usersByEmail = new Map();
    this.usersByRegistrationId = new Map();
    this.sessions = new Map();
    this.accessTokens = new Map();
    this.refreshToSession = new Map();
    this.records = new Map();
    this.recordByClientId = new Map();
    this.counters = new Map();
  }

  register({ email, password, nickname, gender = "UNDISCLOSED", acceptedTerms, device }) {
    this.validateRegistration({ nickname, password, gender, acceptedTerms });

    const now = utcNow();
    const registrationId = this.registrationId();
    const user = {
      id: this.id("usr"),
      registrationId,
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

    this.users.set(user.id, user);
    if (user.email) this.usersByEmail.set(user.email, user.id);
    this.usersByRegistrationId.set(registrationId, user.id);
    return this.issueTokens(user, device);
  }

  login({ registrationId, email, password, device }) {
    const user = registrationId ? this.userByRegistrationId(registrationId) : this.userByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new ApiError(401, "UNAUTHORIZED", "注册 ID 或密码不正确");
    }
    if (user.status !== "ACTIVE") {
      throw new ApiError(403, "FORBIDDEN", "账号不可用");
    }
    return this.issueTokens(user, device);
  }

  refresh(refreshToken) {
    const sessionId = this.refreshToSession.get(hashToken(refreshToken || ""));
    const session = this.sessions.get(sessionId);
    if (!session || session.revokedAt) {
      throw new ApiError(401, "UNAUTHORIZED", "Refresh token 无效");
    }

    const user = this.users.get(session.userId);
    if (!user || user.status !== "ACTIVE") {
      throw new ApiError(401, "UNAUTHORIZED", "账号不可用");
    }

    this.refreshToSession.delete(session.refreshTokenHash);
    const accessToken = makeToken("acc");
    const newRefreshToken = makeToken("ref");
    session.refreshTokenHash = hashToken(newRefreshToken);
    session.lastActiveAt = utcNow();
    this.refreshToSession.set(session.refreshTokenHash, session.id);
    this.accessTokens.set(accessToken, user.id);
    return { accessToken, refreshToken: newRefreshToken, expiresIn: 7200 };
  }

  requireUser(authorization) {
    if (!authorization?.startsWith("Bearer ")) {
      throw new ApiError(401, "UNAUTHORIZED", "缺少访问令牌");
    }

    const token = authorization.slice("Bearer ".length);
    const user = this.users.get(this.accessTokens.get(token));
    if (!user || user.status !== "ACTIVE") {
      throw new ApiError(401, "UNAUTHORIZED", "访问令牌无效");
    }
    return { user, accessToken: token };
  }

  logout(accessToken, refreshToken) {
    if (accessToken) this.accessTokens.delete(accessToken);
    if (refreshToken) {
      const sessionId = this.refreshToSession.get(hashToken(refreshToken));
      this.refreshToSession.delete(hashToken(refreshToken));
      const session = this.sessions.get(sessionId);
      if (session) session.revokedAt = utcNow();
    }
  }

  logoutAll(userId) {
    const now = utcNow();
    for (const [token, tokenUserId] of this.accessTokens.entries()) {
      if (tokenUserId === userId) this.accessTokens.delete(token);
    }
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        this.refreshToSession.delete(session.refreshTokenHash);
        session.revokedAt = now;
      }
    }
  }

  publicUser(user) {
    const { passwordHash, deletedAt, ...safeUser } = user;
    return safeUser;
  }

  updateUser(userId, payload) {
    const user = this.users.get(userId);
    if (payload.nickname !== undefined) {
      const nickname = String(payload.nickname).trim();
      if (nickname.length < 1 || nickname.length > 20) {
        throw new ApiError(400, "VALIDATION_ERROR", "昵称长度必须为 1 到 20 个字符");
      }
      user.nickname = nickname;
    }
    if (payload.avatarUrl !== undefined) {
      user.avatarUrl = payload.avatarUrl;
    }
    if (payload.gender !== undefined) {
      if (!Genders.has(payload.gender)) {
        throw new ApiError(400, "VALIDATION_ERROR", "性别枚举值不合法");
      }
      user.gender = payload.gender;
    }
    user.updatedAt = utcNow();
    return this.publicUser(user);
  }

  changePassword(userId, payload) {
    const user = this.users.get(userId);
    if (!verifyPassword(payload.oldPassword, user.passwordHash)) {
      throw new ApiError(401, "UNAUTHORIZED", "原密码不正确");
    }
    this.validatePassword(payload.newPassword);
    user.passwordHash = hashPassword(payload.newPassword);
    user.updatedAt = utcNow();
  }

  deleteUser(userId, payload) {
    const user = this.users.get(userId);
    if (payload.confirm !== "DELETE_MY_ACCOUNT") {
      throw new ApiError(400, "VALIDATION_ERROR", "缺少注销确认");
    }
    if (!verifyPassword(payload.password, user.passwordHash)) {
      throw new ApiError(401, "UNAUTHORIZED", "密码不正确");
    }
    user.status = "DELETED";
    user.deletedAt = utcNow();
    user.updatedAt = user.deletedAt;
    this.logoutAll(userId);
  }

  listSessions(userId) {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId && !session.revokedAt)
      .map(({ id, deviceName, platform, lastActiveAt, createdAt }) => ({ id, deviceName, platform, lastActiveAt, createdAt }));
  }

  revokeSession(userId, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      throw new ApiError(404, "NOT_FOUND", "会话不存在");
    }
    session.revokedAt = utcNow();
    this.refreshToSession.delete(session.refreshTokenHash);
  }

  createTrainingRecord(userId, payload) {
    return this.createOwnedTrainingRecord({ ownerType: "USER", userId, guestId: null, payload });
  }

  createGuestTrainingRecord(guestId, payload) {
    if (!guestId) {
      throw new ApiError(400, "VALIDATION_ERROR", "缺少游客 ID");
    }
    return this.createOwnedTrainingRecord({ ownerType: "GUEST", userId: null, guestId: String(guestId), payload });
  }

  createOwnedTrainingRecord({ ownerType, userId, guestId, payload }) {
    this.validateTrainingRecord(payload);
    const ownerKey = this.ownerKey(ownerType, userId, guestId);
    const duplicateKey = `${ownerKey}:${payload.clientRecordId}`;
    if (this.recordByClientId.has(duplicateKey)) {
      return { record: this.records.get(this.recordByClientId.get(duplicateKey)), created: false };
    }

    const previous = this.latestRecordForOwner(ownerType, userId, guestId, payload);
    const best = this.bestRecordForOwner(ownerType, userId, guestId, payload);
    const progress = calculateImprovement(payload, previous, best);
    const now = utcNow();
    const record = {
      id: this.id("rec"),
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

    this.records.set(record.id, record);
    this.recordByClientId.set(duplicateKey, record.id);
    return { record, created: true };
  }

  listRecords(userId, query) {
    let records = this.activeRecords(userId);
    if (query.gridSize) records = records.filter((record) => record.gridSize === Number(query.gridSize));
    if (query.ageGroup) records = records.filter((record) => record.ageGroup === query.ageGroup);
    if (query.trainingMode) records = records.filter((record) => record.trainingMode === query.trainingMode);
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const start = (page - 1) * pageSize;
    return { items: records.slice(start, start + pageSize).map(publicRecord), page, pageSize, total: records.length };
  }

  getRecord(userId, recordId) {
    const record = this.records.get(recordId);
    if (!record || record.userId !== userId || record.deletedAt) {
      throw new ApiError(404, "NOT_FOUND", "训练记录不存在");
    }
    return publicRecord(record);
  }

  trainingSummary(userId, query) {
    let records = this.activeRecords(userId);
    if (query.gridSize) records = records.filter((record) => record.gridSize === Number(query.gridSize));
    if (query.ageGroup) records = records.filter((record) => record.ageGroup === query.ageGroup);
    if (query.trainingMode) records = records.filter((record) => record.trainingMode === query.trainingMode);
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const recent = records.slice(0, 5);
    const best = records.length ? records.reduce((a, b) => (a.elapsedTimeMillis <= b.elapsedTimeMillis ? a : b)) : null;
    const latest = records[0] || null;

    return {
      totalCount: records.length,
      recent7DaysCount: records.length,
      bestRecord: summaryRecord(best),
      latestRecord: summaryRecord(latest),
      recentAverageTimeMillis: recent.length ? Math.floor(recent.reduce((sum, record) => sum + record.elapsedTimeMillis, 0) / recent.length) : null,
      recentAverageErrorCount: recent.length ? Number((recent.reduce((sum, record) => sum + record.errorCount, 0) / recent.length).toFixed(2)) : null
    };
  }

  clearRecords(userId, payload) {
    if (payload.confirm !== "CLEAR_MY_TRAINING_RECORDS") {
      throw new ApiError(400, "VALIDATION_ERROR", "缺少清空确认");
    }
    const now = utcNow();
    for (const record of this.records.values()) {
      if (record.userId === userId) record.deletedAt = now;
    }
  }

  listGuestRecords(guestId, query) {
    let records = this.activeGuestRecords(guestId);
    if (query.gridSize) records = records.filter((record) => record.gridSize === Number(query.gridSize));
    if (query.ageGroup) records = records.filter((record) => record.ageGroup === query.ageGroup);
    if (query.trainingMode) records = records.filter((record) => record.trainingMode === query.trainingMode);
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const start = (page - 1) * pageSize;
    return { items: records.slice(start, start + pageSize).map(publicRecord), page, pageSize, total: records.length };
  }

  guestTrainingSummary(guestId, query) {
    return this.recordsSummary(this.filterRecords(this.activeGuestRecords(guestId), query));
  }

  associateGuestRecords(userId, payload) {
    const guestId = payload.guestId;
    if (!guestId) throw new ApiError(400, "VALIDATION_ERROR", "缺少游客 ID");

    const records = this.activeGuestRecords(guestId);
    let associatedCount = 0;
    for (const record of records) {
      const oldDuplicateKey = this.ownerDuplicateKey("GUEST", null, guestId, record.clientRecordId);
      const newDuplicateKey = this.ownerDuplicateKey("USER", userId, null, record.clientRecordId);
      if (this.recordByClientId.has(newDuplicateKey)) {
        record.deletedAt = utcNow();
      } else {
        record.ownerType = "USER";
        record.userId = userId;
        record.guestId = null;
        this.recordByClientId.set(newDuplicateKey, record.id);
        associatedCount += 1;
      }
      this.recordByClientId.delete(oldDuplicateKey);
    }

    this.recalculateUserProgress(userId);
    return { associatedCount, skippedDuplicateCount: records.length - associatedCount };
  }

  issueTokens(user, device = {}) {
    const now = utcNow();
    const accessToken = makeToken("acc");
    const refreshToken = makeToken("ref");
    const session = {
      id: this.id("ses"),
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      deviceName: device.deviceName || "Unknown Device",
      platform: device.platform || "UNKNOWN",
      lastActiveAt: now,
      createdAt: now,
      revokedAt: null
    };

    this.sessions.set(session.id, session);
    this.accessTokens.set(accessToken, user.id);
    this.refreshToSession.set(session.refreshTokenHash, session.id);
    return { user: this.publicUser(user), accessToken, refreshToken, expiresIn: 7200 };
  }

  validateEmailPassword(email, password) {
    const details = [];
    if (!email || !String(email).includes("@")) details.push({ field: "email", reason: "邮箱格式不正确" });
    if (!password || String(password).length < 6) details.push({ field: "password", reason: "密码至少 6 位" });
    if (details.length) throw new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", details);
  }

  validateRegistration({ nickname, password, gender, acceptedTerms }) {
    const details = [];
    const trimmedNickname = String(nickname || "").trim();
    if (trimmedNickname.length < 2 || trimmedNickname.length > 12) {
      details.push({ field: "nickname", reason: "昵称长度必须为 2 到 12 个字符" });
    }
    if (!password || String(password).length < 6) {
      details.push({ field: "password", reason: "密码至少 6 位" });
    }
    if (!Genders.has(gender)) {
      details.push({ field: "gender", reason: "性别枚举值不合法" });
    }
    if (acceptedTerms !== true) {
      details.push({ field: "acceptedTerms", reason: "必须同意用户协议和隐私说明" });
    }
    if (details.length) throw new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", details);
  }

  validatePassword(password) {
    if (!password || String(password).length < 6) {
      throw new ApiError(400, "VALIDATION_ERROR", "密码至少 6 位");
    }
  }

  validateTrainingRecord(payload) {
    const details = [];
    if (!GridSizes.has(payload.gridSize)) details.push({ field: "gridSize", reason: "方格规格仅支持 3、4、5、7" });
    if (!AgeGroups.has(payload.ageGroup)) details.push({ field: "ageGroup", reason: "枚举值不合法" });
    if (!TrainingModes.has(payload.trainingMode)) details.push({ field: "trainingMode", reason: "枚举值不合法" });
    if (!ScoreLevels.has(payload.scoreLevel)) details.push({ field: "scoreLevel", reason: "枚举值不合法" });
    if (!payload.clientRecordId) details.push({ field: "clientRecordId", reason: "不能为空" });
    if (!Number.isInteger(payload.elapsedTimeMillis) || payload.elapsedTimeMillis <= 0) details.push({ field: "elapsedTimeMillis", reason: "完成耗时必须大于 0" });
    if (!Number.isInteger(payload.errorCount) || payload.errorCount < 0) details.push({ field: "errorCount", reason: "错误次数不能为负数" });
    if (details.length) throw new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", details);
  }

  activeRecords(userId) {
    return [...this.records.values()].filter((record) => record.ownerType !== "GUEST" && record.userId === userId && !record.deletedAt);
  }

  activeGuestRecords(guestId) {
    return [...this.records.values()].filter((record) => record.ownerType === "GUEST" && record.guestId === String(guestId) && !record.deletedAt);
  }

  filterRecords(records, query) {
    let filtered = [...records];
    if (query.gridSize) filtered = filtered.filter((record) => record.gridSize === Number(query.gridSize));
    if (query.ageGroup) filtered = filtered.filter((record) => record.ageGroup === query.ageGroup);
    if (query.trainingMode) filtered = filtered.filter((record) => record.trainingMode === query.trainingMode);
    return filtered;
  }

  recordsSummary(records) {
    const sorted = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const recent = sorted.slice(0, 5);
    const best = sorted.length ? sorted.reduce((a, b) => (a.elapsedTimeMillis <= b.elapsedTimeMillis ? a : b)) : null;
    const latest = sorted[0] || null;

    return {
      totalCount: sorted.length,
      recent7DaysCount: sorted.length,
      bestRecord: summaryRecord(best),
      latestRecord: summaryRecord(latest),
      recentAverageTimeMillis: recent.length ? Math.floor(recent.reduce((sum, record) => sum + record.elapsedTimeMillis, 0) / recent.length) : null,
      recentAverageErrorCount: recent.length ? Number((recent.reduce((sum, record) => sum + record.errorCount, 0) / recent.length).toFixed(2)) : null
    };
  }

  latestRecord(userId, payload) {
    return this.sameConditionRecords(userId, payload).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  }

  bestRecord(userId, payload) {
    const records = this.sameConditionRecords(userId, payload);
    return records.length ? records.reduce((a, b) => (a.elapsedTimeMillis <= b.elapsedTimeMillis ? a : b)) : null;
  }

  sameConditionRecords(userId, payload) {
    return this.activeRecords(userId).filter(
      (record) =>
        record.gridSize === payload.gridSize &&
        record.ageGroup === payload.ageGroup &&
        record.trainingMode === payload.trainingMode
    );
  }

  latestRecordForOwner(ownerType, userId, guestId, payload) {
    return this.sameConditionRecordsForOwner(ownerType, userId, guestId, payload).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  }

  bestRecordForOwner(ownerType, userId, guestId, payload) {
    const records = this.sameConditionRecordsForOwner(ownerType, userId, guestId, payload);
    return records.length ? records.reduce((a, b) => (a.elapsedTimeMillis <= b.elapsedTimeMillis ? a : b)) : null;
  }

  sameConditionRecordsForOwner(ownerType, userId, guestId, payload) {
    const records = ownerType === "GUEST" ? this.activeGuestRecords(guestId) : this.activeRecords(userId);
    return records.filter(
      (record) =>
        record.gridSize === payload.gridSize &&
        record.ageGroup === payload.ageGroup &&
        record.trainingMode === payload.trainingMode
    );
  }

  recalculateUserProgress(userId) {
    const groups = new Map();
    for (const record of this.activeRecords(userId)) {
      const key = `${record.gridSize}:${record.ageGroup}:${record.trainingMode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }

    for (const records of groups.values()) {
      records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      let best = null;
      let previous = null;
      for (const record of records) {
        const progress = calculateImprovement(record, previous, best);
        record.isPersonalBest = progress.isPersonalBest;
        record.previousRecordId = progress.previousRecordId;
        record.improvementStatus = progress.improvementStatus;
        record.timeDeltaMillis = progress.timeDeltaMillis;
        record.errorDelta = progress.errorDelta;
        if (!best || record.elapsedTimeMillis < best.elapsedTimeMillis) best = record;
        previous = record;
      }
    }
  }

  ownerKey(ownerType, userId, guestId) {
    return ownerType === "GUEST" ? `GUEST:${guestId}` : `USER:${userId}`;
  }

  ownerDuplicateKey(ownerType, userId, guestId, clientRecordId) {
    return `${this.ownerKey(ownerType, userId, guestId)}:${clientRecordId}`;
  }

  userByEmail(email) {
    return this.users.get(this.usersByEmail.get(String(email || "").toLowerCase()));
  }

  userByRegistrationId(registrationId) {
    return this.users.get(this.usersByRegistrationId.get(String(registrationId || "").toUpperCase()));
  }

  id(prefix) {
    const next = (this.counters.get(prefix) || 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(6, "0")}`;
  }

  registrationId() {
    const next = (this.counters.get("registration") || 0) + 1;
    this.counters.set("registration", next);
    return `SQT-${String(100000 + next).padStart(6, "0")}`;
  }
}

export class FileStore extends InMemoryStore {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.load();
  }

  register(payload) {
    const result = super.register(payload);
    this.persist();
    return result;
  }

  login(payload) {
    const result = super.login(payload);
    this.persist();
    return result;
  }

  refresh(refreshToken) {
    const result = super.refresh(refreshToken);
    this.persist();
    return result;
  }

  logout(accessToken, refreshToken) {
    super.logout(accessToken, refreshToken);
    this.persist();
  }

  logoutAll(userId) {
    super.logoutAll(userId);
    this.persist();
  }

  updateUser(userId, payload) {
    const result = super.updateUser(userId, payload);
    this.persist();
    return result;
  }

  changePassword(userId, payload) {
    super.changePassword(userId, payload);
    this.persist();
  }

  deleteUser(userId, payload) {
    super.deleteUser(userId, payload);
    this.persist();
  }

  revokeSession(userId, sessionId) {
    super.revokeSession(userId, sessionId);
    this.persist();
  }

  createTrainingRecord(userId, payload) {
    const result = super.createTrainingRecord(userId, payload);
    if (result.created) this.persist();
    return result;
  }

  createGuestTrainingRecord(guestId, payload) {
    const result = super.createGuestTrainingRecord(guestId, payload);
    if (result.created) this.persist();
    return result;
  }

  associateGuestRecords(userId, payload) {
    const result = super.associateGuestRecords(userId, payload);
    this.persist();
    return result;
  }

  clearRecords(userId, payload) {
    super.clearRecords(userId, payload);
    this.persist();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;

    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) return;

    const data = JSON.parse(raw);
    this.users = new Map(data.users || []);
    this.usersByEmail = new Map(data.usersByEmail || []);
    this.usersByRegistrationId = new Map(data.usersByRegistrationId || []);
    this.sessions = new Map(data.sessions || []);
    this.accessTokens = new Map(data.accessTokens || []);
    this.refreshToSession = new Map(data.refreshToSession || []);
    this.records = new Map(data.records || []);
    this.recordByClientId = new Map(data.recordByClientId || []);
    this.counters = new Map(data.counters || []);
    this.normalizeLoadedData();
  }

  persist() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const data = {
      version: 1,
      users: [...this.users.entries()],
      usersByEmail: [...this.usersByEmail.entries()],
      usersByRegistrationId: [...this.usersByRegistrationId.entries()],
      sessions: [...this.sessions.entries()],
      accessTokens: [...this.accessTokens.entries()],
      refreshToSession: [...this.refreshToSession.entries()],
      records: [...this.records.entries()],
      recordByClientId: [...this.recordByClientId.entries()],
      counters: [...this.counters.entries()]
    };
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  normalizeLoadedData() {
    for (const user of this.users.values()) {
      if (!user.registrationId) {
        user.registrationId = this.registrationId();
      }
      if (!user.gender) user.gender = "UNDISCLOSED";
      if (!user.rankStatus) user.rankStatus = "UNRANKED";
      if (!user.rankDisplayName) user.rankDisplayName = "未定级";
      if (user.rankPoints === undefined) user.rankPoints = null;
      if (!user.winRateText) user.winRateText = "暂无对战数据";
      if (user.matchTotal === undefined) user.matchTotal = 0;
      if (user.matchWin === undefined) user.matchWin = 0;
      if (user.matchLoss === undefined) user.matchLoss = 0;
      if (user.matchDraw === undefined) user.matchDraw = 0;
      this.usersByRegistrationId.set(user.registrationId, user.id);
    }

    for (const record of this.records.values()) {
      if (!record.ownerType) record.ownerType = record.userId ? "USER" : "GUEST";
      if (record.guestId === undefined) record.guestId = null;
    }
  }
}

function publicRecord(record) {
  const { deletedAt, ...safeRecord } = record;
  return safeRecord;
}

function summaryRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    elapsedTimeMillis: record.elapsedTimeMillis,
    errorCount: record.errorCount,
    createdAt: record.createdAt
  };
}
