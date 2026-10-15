# Independent local Plan B

This branch deploys the gronxb/codex-relay implementation separately from an existing Codex or codex-web installation.

## Installation

Use the package manager pinned in `package.json`:

```bash
pnpm install --frozen-lockfile
pnpm --filter codex-relay build
python3 scripts/plan-b/install.py --start
node scripts/plan-b/public-artifacts.mjs
CODEX_RELAY_B_MOBILE_URL=http://<host-lan-ip>:8787 bash scripts/plan-b/build-android.sh
```

The installer creates only Plan B services, a private Codex home and two new launchers. It copies the current user's Codex login into the new home once; subsequent Plan B authentication and configuration are independent. It pins the checkout's Codex CLI, rather than replacing the normal `codex` executable.

New Plan B configurations disable the CLI startup update prompt so the isolated, pinned installation does not offer to update a global Codex binary.

| Component                      | Location                                    |
| ------------------------------ | ------------------------------------------- |
| Codex runtime                  | `codex-relay-b-runtime.service`             |
| Mobile API                     | `codex-relay-b.service`, port 8787          |
| APK and pairing page           | `codex-relay-b-download.service`, port 8788 |
| Codex data                     | `~/.local/share/codex-relay-b/codex-home`   |
| Relay data and pairing secrets | `~/.local/share/codex-relay-b/relay-state`  |
| Mobile package                 | `com.gronstudio.codexrelay.planb`           |
| Public artifacts               | `../artifacts/`                             |

## Terminal and phone

Start Plan B conversations with `codex-b` in the desired working directory, including when logged into this host over SSH. The launcher explicitly connects to Plan B's existing Unix socket. In the Android app, scan the QR from `codex-relay-b qr` or the download page, then approve the code locally:

```bash
codex-relay-b approve XXXX-XXXX
```

Mobile-created conversations can be opened on the computer with `codex-b resume <thread-id>`. The Plan B launcher also includes non-interactive sessions in `codex-b resume`, so mobile conversations appear in the picker. Use `codex-b resume --all` to include other working directories. The app lists CLI conversations, including running threads; its stream attachment resumes the thread on the same shared runtime.

On the tested Codex 0.159.2 runtime, wait for a new mobile conversation's first turn to complete before attaching the CLI. Attaching during that first turn can fail with `list_turns is not supported yet`; retry after completion. An idle mobile chat also needs a refresh or reopening to notice an externally started CLI turn, after which subsequent output streams live.

This independent deployment intentionally uses `codex-b`. Conversations created by the unchanged normal `codex`, Plan A, VS Code's Codex extension, or Desktop applications remain in their existing runtimes and do not automatically appear in Plan B. Remote hosts require their own deployment or an explicitly configured connection to this host. Port 8787 must be reachable from the phone.

The APK contains the JavaScript bundle and does not require a Metro server. It targets ARM64 and uses the generated local development signing key for local installation. Upstream OTA checks and the upstream EAS project association are disabled for the Plan B variant; updates are delivered by rebuilding and reinstalling the APK.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
CODEX_HOME="$HOME/.local/share/codex-relay-b/codex-home" \
  CODEX_RELAY_APP_SERVER_MODE=socket CODEX_RELAY_B_TEST=1 \
  pnpm --filter codex-relay exec vitest run plan-b-deployment.test.ts
```

The opt-in deployment test uses the running services, the mobile app's E2EE implementation, real CLI terminals, and real model turns. It verifies both directions of live conversation sharing, mobile input, interruption, authentication, and Relay-only restart behavior. It writes `../artifacts/live-validation.json`. Ordinary tests do not perform these live operations.

The Android JNI implementation `com.directfetch.HybridDirectFetch` is kept with `@Keep` and `@DoNotStrip`. Nitrogen instantiates it by class descriptor from C++, so a release shrinker can otherwise remove it even though the generated abstract specification survives, causing a startup `ClassNotFoundException`. Verify the release APK on a device after native packaging changes.

Shared-runtime request routing is patched so an unrelated stream cannot reject another thread's approval or a CLI-owned dynamic tool request. Private stdio mode retains its unsupported-request errors.

## Shared-runtime mobile send compatibility

When the optional `shared-runtime/` connection layer is installed, this Relay can
connect to the official managed daemon used by CLI, Desktop and Plan A. The
independent-runtime instructions above describe the original standalone setup.

The October 12 fix makes Auto mode use `on-request` approvals with
`workspace-write`, compatible with both the pinned CLI and managed daemon
0.162.1. Legacy API requests specifying `on-failure` are also mapped to
`on-request`; approvals are not disabled. The existing Android APK can use this
server-side fix without reinstalling or pairing again.

Streamed user messages stay pending until the daemon accepts `turn/start`. A
rejected resume or start marks the local message failed and removes its stream
notification listener, preventing a failed send from later looking successful.
Regression coverage is in `test/mobile-send-compatibility.test.ts`. Device and
shared-runtime verification are recorded in
`../artifacts/mobile-send-runtime-validation-2026-10-12.json`.

## Service management

```bash
systemctl --user status codex-relay-b.service codex-relay-b-runtime.service
systemctl --user restart codex-relay-b.service
journalctl --user -u codex-relay-b.service -n 60 --no-pager
```

Restarting only the Relay preserves the Codex runtime. Stopping the runtime ends its loaded live sessions, while saved histories remain in Plan B's private home. To stop the complete Plan B deployment:

```bash
systemctl --user stop codex-relay-b.service codex-relay-b-runtime.service codex-relay-b-download.service
```
