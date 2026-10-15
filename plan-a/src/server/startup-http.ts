import type { FastifyInstance } from "fastify";
import { brotliCompress, constants, gzip, gunzipSync } from "node:zlib";
import { promisify } from "node:util";

import { readStartupIdentity } from "./startup-identity";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

declare global {
  var __CODEX_WEB_STARTUP_FETCH__:
    | ((
        params: Record<string, unknown>,
        signal: AbortSignal,
      ) => Promise<{ statsigPayload: string }>)
    | undefined;
}

export function registerStartupHttp(
  app: FastifyInstance,
  bridge: {
    rendererId: (session: string) => Promise<number | undefined>;
    invoke: (
      channel: string,
      args: unknown[],
      windowId: number,
    ) => Promise<unknown>;
    identity?: () => Promise<string | null>;
  },
): void {
  let cached:
    | {
        key: string;
        expires: number;
        response: Promise<{ plain: Buffer; gzip: Buffer; br: Buffer }>;
      }
    | undefined;
  app.post("/__backend/startup-bootstrap", async (request, reply) => {
    const session = (request.query as { browserSession?: string })
      .browserSession;
    if (!session || (await bridge.rendererId(session)) === undefined)
      return reply.code(404).send({ error: "Renderer session not found" });
    const fetchBootstrap = globalThis.__CODEX_WEB_STARTUP_FETCH__;
    if (!fetchBootstrap)
      return reply.code(503).send({ error: "Startup transport not ready" });
    const params = request.body as Record<string, unknown>;
    const identity = await (bridge.identity ?? readStartupIdentity)();
    const key = JSON.stringify({ identity, params });
    if (!cached || cached.key !== key || cached.expires <= Date.now()) {
      const response = fetchBootstrap(params, AbortSignal.timeout(15000)).then(
        async (data) => {
          const { user } = JSON.parse(data.statsigPayload);
          const plain = Buffer.from(
            JSON.stringify({ statsigPayload: data.statsigPayload, user }),
          );
          const [compressedGzip, br] = await Promise.all([
            gzipAsync(plain, { level: 6 }),
            brotliAsync(plain, {
              params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
            }),
          ]);
          return { plain, gzip: compressedGzip, br };
        },
      );
      cached = { key, expires: Date.now() + 5 * 60 * 1000, response };
      void response.catch(() => {
        if (cached?.response === response) cached = undefined;
      });
    }
    try {
      const data = await cached.response;
      reply
        .header("Cache-Control", "no-store")
        .header("Vary", "Accept-Encoding")
        .type("application/json");
      const encodings = request.headers["accept-encoding"] ?? "";
      const br = /(?:^|,)\s*br\b(?:\s*;\s*q=([0-9.]+))?/.exec(encodings);
      if (br && (br[1] === undefined || Number(br[1]) > 0))
        return reply.header("Content-Encoding", "br").send(data.br);
      if (encodings.includes("gzip"))
        return reply.header("Content-Encoding", "gzip").send(data.gzip);
      return reply.send(data.plain);
    } catch (error) {
      return reply.code(502).send({
        error:
          error instanceof Error
            ? error.message
            : "Startup configuration failed",
      });
    }
  });

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 16 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );
  app.post("/__backend/startup-evaluations", async (request, reply) => {
    const session = (request.query as { browserSession?: string })
      .browserSession;
    const windowId = session ? await bridge.rendererId(session) : undefined;
    if (windowId === undefined)
      return reply.code(404).send({ error: "Renderer session not found" });
    const body =
      request.headers["content-encoding"] === "gzip"
        ? gunzipSync(request.body as Buffer, {
            maxOutputLength: 16 * 1024 * 1024,
          })
        : (request.body as Buffer);
    const value = JSON.parse(body.toString());
    const result = await bridge.invoke(
      "codex_desktop:message-from-view",
      [{ type: "shared-object-set", key: "statsig_evaluations", value }],
      windowId,
    );
    return reply.header("Cache-Control", "no-store").send({ result });
  });
}
