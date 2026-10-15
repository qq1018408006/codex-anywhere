export const defaultNetworkRequestTimeoutMs = 15_000;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Request timed out.")), timeoutMs);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

export function requestWithNetworkTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  defaultTimeoutMs = defaultNetworkRequestTimeoutMs,
) {
  const resolvedTimeoutMs = timeoutMs ?? defaultTimeoutMs;
  return resolvedTimeoutMs > 0 ? withTimeout(promise, resolvedTimeoutMs) : promise;
}
