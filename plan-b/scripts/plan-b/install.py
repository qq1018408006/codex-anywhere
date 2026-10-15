#!/usr/bin/env python3
"""Install this checkout as an independent, local Plan B deployment."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess


def unit_quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--download-port', type=int, default=8788)
    parser.add_argument('--start', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535 or not 1 <= args.download_port <= 65535:
        parser.error('port must be between 1 and 65535')
    repo = Path(__file__).resolve().parents[2]
    node = Path(shutil.which('node') or '').resolve()
    codex = repo / 'node_modules/@openai/codex/bin/codex.js'
    relay = repo / 'packages/codex-relay/dist/cli.js'
    for path in (node, codex, relay):
        if not path.is_file():
            raise SystemExit(f'Build and install dependencies first: missing {path}')
    home = Path.home()
    state = home / '.local/share/codex-relay-b'
    codex_home = state / 'codex-home'
    relay_home = state / 'relay-state'
    for path in (state, codex_home, relay_home):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.chmod(0o700)
    auth = codex_home / 'auth.json'
    original_auth = home / '.codex/auth.json'
    if not auth.exists() and original_auth.is_file():
        shutil.copyfile(original_auth, auth)
        auth.chmod(0o600)
    config = codex_home / 'config.toml'
    if not config.exists():
        config.write_text('check_for_update_on_startup = false\nmodel = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\n' + f'\n[projects.{json.dumps(str(repo), ensure_ascii=False)}]\ntrust_level = "trusted"\n')
        config.chmod(0o600)
    socket = codex_home / 'app-server-control/app-server-control.sock'
    units = home / '.config/systemd/user'
    units.mkdir(parents=True, exist_ok=True)
    env = {
        'CODEX_HOME': str(codex_home),
        'CODEX_RELAY_HOME': str(relay_home),
        'CODEX_RELAY_WORKSPACE_PATH': str(repo),
        'CODEX_RELAY_APP_SERVER_MODE': 'socket',
        'HOST': args.host,
        'PORT': str(args.port),
        'PATH': str(node.parent) + ':/usr/local/bin:/usr/bin:/bin',
    }
    env_lines = ''.join(f'Environment={unit_quote(k + "=" + v)}\n' for k, v in env.items())
    runtime_name = 'codex-relay-b-runtime.service'
    relay_name = 'codex-relay-b.service'
    runtime_unit = f'''[Unit]
Description=Codex Relay Plan B independent runtime
After=network.target

[Service]
Type=simple
WorkingDirectory={str(repo).replace('%', '%%')}
{env_lines}ExecStart={unit_quote(node)} {unit_quote(codex)} app-server --listen unix://
ExecStartPost=/usr/bin/python3 {unit_quote(repo / 'scripts/plan-b/wait-for-runtime.py')} {unit_quote(socket)}
Restart=on-failure
RestartSec=3
TimeoutStartSec=45
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
'''
    relay_unit = f'''[Unit]
Description=Codex Relay Plan B mobile server
Requires={runtime_name}
After=network.target {runtime_name}

[Service]
Type=simple
WorkingDirectory={str(repo).replace('%', '%%')}
{env_lines}ExecStart={unit_quote(node)} {unit_quote(relay)} --shared-app-server
Restart=on-failure
RestartSec=3
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=default.target
'''
    (units / runtime_name).write_text(runtime_unit)
    (units / relay_name).write_text(relay_unit)
    artifact_dir = repo.parent / 'artifacts'
    artifact_dir.mkdir(parents=True, exist_ok=True)
    download_name = 'codex-relay-b-download.service'
    (units / download_name).write_text(f'''[Unit]
Description=Codex Relay Plan B APK and pairing page
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 -m http.server {args.download_port} --bind {unit_quote(args.host)} --directory {unit_quote(artifact_dir)}
Restart=on-failure
RestartSec=3
UMask=0077

[Install]
WantedBy=default.target
''')
    bin_dir = home / '.local/bin'
    bin_dir.mkdir(parents=True, exist_ok=True)
    launcher = f'''#!/usr/bin/env bash
set -euo pipefail
export CODEX_HOME={shlex.quote(str(codex_home))}
export PATH={shlex.quote(str(node.parent))}:"$PATH"
runtime_name={shlex.quote(runtime_name)}
node_bin={shlex.quote(str(node))}
codex_script={shlex.quote(str(codex))}
socket_path={shlex.quote(str(socket))}
case "${{1:-}}" in
  -h|--help|-V|--version|exec|e|review|login|logout|mcp|plugin|app-server|remote-control|completion|update|doctor|sandbox|debug|apply|a|queue|archive|delete|migrate-rollouts|unarchive|cloud|exec-server|features|help|agents)
    exec "$node_bin" "$codex_script" "$@" ;;
  resume|fork)
    subcommand="$1"
    shift
    if [[ "$subcommand" == resume ]]; then
      include_mobile=true
      for argument in "$@"; do
        [[ "$argument" != --include-non-interactive ]] || include_mobile=false
      done
      if [[ "$include_mobile" == true ]]; then
        set -- --include-non-interactive "$@"
      fi
    fi
    systemctl --user start "$runtime_name"
    exec "$node_bin" "$codex_script" "$subcommand" --remote "unix://$socket_path" "$@" ;;
esac
systemctl --user start "$runtime_name"
exec "$node_bin" "$codex_script" --remote "unix://$socket_path" "$@"
'''
    launcher_path = bin_dir / 'codex-b'
    launcher_path.write_text(launcher)
    launcher_path.chmod(0o755)
    relay_launcher_path = bin_dir / 'codex-relay-b'
    relay_launcher_path.write_text(f'''#!/usr/bin/env bash
set -euo pipefail
export CODEX_HOME={shlex.quote(str(codex_home))}
export CODEX_RELAY_HOME={shlex.quote(str(relay_home))}
export PATH={shlex.quote(str(node.parent))}:"$PATH"
if [[ $# == 0 ]]; then
  systemctl --user start codex-relay-b.service
  exec {shlex.quote(str(node))} {shlex.quote(str(relay))} qr
fi
if [[ "$1" == stop ]]; then
  exec systemctl --user stop codex-relay-b.service
fi
exec {shlex.quote(str(node))} {shlex.quote(str(relay))} "$@"
''')
    relay_launcher_path.chmod(0o755)
    version = subprocess.check_output([str(node), str(codex), '--version'], text=True).strip()
    manifest = {
        'checkout': str(repo), 'node': str(node), 'codexVersion': version,
        'codexHome': str(codex_home), 'relayHome': str(relay_home),
        'socket': str(socket), 'host': args.host, 'port': args.port,
        'services': [runtime_name, relay_name, download_name], 'launcher': str(launcher_path),
        'relayLauncher': str(relay_launcher_path),
        'downloadPort': args.download_port, 'artifacts': str(artifact_dir),
        'upstreamCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(),
    }
    (state / 'deployment.json').write_text(json.dumps(manifest, indent=2) + '\n')
    subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
    if args.start:
        subprocess.run(['systemctl', '--user', 'enable', '--now', relay_name], check=True)
        subprocess.run(['systemctl', '--user', 'enable', '--now', download_name], check=True)
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
