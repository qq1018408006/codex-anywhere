#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
export CODEX_RELAY_VARIANT=plan-b
export EXPO_PUBLIC_CODEX_RELAY_BUILD_VARIANT=plan-b
export EXPO_PUBLIC_CODEX_RELAY_SERVER_URL="${CODEX_RELAY_B_MOBILE_URL:-http://127.0.0.1:8787}"
export EXPO_PUBLIC_HOT_UPDATER_BASE_URL=
export EXPO_PUBLIC_HOT_UPDATER_API_KEY=
export HOT_UPDATER_API_KEY=
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
cd "$repo_dir/apps/mobile"
"$repo_dir/node_modules/.bin/expo" prebuild --platform android --no-install
cd android
proxy_args=()
export CODEX_RELAY_B_GRADLE_PROXY="${CODEX_RELAY_B_GRADLE_PROXY:-${HTTPS_PROXY:-}}"
if [[ -n "$CODEX_RELAY_B_GRADLE_PROXY" ]]; then
  mapfile -t proxy_info < <(python3 - <<'PY'
import os
from urllib.parse import urlparse
proxy = urlparse(os.environ['CODEX_RELAY_B_GRADLE_PROXY'])
if proxy.scheme == 'http' and proxy.hostname and not (proxy.username or proxy.password):
    print(proxy.hostname)
    print(proxy.port or 80)
PY
)
  if [[ ${#proxy_info[@]} == 2 ]]; then
    proxy_args=("-Dhttps.proxyHost=${proxy_info[0]}" "-Dhttps.proxyPort=${proxy_info[1]}"
      "-Dhttp.proxyHost=${proxy_info[0]}" "-Dhttp.proxyPort=${proxy_info[1]}"
      '-Dhttp.nonProxyHosts=localhost|127.*|[::1]')
  fi
fi
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=4 --console=plain "${proxy_args[@]}"
artifact_dir="$repo_dir/../artifacts"
mkdir -p "$artifact_dir"
cp app/build/outputs/apk/release/app-release.apk "$artifact_dir/codex-relay-b-arm64.apk"
(
  cd "$artifact_dir"
  sha256sum codex-relay-b-arm64.apk > SHA256SUMS
)
printf 'APK: %s\n' "$artifact_dir/codex-relay-b-arm64.apk"
