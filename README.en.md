# Codex Anywhere

English · [中文](README.md)

Share live Codex sessions across CLI, desktop, web, and Android through a shared runtime.

Tasks run on your computer. Use your phone or browser to follow live output, send instructions, handle approvals, and stop tasks. The two frontends retain independent builds and deployments; an optional shared-runtime layer connects them to the official Codex managed daemon.

| Directory | Purpose | Based on |
| --- | --- | --- |
| [plan-a](plan-a) | Browser frontend for desktop and mobile | [0xcaff/codex-web](https://github.com/0xcaff/codex-web) |
| [plan-b](plan-b) | Android app and local Relay server | [gronxb/codex-relay](https://github.com/gronxb/codex-relay) |
| [shared-runtime](shared-runtime) | Persistent connection layer for CLI, Linux Desktop, and A/B | New in this project |

The shared configuration connects all four clients to the same runtime and session directory. A/B can also run with separate runtimes. SSH sessions need a deployment on the remote host or an explicitly configured connection.

## Features

- Access the same live session from CLI, Linux Desktop, web, and Android, including sessions created on mobile.
- Keep the usual `codex` and `codex resume` commands, with user-level services and a Desktop launcher integration.
- Android connection profiles, incremental history loading, drag-to-load earlier messages, session pagination, and nested subagent sessions.
- Web reconnection, compressed and cached assets, deferred startup work, and send-path improvements.
- Reversible shared-runtime installation that preserves session data.

## Installation

The integrated setup currently targets **Linux with systemd user services**. Install Node.js 22.14+, Python 3.11+, a signed-in Codex CLI, and Linux ChatGPT/Codex Desktop. The CLI must support managed daemon, `--remote`, and `--no-daemon`, with `daemon_auto_start` enabled. The Desktop build must include app-tools. See the [runtime guide](shared-runtime/README.md) for version and packaging requirements.

```bash
git clone https://github.com/qq1018408006/codex-anywhere.git
cd codex-anywhere
```

If A/B are already installed, skip to step 3. You may install either frontend independently.

### 1. Install the web frontend

Also install `websocat`, `curl`, `unzip`, `patch`, and the tools needed to build native Node modules.

```bash
cd plan-a
npm ci
python3 scripts/install-services.py --access lan --port 8214
cd ..
```

`npm ci` downloads a pinned official Desktop archive, extracts and patches it locally, and builds the frontend and server. Allow several hundred MB of downloads and several GB of disk space. To reuse an existing archive, run `HOSTED_CODEX_APP_ZIP=/absolute/path/archive.zip npm ci`.

Leave out `--restart` until step 3. `--access lan` listens on `0.0.0.0:8214`; use `--access local` for loopback only.

### 2. Install Relay and build Android

Use the pnpm version pinned in `plan-b/package.json`, available through Corepack.

```bash
cd plan-b
corepack pnpm install --frozen-lockfile
corepack pnpm --filter codex-relay build
python3 scripts/plan-b/install.py --host 0.0.0.0 --port 8787
cd ..
```

With JDK 17 and Android SDK installed:

```bash
cd plan-b
bash scripts/plan-b/build-android.sh
cd ..
adb install -r artifacts/codex-relay-b-arm64.apk
```

The script produces an ARM64 APK named **Codex Relay B**. Preserve its local signing key for subsequent upgrades. Connection settings in the app let you change the Relay address, port, and profile without rebuilding.

### 3. Enable the shared runtime

Exit Desktop normally and let active tasks finish before switching:

```bash
./install.sh --check
./install.sh

# Start the frontends you installed; omit any service you did not install.
systemctl --user enable --now codex-web.service codex-relay-b.service
```

The root installer handles the shared-runtime connection layer; frontend dependencies and builds are installed in steps 1 and 2. It connects existing A/B services to the official daemon and disables their independent runtimes. For a different Desktop installation path, pass `--desktop /actual/path/ChatGPT`. See `python3 shared-runtime/manager.py --help` for other options.

Continue using the existing Desktop menu entry and CLI commands:

```bash
codex
codex resume --all
codex resume SESSION_ID
~/.local/bin/codex-runtime-share status
```

Open `http://HOST:8214` in a browser. Connect Android to Relay at `http://HOST:8787`, then pair and approve it from your computer:

```bash
~/.local/bin/codex-relay-b qr
~/.local/bin/codex-relay-b approve XXXX-XXXX
```

### Undo shared-runtime integration

Exit Desktop and let active tasks finish, then run:

```bash
./uninstall.sh
# Also available after removing this source checkout:
~/.local/bin/codex-runtime-share uninstall
```

This restores the previous launchers, service configuration, and runtime states. It keeps A/B installed and preserves authentication and sessions. Sessions created while sharing stay in the shared data directory; private Plan B histories are not automatically merged or copied.

## Network and compatibility

| Port | Purpose |
| --- | --- |
| 8214 | Plan A web frontend; supports `0.0.0.0` listening |
| 8787 | Plan B Relay with pairing and encryption |
| 9277 | Internal runtime gateway on `127.0.0.1` only |

For public access, put the frontends behind an authenticated HTTPS reverse proxy with WebSocket, compression, and caching support. Keep the internal runtime gateway local.

Compatibility depends on the installed Codex/Desktop versions. VS Code Remote-SSH keeps its existing runtime behavior and is not currently included in the shared runtime. Multiple clients can connect to a session; turn execution, concurrent input, approvals, and queuing follow the official runtime's rules.

## Development

Each frontend retains its own dependency tree and build commands. From the repository root, choose the relevant command:

```bash
(cd plan-a && npm test)
(cd plan-b && corepack pnpm test)
python3 -m unittest discover -s shared-runtime -p test_manager.py
node --test shared-runtime/test_adapter.mjs
```

Component READMEs retain upstream documentation; use this root README for this repository's deployment flow.

## Attribution and licenses

- Plan A is based on [0xcaff/codex-web](https://github.com/0xcaff/codex-web), continued through [qq1018408006/codex-web](https://github.com/qq1018408006/codex-web), under MIT. See [plan-a/LICENSE](plan-a/LICENSE).
- Plan B is based on [gronxb/codex-relay](https://github.com/gronxb/codex-relay), under Apache-2.0, with its original copyright and trademark notices retained.
- The shared-runtime layer and new orchestration code use Apache-2.0. Vendored `ws` retains its MIT license. See [NOTICE](NOTICE) for source revisions and modifications.

**Desktop UI resources:** Plan A downloads the official Desktop archive during installation, extracts its interface resources, and applies local patches. This repository contains adaptation code and patches; the extracted full interface and official application are not included in the source package. Rights to official resources remain with their owners and are not changed by this repository's MIT/Apache-2.0 notices. This is an independent community project, unaffiliated with OpenAI.
