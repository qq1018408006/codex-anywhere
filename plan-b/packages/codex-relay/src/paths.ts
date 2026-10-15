import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

const appDataDirectoryName = "codex-relay";

export function codexRelayHome() {
  const configuredHome = process.env.CODEX_RELAY_HOME?.trim();
  if (configuredHome) {
    return resolve(configuredHome);
  }

  return defaultCodexRelayHome();
}

export function codexRelayDataPath(fileName: string) {
  return resolve(codexRelayHome(), fileName);
}

export function legacyCodexRelayDataPath(fileName: string) {
  return resolve(process.cwd(), ".codex-relay", fileName);
}

function defaultCodexRelayHome() {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", appDataDirectoryName);
    case "win32":
      return join(
        process.env.APPDATA?.trim() || join(home, "AppData", "Roaming"),
        appDataDirectoryName,
      );
    default:
      return join(
        process.env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"),
        appDataDirectoryName,
      );
  }
}
