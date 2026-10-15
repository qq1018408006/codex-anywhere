import {
  activeConnectionStorageKey,
  codexRelayStorage as storage,
  getCodexRelayServerUrl,
  getCodexRelayServerUrlCandidates,
  normalizeServerUrl,
  saveCodexRelayServerUrlCandidates,
  setCodexRelayServerUrl,
} from "./codex-relay-server-url-storage";
import { migrateLegacySecureSession } from "./secure-transport";

const profilesKey = "codex-relay.connections";
const tokenKey = "codex-relay.client-token";

export type ConnectionProfile = {
  id: string;
  name: string;
  serverUrl: string;
  serverUrls: string[];
  clientToken?: string;
};

function readProfiles(): ConnectionProfile[] {
  return JSON.parse(storage.getString(profilesKey) ?? "[]");
}

function writeProfile(profile: ConnectionProfile) {
  const profiles = readProfiles();
  const index = profiles.findIndex((entry) => entry.id === profile.id);
  if (index < 0) profiles.push(profile);
  else profiles[index] = profile;
  storage.set(profilesKey, JSON.stringify(profiles));
}

export function getActiveConnectionId() {
  return storage.getString(activeConnectionStorageKey);
}

export function saveActiveConnection() {
  const token = storage.getString(tokenKey);
  let id = getActiveConnectionId();
  if (!id && !token) return;
  const isLegacy = !id;
  id ??= `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const existing = readProfiles().find((profile) => profile.id === id);
  const serverUrl = getCodexRelayServerUrl();
  writeProfile({
    id,
    name: existing?.name ?? new URL(serverUrl).host,
    serverUrl,
    serverUrls: getCodexRelayServerUrlCandidates().map((candidate) => candidate.url),
    clientToken: token,
  });
  storage.set(activeConnectionStorageKey, id);
  if (isLegacy) migrateLegacySecureSession();
}

export function getConnectionProfiles() {
  saveActiveConnection();
  return readProfiles();
}

export function saveConnectionProfile(input: { id?: string; name: string; serverUrl: string }) {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  saveActiveConnection();
  const existing = readProfiles().find((profile) => profile.id === input.id);
  const profile: ConnectionProfile = {
    id: existing?.id ?? `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: input.name.trim() || new URL(serverUrl).host,
    serverUrl,
    serverUrls: [...new Set([serverUrl, ...(existing?.serverUrls ?? [])])],
    clientToken: existing?.clientToken,
  };
  writeProfile(profile);
  return profile;
}

export function activateConnection(id: string) {
  if (id !== getActiveConnectionId()) saveActiveConnection();
  const profile = readProfiles().find((entry) => entry.id === id);
  if (!profile) throw new Error("找不到这个连接配置。");
  storage.set(activeConnectionStorageKey, id);
  setCodexRelayServerUrl(profile.serverUrl);
  saveCodexRelayServerUrlCandidates(profile.serverUrls);
  if (profile.clientToken) storage.set(tokenKey, profile.clientToken);
  else storage.remove(tokenKey);
  return profile;
}

export function prepareConnectionPairing(serverUrl: string) {
  saveActiveConnection();
  const profiles = readProfiles();
  const active = profiles.find((profile) => profile.id === getActiveConnectionId());
  // A manually added endpoint keeps its address when scanning the server's QR.
  if (active && !active.clientToken) return active.serverUrl;
  const existing = profiles.find((profile) => profile.serverUrls.includes(serverUrl));
  const target = existing ?? saveConnectionProfile({ name: "", serverUrl });
  activateConnection(target.id);
  return serverUrl;
}

export function forgetActiveConnection() {
  const id = getActiveConnectionId();
  storage.set(profilesKey, JSON.stringify(readProfiles().filter((profile) => profile.id !== id)));
  storage.remove(activeConnectionStorageKey);
}
