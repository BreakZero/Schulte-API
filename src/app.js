import { ApiError } from "./errors.js";
import { InMemoryStore } from "./store.js";

export class SchulteApi {
  constructor(store = new InMemoryStore()) {
    this.store = store;
  }

  async handle(method, rawUrl, headers = {}, rawBody = "") {
    const requestId = "req_local";
    try {
      const url = new URL(rawUrl, "http://localhost");
      if (!url.pathname.startsWith("/api/v1")) {
        throw new ApiError(404, "NOT_FOUND", "接口不存在");
      }

      const route = url.pathname.slice("/api/v1".length) || "/";
      const query = Object.fromEntries(url.searchParams.entries());
      const payload = parseJson(rawBody);
      const { data, status } = this.dispatch(method.toUpperCase(), route, query, normalizeHeaders(headers), payload);

      if (status === 204) return response(status, null);
      return response(status, { data, requestId });
    } catch (error) {
      if (error instanceof ApiError) {
        const body = { error: { code: error.code, message: error.message }, requestId };
        if (error.details.length) body.error.details = error.details;
        return response(error.status, body);
      }
      return response(500, { error: { code: "INTERNAL_ERROR", message: "服务端错误" }, requestId });
    }
  }

  dispatch(method, route, query, headers, payload) {
    if (method === "POST" && route === "/auth/register") {
      return { status: 201, data: this.store.register(payload) };
    }
    if (method === "POST" && route === "/auth/login") {
      return { status: 200, data: this.store.login(payload) };
    }
    if (method === "POST" && route === "/auth/refresh") {
      return { status: 200, data: this.store.refresh(payload.refreshToken) };
    }
    if (method === "POST" && route === "/guest/training-records") {
      const { record, created } = this.store.createGuestTrainingRecord(payload.guestId, payload);
      return { status: created ? 201 : 200, data: withoutDeleted(record) };
    }
    if (method === "GET" && route === "/guest/training-records") {
      return { status: 200, data: this.store.listGuestRecords(query.guestId, query) };
    }
    if (method === "GET" && route === "/guest/training-summary") {
      return { status: 200, data: this.store.guestTrainingSummary(query.guestId, query) };
    }

    const { user, accessToken } = this.store.requireUser(headers.authorization);

    if (method === "POST" && route === "/auth/logout") {
      this.store.logout(accessToken, payload.refreshToken);
      return { status: 204, data: null };
    }
    if (method === "POST" && route === "/auth/logout-all") {
      this.store.logoutAll(user.id);
      return { status: 204, data: null };
    }
    if (method === "GET" && route === "/me") {
      return { status: 200, data: this.store.publicUser(user) };
    }
    if (method === "GET" && route === "/me/profile") {
      return { status: 200, data: this.profile(user) };
    }
    if (method === "PATCH" && route === "/me") {
      return { status: 200, data: this.store.updateUser(user.id, payload) };
    }
    if (method === "POST" && route === "/me/password") {
      this.store.changePassword(user.id, payload);
      return { status: 204, data: null };
    }
    if (method === "DELETE" && route === "/me") {
      this.store.deleteUser(user.id, payload);
      return { status: 202, data: null };
    }
    if (method === "GET" && route === "/me/sessions") {
      return { status: 200, data: { items: this.store.listSessions(user.id) } };
    }
    if (method === "DELETE" && route.startsWith("/me/sessions/")) {
      this.store.revokeSession(user.id, route.split("/").at(-1));
      return { status: 204, data: null };
    }
    if (method === "POST" && route === "/me/training-records") {
      const { record, created } = this.store.createTrainingRecord(user.id, payload);
      return { status: created ? 201 : 200, data: withoutDeleted(record) };
    }
    if (method === "POST" && route === "/me/training-records:batchCreate") {
      return { status: 200, data: this.batchCreate(user.id, payload.items || []) };
    }
    if (method === "GET" && route === "/me/training-records") {
      return { status: 200, data: this.store.listRecords(user.id, query) };
    }
    if (method === "DELETE" && route === "/me/training-records") {
      this.store.clearRecords(user.id, payload);
      return { status: 202, data: null };
    }
    if (method === "POST" && route === "/me/training-records:associateGuest") {
      return { status: 200, data: this.store.associateGuestRecords(user.id, payload) };
    }
    if (method === "GET" && route === "/me/training-summary") {
      return { status: 200, data: this.store.trainingSummary(user.id, query) };
    }
    if (method === "GET" && route === "/me/pk-status") {
      return { status: 200, data: this.pkStatus(user) };
    }
    if (method === "GET" && route.startsWith("/me/training-records/")) {
      return { status: 200, data: this.store.getRecord(user.id, route.split("/").at(-1)) };
    }

    throw new ApiError(404, "NOT_FOUND", "接口不存在");
  }

  profile(user) {
    const trainingSummary = this.store.trainingSummary(user.id, {});
    return {
      account: this.store.publicUser(user),
      trainingSummary,
      competitionProfile: this.competitionProfile(user),
      pkStatus: this.pkStatus(user)
    };
  }

  competitionProfile(user) {
    return {
      rankStatus: user.rankStatus,
      rankDisplayName: user.rankDisplayName,
      rankPoints: user.rankPoints,
      winRateText: user.winRateText,
      matchTotal: user.matchTotal,
      matchWin: user.matchWin,
      matchLoss: user.matchLoss,
      matchDraw: user.matchDraw,
      description: "线上 PK 上线后，将根据对战结果更新段位和胜率。"
    };
  }

  pkStatus(user) {
    return {
      available: false,
      title: "线上 PK 即将上线",
      message: "当前版本暂不支持实时对战。后续版本将开放匹配、好友邀请、段位和胜率统计。",
      competitionProfile: this.competitionProfile(user)
    };
  }

  batchCreate(userId, items) {
    if (items.length > 100) throw new ApiError(400, "VALIDATION_ERROR", "单次最多同步 100 条训练记录");
    let createdCount = 0;
    let duplicateCount = 0;
    const results = items.map((item) => {
      const { record, created } = this.store.createTrainingRecord(userId, item);
      if (created) createdCount += 1;
      else duplicateCount += 1;
      return { clientRecordId: record.clientRecordId, serverRecordId: record.id, status: created ? "CREATED" : "DUPLICATE" };
    });
    return { createdCount, duplicateCount, items: results };
  }
}

function parseJson(rawBody) {
  if (!rawBody) return {};
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody);
  return text ? JSON.parse(text) : {};
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function response(status, body) {
  return {
    status,
    headers: body ? { "content-type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : ""
  };
}

function withoutDeleted(record) {
  const { deletedAt, ...safeRecord } = record;
  return safeRecord;
}
