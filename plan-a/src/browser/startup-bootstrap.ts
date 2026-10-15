type Bootstrap = {
  statsigPayload: string;
  user: Record<string, any>;
  refresh?: () => Promise<Bootstrap>;
};

type BootstrapContext = {
  sdkKey: string;
  auth: { authMethod?: string; userId?: string; accountId?: string };
};

type CachedBootstrap = { key: string; savedAt: number; data: Bootstrap };
const maxAge = 24 * 60 * 60 * 1000;
const refreshAge = 5 * 60 * 1000;
let database: Promise<IDBDatabase | null> | undefined;

function openCache(): Promise<IDBDatabase | null> {
  return (database ??= new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open("codex-web-startup-v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("bootstrap");
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

async function readIdentity(): Promise<string | null> {
  try {
    const response = await fetch("/__backend/startup-identity", {
      cache: "no-store",
    });
    return response.ok ? (await response.json()).identity : null;
  } catch {
    return null;
  }
}

// Start with the small preload script, while the main UI modules download.
let initialIdentity: Promise<string | null> | undefined = readIdentity();

async function readCache(): Promise<CachedBootstrap | undefined> {
  const db = await openCache();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const request = db
      .transaction("bootstrap")
      .objectStore("bootstrap")
      .get("latest");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

async function saveCache(key: string, data: Bootstrap): Promise<void> {
  const db = await openCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction("bootstrap", "readwrite");
    transaction.objectStore("bootstrap").put(
      {
        key,
        savedAt: Date.now(),
        data: { statsigPayload: data.statsigPayload, user: data.user },
      },
      "latest",
    );
    transaction.oncomplete =
      transaction.onerror =
      transaction.onabort =
        () => resolve();
  });
}

export async function loadStatsigBootstrap(
  params: Record<string, unknown>,
  context: BootstrapContext,
  load: () => Promise<Bootstrap>,
  browserSession?: string,
): Promise<Bootstrap> {
  const { auth } = context;
  if (auth.authMethod !== "chatgpt") return load();
  const identityRequest = initialIdentity ?? readIdentity();
  initialIdentity = undefined;
  let identity = await identityRequest;
  if (!identity && auth.userId && auth.accountId)
    identity = JSON.stringify([auth.userId, auth.accountId]);
  if (!identity) return load();
  const key = JSON.stringify({
    params,
    sdkKey: context.sdkKey,
    identity,
  });
  const fresh = async () => {
    let data: Bootstrap;
    try {
      if (!browserSession) throw Error("No browser transport");
      const response = await fetch(
        `/__backend/startup-bootstrap?browserSession=${browserSession}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_session_id: params.appSessionId,
            app_version: params.appVersion,
            brand_name: "codex",
            build_flavor: params.buildFlavor,
            ...(params.beta ? { desktop_app_beta_enabled: true } : {}),
            locale: params.locale,
            stable_id: params.stableId,
            system_name: params.systemName,
            system_version: params.systemVersion,
            window_type: params.windowType,
          }),
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!response.ok) throw Error("Startup HTTP unavailable");
      data = await response.json();
    } catch {
      data = await load();
    }
    if (
      (!auth.userId || data.user.userID === auth.userId) &&
      (!auth.accountId || data.user.customIDs?.account_id === auth.accountId)
    ) {
      void saveCache(key, data).catch(() => undefined);
    }
    return data;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cached = await Promise.race([
    readCache().catch(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), 800);
    }),
  ]);
  clearTimeout(timer);
  if (
    cached?.key === key &&
    Date.now() - cached.savedAt < maxAge &&
    (!auth.userId || cached.data.user.userID === auth.userId) &&
    (!auth.accountId ||
      cached.data.user.customIDs?.account_id === auth.accountId)
  ) {
    return {
      ...cached.data,
      refresh: Date.now() - cached.savedAt >= refreshAge ? fresh : undefined,
    };
  }
  return fresh();
}

export async function publishStatsigEvaluations(
  value: unknown,
  browserSession: string,
  fallback: () => Promise<unknown>,
): Promise<unknown> {
  if (typeof CompressionStream === "undefined") return fallback();
  try {
    const stream = new Blob([JSON.stringify(value)])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    const body = await new Response(stream).arrayBuffer();
    const response = await fetch(
      `/__backend/startup-evaluations?browserSession=${browserSession}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "gzip",
        },
        body,
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw Error("Startup HTTP unavailable");
    return (await response.json()).result;
  } catch {
    return fallback();
  }
}

export function refreshStatsigBootstrap(client: any, data: Bootstrap): void {
  if (!data.refresh) return;
  const refresh = () => {
    void data.refresh!()
      .then((fresh) => {
        const current = client.getContext().user;
        if (
          current.userID !== fresh.user.userID ||
          current.customIDs?.account_id !== fresh.user.customIDs?.account_id
        )
          return;
        client.dataAdapter.setData(fresh.statsigPayload);
        client.updateUserSync(fresh.user, {
          disableBackgroundCacheRefresh: true,
        });
      })
      .catch(() => undefined);
  };
  setTimeout(() => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(refresh, { timeout: 30000 });
    else refresh();
  }, 10000);
}
