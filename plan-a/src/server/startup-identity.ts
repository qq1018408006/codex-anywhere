import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function readStartupIdentity(): Promise<string | null> {
  try {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const auth = JSON.parse(
      await fs.readFile(path.join(home, "auth.json"), "utf8"),
    );
    if (auth.auth_mode !== "chatgpt") return null;
    const tokens = auth.tokens;
    const token = tokens?.id_token || tokens?.access_token;
    if (!token) return null;
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    const info = claims["https://api.openai.com/auth"];
    const accountId = tokens.account_id || info?.chatgpt_account_id;
    const userId = info?.chatgpt_user_id || claims.sub;
    if (!accountId || !userId) return null;
    return createHash("sha256")
      .update(
        JSON.stringify([
          home,
          process.env.CODEX_UNIX_SOCKET,
          accountId,
          userId,
        ]),
      )
      .digest("hex");
  } catch {
    return null;
  }
}
