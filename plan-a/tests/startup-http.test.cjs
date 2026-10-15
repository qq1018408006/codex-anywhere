const test = require("node:test");
const assert = require("node:assert/strict");
const Fastify = require("fastify");
const { gzipSync, gunzipSync, brotliDecompressSync } = require("node:zlib");
const { registerStartupHttp } = require("../src/server/startup-http.js");

test("compressed startup cache coalesces requests and separates account identities", async () => {
  const app = Fastify();
  let calls = 0,
    identity = "account-a";
  global.__CODEX_WEB_STARTUP_FETCH__ = async () => {
    calls++;
    return {
      statsigPayload: JSON.stringify({
        user: { userID: identity },
        feature_gates: { value: "完整配置 ".repeat(30000) },
      }),
    };
  };
  registerStartupHttp(app, {
    rendererId: async () => 1,
    invoke: async () => undefined,
    identity: async () => identity,
  });
  try {
    const options = {
      method: "POST",
      url: "/__backend/startup-bootstrap?browserSession=test",
      headers: { "accept-encoding": "gzip" },
      payload: { app_version: "test" },
    };
    const [first, second] = await Promise.all([
      app.inject(options),
      app.inject(options),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    const body = JSON.parse(gunzipSync(first.rawPayload).toString());
    assert.equal(body.user.userID, "account-a");
    assert.equal(
      JSON.parse(body.statsigPayload).feature_gates.value,
      "完整配置 ".repeat(30000),
    );
    assert.ok(
      first.rawPayload.length < Buffer.byteLength(body.statsigPayload) / 20,
    );
    const brotli = await app.inject({
      ...options,
      headers: { "accept-encoding": "gzip, br" },
    });
    assert.equal(brotli.headers["content-encoding"], "br");
    assert.deepEqual(
      JSON.parse(brotliDecompressSync(brotli.rawPayload).toString()),
      body,
    );
    const gzipOnly = await app.inject({
      ...options,
      headers: { "accept-encoding": "br;q=0, gzip" },
    });
    assert.equal(gzipOnly.headers["content-encoding"], "gzip");
    assert.equal(calls, 1);
    identity = "account-b";
    const next = await app.inject(options);
    assert.equal(calls, 2);
    assert.equal(
      JSON.parse(gunzipSync(next.rawPayload).toString()).user.userID,
      "account-b",
    );
  } finally {
    await app.close();
    delete global.__CODEX_WEB_STARTUP_FETCH__;
  }
});

test("compressed feature publication delivers the complete original value to its renderer", async () => {
  const app = Fastify(),
    calls = [];
  registerStartupHttp(app, {
    rendererId: async (session) => (session === "known" ? 42 : undefined),
    invoke: async (...args) => {
      calls.push(args);
      return "accepted";
    },
  });
  const value = { userId: "test-user", payload: "长配置原文 ".repeat(30000) };
  try {
    const response = await app.inject({
      method: "POST",
      url: "/__backend/startup-evaluations?browserSession=known",
      headers: {
        "content-type": "application/octet-stream",
        "content-encoding": "gzip",
      },
      payload: gzipSync(Buffer.from(JSON.stringify(value))),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().result, "accepted");
    assert.deepEqual(calls, [
      [
        "codex_desktop:message-from-view",
        [{ type: "shared-object-set", key: "statsig_evaluations", value }],
        42,
      ],
    ]);
  } finally {
    await app.close();
  }
});
