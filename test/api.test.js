import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SchulteApi } from "../src/app.js";
import { FileStore } from "../src/store.js";

function createClient(store) {
  const api = new SchulteApi(store);
  return async function request(method, path, payload, token) {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const rawBody = payload === undefined ? "" : JSON.stringify(payload);
    const response = await api.handle(method, path, headers, rawBody);
    return {
      status: response.status,
      body: response.body ? JSON.parse(response.body) : null
    };
  };
}

async function register(request) {
  const response = await request("POST", "/api/v1/auth/register", {
    password: "StrongPassword123",
    nickname: "小明",
    gender: "MALE",
    acceptedTerms: true,
    device: { deviceName: "iPhone", platform: "IOS" }
  });
  assert.equal(response.status, 201);
  return response.body.data;
}

test("registers a user and reads /me without exposing password hash", async () => {
  const request = createClient();
  const auth = await register(request);

  const response = await request("GET", "/api/v1/me", undefined, auth.accessToken);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.nickname, "小明");
  assert.match(response.body.data.registrationId, /^SQT-\d{6}$/);
  assert.equal(response.body.data.gender, "MALE");
  assert.equal(response.body.data.rankDisplayName, "未定级");
  assert.equal(response.body.data.winRateText, "暂无对战数据");
  assert.equal(response.body.data.passwordHash, undefined);
});

test("logs in with registration ID", async () => {
  const request = createClient();
  const auth = await register(request);

  const response = await request("POST", "/api/v1/auth/login", {
    registrationId: auth.user.registrationId,
    password: "StrongPassword123",
    device: { deviceName: "Android", platform: "ANDROID" }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.user.registrationId, auth.user.registrationId);
});

test("protected endpoints require bearer token", async () => {
  const request = createClient();

  const response = await request("GET", "/api/v1/me");

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
});

test("training records calculate first record and personal best", async () => {
  const request = createClient();
  const auth = await register(request);
  const first = {
    clientRecordId: "local_1",
    clientCreatedAt: "2026-06-06T15:30:00+08:00",
    gridSize: 5,
    ageGroup: "ADULT",
    trainingMode: "STANDARD",
    elapsedTimeMillis: 18420,
    errorCount: 1,
    scoreLevel: "GOOD"
  };

  const firstResponse = await request("POST", "/api/v1/me/training-records", first, auth.accessToken);
  assert.equal(firstResponse.status, 201);
  assert.equal(firstResponse.body.data.improvementStatus, "FIRST_RECORD");
  assert.equal(firstResponse.body.data.isPersonalBest, true);

  const secondResponse = await request(
    "POST",
    "/api/v1/me/training-records",
    { ...first, clientRecordId: "local_2", elapsedTimeMillis: 16800, errorCount: 0 },
    auth.accessToken
  );
  assert.equal(secondResponse.status, 201);
  assert.equal(secondResponse.body.data.improvementStatus, "PERSONAL_BEST");
  assert.equal(secondResponse.body.data.timeDeltaMillis, -1620);
  assert.equal(secondResponse.body.data.errorDelta, -1);
});

test("clientRecordId makes training record creation idempotent", async () => {
  const request = createClient();
  const auth = await register(request);
  const payload = {
    clientRecordId: "local_1",
    gridSize: 5,
    ageGroup: "ADULT",
    trainingMode: "STANDARD",
    elapsedTimeMillis: 18420,
    errorCount: 1,
    scoreLevel: "GOOD"
  };

  const first = await request("POST", "/api/v1/me/training-records", payload, auth.accessToken);
  const second = await request("POST", "/api/v1/me/training-records", payload, auth.accessToken);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(first.body.data.id, second.body.data.id);
});

test("clears current user's training records", async () => {
  const request = createClient();
  const auth = await register(request);
  await request(
    "POST",
    "/api/v1/me/training-records",
    {
      clientRecordId: "local_1",
      gridSize: 5,
      ageGroup: "ADULT",
      trainingMode: "STANDARD",
      elapsedTimeMillis: 18420,
      errorCount: 1,
      scoreLevel: "GOOD"
    },
    auth.accessToken
  );

  const clearResponse = await request(
    "DELETE",
    "/api/v1/me/training-records",
    { confirm: "CLEAR_MY_TRAINING_RECORDS" },
    auth.accessToken
  );
  const summary = await request("GET", "/api/v1/me/training-summary", undefined, auth.accessToken);

  assert.equal(clearResponse.status, 202);
  assert.equal(summary.body.data.totalCount, 0);
});

test("guest records can be associated to a logged-in user", async () => {
  const request = createClient();
  const auth = await register(request);
  const guestPayload = {
    guestId: "guest_device_1",
    clientRecordId: "local_guest_1",
    gridSize: 5,
    ageGroup: "ADULT",
    trainingMode: "STANDARD",
    elapsedTimeMillis: 20100,
    errorCount: 2,
    scoreLevel: "NORMAL"
  };

  const guestRecord = await request("POST", "/api/v1/guest/training-records", guestPayload);
  const associate = await request(
    "POST",
    "/api/v1/me/training-records:associateGuest",
    { guestId: "guest_device_1" },
    auth.accessToken
  );
  const summary = await request("GET", "/api/v1/me/training-summary", undefined, auth.accessToken);

  assert.equal(guestRecord.status, 201);
  assert.equal(guestRecord.body.data.ownerType, "GUEST");
  assert.equal(associate.status, 200);
  assert.equal(associate.body.data.associatedCount, 1);
  assert.equal(summary.body.data.totalCount, 1);
});

test("profile exposes training summary and PK placeholders without fake competition data", async () => {
  const request = createClient();
  const auth = await register(request);

  const response = await request("GET", "/api/v1/me/profile", undefined, auth.accessToken);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.account.registrationId, auth.user.registrationId);
  assert.equal(response.body.data.competitionProfile.rankDisplayName, "未定级");
  assert.equal(response.body.data.competitionProfile.winRateText, "暂无对战数据");
  assert.equal(response.body.data.pkStatus.available, false);
});

test("file store persists users and training records across instances", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schulte-api-"));
  const filePath = path.join(tempDir, "store.json");
  const firstClient = createClient(new FileStore(filePath));
  const auth = await register(firstClient);
  await firstClient(
    "POST",
    "/api/v1/me/training-records",
    {
      clientRecordId: "local_1",
      gridSize: 5,
      ageGroup: "ADULT",
      trainingMode: "STANDARD",
      elapsedTimeMillis: 18420,
      errorCount: 1,
      scoreLevel: "GOOD"
    },
    auth.accessToken
  );

  const secondClient = createClient(new FileStore(filePath));
  const me = await secondClient("GET", "/api/v1/me", undefined, auth.accessToken);
  const summary = await secondClient("GET", "/api/v1/me/training-summary", undefined, auth.accessToken);

  assert.equal(me.status, 200);
  assert.equal(me.body.data.registrationId, auth.user.registrationId);
  assert.equal(summary.body.data.totalCount, 1);
});
