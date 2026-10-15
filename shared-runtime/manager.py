#!/usr/bin/env python3
"""Install and remove a user-level connection layer around official Codex binaries."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.request

SOURCE = Path(__file__).resolve().parent
VERSION = '0.1.1'
TOOL_ENV = ('CODEX_APP_TOOLS_PIPE_PATH', 'CODEX_MCP_NODE_PATH')
SHARED_FEATURES = ('api_key_model_discovery', 'auth_elicitation',
                   'code_mode_host', 'mcp_oauth_refresh_coordination')


class BusyError(RuntimeError):
    pass


def run(argv, *, env=None, check=True, timeout=60):
    result = subprocess.run([str(x) for x in argv], env=env, text=True,
                            capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f'{argv[0]}: {result.stderr.strip() or result.stdout.strip()}')
    return result


def atomic_write(path, content, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, 'wb') as output:
            output.write(content.encode() if isinstance(content, str) else content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save_json(path, data):
    atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def snapshot(path):
    path = Path(path)
    if path.is_symlink():
        return {'kind': 'symlink', 'target': os.readlink(path)}
    if not path.exists():
        return {'kind': 'missing'}
    if not path.is_file():
        raise RuntimeError(f'Refusing to replace a non-file: {path}')
    return {'kind': 'file', 'mode': stat.S_IMODE(path.stat().st_mode),
            'content': base64.b64encode(path.read_bytes()).decode()}


def restore_snapshot(path, original):
    path = Path(path)
    if original['kind'] == 'file':
        atomic_write(path, base64.b64decode(original['content']), original['mode'])
    elif original['kind'] == 'symlink':
        temporary = path.with_name(path.name + '.restore')
        if temporary.exists() or temporary.is_symlink():
            temporary.unlink()
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary.symlink_to(original['target'])
        os.replace(temporary, path)
    elif path.exists() or path.is_symlink():
        path.unlink()


def load_manifest(state_dir):
    return json.loads((Path(state_dir) / 'manifest.json').read_text())


def write_owned(manifest, path, content, mode=0o600):
    record = {'path': str(path), 'before': snapshot(path), 'installed': None}
    manifest['files'].append(record)
    save_json(Path(manifest['state']) / 'manifest.json', manifest)
    atomic_write(path, content, mode)
    record['installed'] = snapshot(path)
    save_json(Path(manifest['state']) / 'manifest.json', manifest)


def daemon_env(config, tool_values=None):
    env = dict(os.environ)
    env.update(HOME=config['userHome'], CODEX_HOME=config['codexHome'])
    if config.get('node'):
        node_directory = str(Path(config['node']).parent)
        entries = env.get('PATH', os.defpath).split(os.pathsep)
        if node_directory not in entries:
            env['PATH'] = os.pathsep.join([node_directory, *entries])
    for key in ('CODEX_APP_SERVER_WS_URL', 'CODEX_APP_SERVER_FORCE_CLI', 'CODEX_CLI_PATH',
                'CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_VERSION',
                'CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_PACKAGE_ROOT'):
        env.pop(key, None)
    values = tool_values if tool_values is not None else {
        'CODEX_APP_TOOLS_PIPE_PATH': config['toolsPipe'], 'CODEX_MCP_NODE_PATH': config['mcpNode']}
    for key in TOOL_ENV:
        if values.get(key) is None:
            env.pop(key, None)
        else:
            env[key] = values[key]
    return env


def daemon_process(config):
    expected = config['codexHome'].encode()
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            args = (proc / 'cmdline').read_bytes().split(b'\0')
            if b'--managed-daemon' not in args:
                continue
            env = dict(x.split(b'=', 1) for x in (proc / 'environ').read_bytes().split(b'\0') if b'=' in x)
            effective_home = env.get(b'CODEX_HOME') or os.fsencode(os.path.join(os.fsdecode(env.get(b'HOME', b'')), '.codex'))
            if effective_home != expected:
                continue
            return {'pid': int(proc.name), 'remoteControl': b'--remote-control' in args,
                    'toolEnv': {k: env.get(k.encode(), b'').decode() or None for k in TOOL_ENV}}
        except OSError:
            continue
    return None


def inspect_runtime(config, socket_path=None, required=False):
    result = run([config['node'], config['package'] + '/adapter.mjs', 'inspect',
                  socket_path or config['socket']], check=False)
    if result.returncode:
        if required:
            raise RuntimeError(result.stderr.strip() or 'Cannot inspect runtime')
        return None
    return json.loads(result.stdout)


def require_idle(config, socket_path=None):
    status = inspect_runtime(config, socket_path, required=True)
    if status['busy']:
        raise BusyError('Runtime has running work; switching was not performed: ' +
                        ', '.join(t['id'] for t in status['busy']))


def daemon_command(config, command, env=None, remote_control=False):
    # Daemon start retains its own persisted remote-control setting. The separate
    # remote-control start command also waits for cloud connectivity and can fail
    # even though the local runtime started successfully.
    args = [config['codex'], 'app-server', 'daemon', command]
    previous = daemon_process(config) if command == 'stop' else None
    result = run(args, env=env or daemon_env(config), timeout=120)
    if previous:
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            current = daemon_process(config)
            if not current or current['pid'] != previous['pid']:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError('Official daemon stop did not finish; refusing to race its replacement')
    return result


def cli_shared_features(config):
    output = run([config['codex'], 'features', 'list'], env=daemon_env(config)).stdout
    features = {}
    for line in output.splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[0] in SHARED_FEATURES and fields[-1] in ('true', 'false'):
            features[fields[0]] = fields[-1] == 'true'
    missing = set(SHARED_FEATURES) - features.keys()
    if missing:
        raise RuntimeError('CLI cannot report shared feature settings: ' + ', '.join(sorted(missing)))
    return features


def reconcile_shared_features(config):
    # The official live enablement RPC updates runtime state, not config.toml.
    # Managed daemon releases can have different defaults from the installed CLI.
    # Its settings.json featureOverrides field is not retained by every release.
    policy = config.get('sharedFeaturePolicy') or cli_shared_features(config)
    result = run([config['node'], config['package'] + '/adapter.mjs', 'features',
                  config['socket'], json.dumps(policy)], timeout=60)
    return json.loads(result.stdout)


def ensure_daemon(config):
    publish_tool_route(config)
    existing = daemon_process(config)
    expected = {'CODEX_APP_TOOLS_PIPE_PATH': config['toolsPipe'], 'CODEX_MCP_NODE_PATH': config['mcpNode']}
    if existing and existing['toolEnv'] == expected and inspect_runtime(config):
        reconcile_shared_features(config)
        return
    if existing and existing['toolEnv'] != expected:
        require_idle(config)
        daemon_command(config, 'stop')
    daemon_command(config, 'start', remote_control=bool(existing and existing['remoteControl']))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if inspect_runtime(config):
            reconcile_shared_features(config)
            return
        time.sleep(0.2)
    raise RuntimeError('Official daemon did not become ready')


def live_tool_socket(path):
    try:
        if not path.is_socket() or path.stat().st_uid != os.getuid(): return False
        with socket.socket(socket.AF_UNIX) as connection:
            connection.settimeout(0.2)
            connection.connect(str(path))
        return True
    except OSError:
        return False


def publish_tool_route(config):
    target = None
    record_path = Path(config['state']) / 'desktop-tools-target.json'
    if record_path.exists():
        item = json.loads(record_path.read_text())
        candidate = Path(item['socket'])
        proc = Path('/proc') / str(item['pid'])
        if candidate.parent == Path('/tmp/codex-browser-use') and live_tool_socket(candidate) and proc.exists() and \
                (proc / 'stat').read_text().split()[21] == item['startTime']:
            target = candidate
    fallback = Path(config.get('planAToolsPipe', config['state'] + '/plan-a-tools.sock'))
    if target is None and live_tool_socket(fallback):
        target = fallback
    stable = Path(config['toolsPipe'])
    if stable.exists() and not stable.is_symlink():
        raise RuntimeError('Tool route must be an installer-owned symlink: ' + str(stable))
    if target is None:
        if stable.is_symlink(): stable.unlink()
        return
    if stable.is_symlink() and os.readlink(stable) == str(target): return
    temporary = stable.with_name(stable.name + '.next')
    if temporary.exists() or temporary.is_symlink(): temporary.unlink()
    temporary.symlink_to(target)
    os.replace(temporary, stable)


def systemctl(config, *args, check=True):
    return run(['systemctl', '--user', *args], check=check)


def service_snapshot(config, name):
    result = systemctl(config, 'show', name, '-p', 'LoadState', '-p', 'ActiveState',
                       '-p', 'UnitFileState', '-p', 'Environment', '-p', 'FragmentPath',
                       '-p', 'DropInPaths', check=False)
    info = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if info.get('LoadState') == 'not-found' or not info:
        return None
    environment = {}
    for item in shlex.split(info.get('Environment', '')):
        if '=' in item:
            key, value = item.split('=', 1)
            environment[key] = value
    return {'name': name, 'active': info.get('ActiveState') == 'active',
            'enabled': info.get('UnitFileState') == 'enabled', 'environment': environment,
            'fragment': info.get('FragmentPath'), 'dropins': shlex.split(info.get('DropInPaths', ''))}


def remove_runtime_dependency(contents, runtime):
    # Dependency lists cannot be cleared through an empty drop-in assignment.
    # Override the user unit, preserving every other setting and dependency.
    if re.search(r'\\\s*\n', contents):
        raise RuntimeError('Multiline service directives require a reviewed service adapter')
    return re.sub(r'^(Requires|Wants|After|BindsTo|PartOf)=(.*)$',
                  lambda m: m[1] + '=' + ' '.join(x for x in m[2].split() if x != runtime),
                  contents, flags=re.M)


def desktop_processes(config):
    expected = str(Path(config['desktop']).resolve())
    found = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if str((proc / 'exe').resolve()) != expected:
                continue
            args = (proc / 'cmdline').read_bytes().replace(b'\0', b' ').decode()
            if '--type=' in args:
                continue
            if config.get('desktopProfile'):
                if '--user-data-dir=' + config['desktopProfile'] not in args:
                    continue
            elif '--user-data-dir=' in args:
                continue
            found.append(int(proc.name))
        except OSError:
            continue
    return found


def check_frontends_closed(config):
    processes = desktop_processes(config)
    if processes:
        raise BusyError('Please exit Desktop normally before switching; no process was killed. PID: ' +
                        ', '.join(map(str, processes)))


def desktop_quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$') + '"'


def unit_quote(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%') + '"'


def discover(args):
    user_home = Path(args.home or Path.home()).expanduser().resolve()
    instance = args.instance
    if not re.fullmatch(r'[a-z0-9-]{1,40}', instance):
        raise RuntimeError('Instance name must contain lowercase letters, digits, or hyphens')
    name = 'codex-runtime-share' + ('' if instance == 'default' else '-' + instance)
    state = Path(args.state or user_home / '.local/state' / name).resolve()
    data = user_home / '.local/share' / name
    desktop = Path(args.desktop or shutil.which('chatgpt') or '/usr/lib/chatgpt/ChatGPT').resolve()
    # Distribution launchers exec the ELF; /proc/exe must match the actual application.
    if desktop.name == 'codex-launcher' and (desktop.parent / 'ChatGPT').exists():
        desktop = (desktop.parent / 'ChatGPT').resolve()
    resources = desktop.parent / 'resources'
    codex = args.codex or shutil.which('codex')
    node = args.node or shutil.which('node') or str(resources / 'cua_node/bin/node')
    for executable in (desktop, codex, node):
        if not executable or not os.access(executable, os.X_OK):
            raise RuntimeError(f'Missing executable: {executable}')
    help_text = run([codex, '--help']).stdout
    if '--remote' not in help_text or '--no-daemon' not in help_text:
        raise RuntimeError('Install a Codex CLI version supporting daemon and --remote first')
    run([codex, 'app-server', 'daemon', '--help'])
    mcp_node = resources / 'cua_node/bin/node'
    if not mcp_node.exists():
        mcp_node = Path(node)
    if not (resources / 'plugins/openai-bundled/plugins/codex-app-tools/server.mjs').exists():
        raise RuntimeError('Desktop installation lacks the tested native app-tools package')
    codex_home = Path(args.codex_home or os.environ.get('CODEX_HOME', user_home / '.codex')).resolve()
    config = {'version': VERSION, 'name': name, 'userHome': str(user_home), 'state': str(state),
              'package': str(data / 'package'), 'codexHome': str(codex_home),
              'socket': str(codex_home / 'app-server-control/app-server-control.sock'),
              'toolsPipe': str(state / 'desktop-tools.sock'), 'planAToolsPipe': str(state / 'plan-a-tools.sock'),
              'node': str(Path(node).absolute()), 'python': sys.executable,
              'mcpNode': str(mcp_node), 'codex': str(Path(codex).absolute()),
              'desktop': str(desktop), 'desktopProfile': args.desktop_profile,
              'port': args.port, 'systemd': not args.no_systemd,
              'serviceDir': str(Path(args.service_dir or user_home / '.config/systemd/user').resolve()),
              'planAUnit': args.plan_a_unit, 'planARuntime': args.plan_a_runtime,
              'planBUnit': args.plan_b_unit, 'planBRuntime': args.plan_b_runtime}
    config['sharedFeaturePolicy'] = cli_shared_features(config)
    return config


def launcher(config, command):
    return '#!/bin/sh\nset -eu\nexec ' + ' '.join(shlex.quote(x) for x in [
        sys.executable, config['package'] + '/manager.py', command,
        '--state', config['state']]) + ' -- "$@"\n'


def control_launcher(config):
    executable = ' '.join(shlex.quote(x) for x in [sys.executable, config['package'] + '/manager.py'])
    return ('#!/bin/sh\nset -eu\ncommand_name=${1:-status}\n'
            'if [ "$#" -gt 0 ]; then\n  shift\nfi\nexec ' + executable +
            ' "$command_name" --state ' + shlex.quote(config['state']) + ' "$@"\n')


def restore_daemon(config, before):
    current = daemon_process(config)
    if current:
        require_idle(config)
        daemon_command(config, 'stop')
    if before:
        daemon_command(config, 'start', daemon_env(config, before['toolEnv']), before['remoteControl'])


def restore_files(manifest):
    preserved = []
    for record in reversed(manifest['files']):
        path = Path(record['path'])
        current = snapshot(path)
        if current != record.get('installed') and current != record['before'] and current['kind'] != 'missing':
            location = Path(manifest['state']) / 'preserved' / hashlib.sha256(str(path).encode()).hexdigest()
            save_json(location.with_suffix('.json'), {'path': str(path), 'modified': current})
            preserved.append(str(path))
        restore_snapshot(path, record['before'])
    return preserved


def start_gateway(config):
    if config['systemd']:
        systemctl(config, 'daemon-reload')
        systemctl(config, 'enable', '--now', config['name'] + '.service')
    else:
        log = open(Path(config['state']) / 'adapter.log', 'ab', buffering=0)
        child = subprocess.Popen([sys.executable, config['package'] + '/manager.py', 'serve',
                                  '--state', config['state']], stdout=log, stderr=log, start_new_session=True)
        log.close()
        save_json(Path(config['state']) / 'adapter-process.json', {'pid': child.pid,
                  'startTime': Path(f'/proc/{child.pid}/stat').read_text().split()[21]})
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{config["port"]}/healthz', timeout=5) as response:
                if response.status == 200:
                    return
        except (OSError, TimeoutError):
            pass
        time.sleep(0.2)
    raise RuntimeError('Shared connection service did not become ready')


def stop_gateway(config):
    if config['systemd']:
        systemctl(config, 'disable', '--now', config['name'] + '.service', check=False)
    else:
        record = Path(config['state']) / 'adapter-process.json'
        if record.exists():
            item = json.loads(record.read_text())
            proc = Path('/proc') / str(item['pid'])
            if proc.exists() and (proc / 'stat').read_text().split()[21] == item['startTime']:
                os.killpg(item['pid'], signal.SIGTERM)
                deadline = time.monotonic() + 10
                while proc.exists() and time.monotonic() < deadline:
                    time.sleep(0.1)


def restore_services(config, states):
    if not config['systemd']:
        return
    systemctl(config, 'daemon-reload')
    for item in states:
        systemctl(config, 'enable' if item['enabled'] else 'disable', item['name'], check=False)
    for item in states:
        if item['active']:
            systemctl(config, 'start', item['name'])
        else:
            systemctl(config, 'stop', item['name'], check=False)


def install(args):
    config = discover(args)
    state = Path(config['state'])
    manifest_path = state / 'manifest.json'
    if manifest_path.exists():
        previous = load_manifest(state)
        if previous['phase'] == 'installed':
            print(json.dumps({'status': 'already-installed', 'state': str(state)})); return
        if previous['phase'] != 'uninstalled':
            raise RuntimeError('An interrupted installation exists; run uninstall to restore it first')
        shutil.copyfile(manifest_path, state / ('manifest.previous-' + str(time.time_ns()) + '.json'))
    check_frontends_closed(config)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', config['port']))
    config['package'] = str(SOURCE)  # preflight uses the source before installation
    before_daemon = daemon_process(config)
    if before_daemon:
        require_idle(config)
    feature_text = run([config['codex'], 'features', 'list'], env=daemon_env(config)).stdout
    if not re.search(r'^daemon_auto_start\s+\S+\s+true$', feature_text, re.M):
        raise RuntimeError('daemon_auto_start must be enabled for an unmodified interactive CLI')
    services = []
    if config['systemd']:
        for name in (config['planAUnit'], config['planARuntime'], config['planBUnit'], config['planBRuntime']):
            if name:
                item = service_snapshot(config, name)
                if item:
                    services.append(item)
        for item in services:
            if item['name'] in (config['planAUnit'], config['planBUnit']):
                old_runtime = config['planARuntime'] if item['name'] == config['planAUnit'] else config['planBRuntime']
                remove_runtime_dependency(Path(item['fragment']).read_text(), old_runtime)
                for dropin in item['dropins']:
                    contents = Path(dropin).read_text()
                    if remove_runtime_dependency(contents, old_runtime) != contents:
                        raise RuntimeError(f'Existing drop-in depends on the old runtime: {dropin}')
            if item['active'] and item['name'] in (config['planARuntime'], config['planBRuntime']):
                environment = item['environment']
                old_socket = environment.get('CODEX_UNIX_SOCKET') or str(Path(environment.get('CODEX_HOME', config['codexHome'])) / 'app-server-control/app-server-control.sock')
                require_idle(config, old_socket)
    config['package'] = str(Path(config['userHome']) / '.local/share' / config['name'] / 'package')
    if args.check:
        print(json.dumps({'status': 'ready', 'config': config, 'services': services,
                          'daemonAlreadyRunning': bool(before_daemon)}, ensure_ascii=False, indent=2)); return
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state, 0o700)
    target = Path(config['package'])
    if target.exists():
        raise RuntimeError(f'Installation directory already exists: {target}')
    manifest = {'version': VERSION, 'state': str(state), 'phase': 'installing',
                'config': config, 'files': [], 'services': services, 'daemonBefore': before_daemon}
    save_json(manifest_path, manifest)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(SOURCE, target, ignore=shutil.ignore_patterns('artifacts', '__pycache__', '*.log'))
        save_json(state / 'config.json', config)
        binary_dir = Path(config['userHome']) / '.local/bin'
        desktop_launcher = binary_dir / (config['name'] + '-desktop')
        write_owned(manifest, desktop_launcher, launcher(config, 'desktop'), 0o755)
        write_owned(manifest, binary_dir / config['name'], control_launcher(config), 0o755)
        for name, command in (('codex-runtime-proxy', 'proxy'), ('codex-runtime-client', 'runtime-client')):
            write_owned(manifest, target.parent / name, launcher(config, command), 0o755)
        desktop_entry = Path(config['userHome']) / '.local/share/applications/chatgpt.desktop'
        template = desktop_entry if desktop_entry.exists() else Path('/usr/share/applications/chatgpt.desktop')
        contents = template.read_text() if template.exists() else '[Desktop Entry]\nName=ChatGPT\nType=Application\nIcon=chatgpt\nExec=chatgpt %U\n'
        contents = re.sub(r'^Exec=.*$', 'Exec=' + desktop_quote(desktop_launcher) + ' %U', contents, count=1, flags=re.M)
        write_owned(manifest, desktop_entry, contents, 0o644)
        if config['systemd']:
            unit = '[Unit]\nDescription=Shared Codex connection adapter\nAfter=network.target\n\n[Service]\nType=simple\n' + \
                'Environment=' + unit_quote('HOME=' + config['userHome']) + '\n' + \
                'ExecStart=' + ' '.join(unit_quote(x) for x in [sys.executable, config['package'] + '/manager.py', 'serve', '--state', config['state']]) + \
                '\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=20\nUMask=0077\n\n[Install]\nWantedBy=default.target\n'
            write_owned(manifest, Path(config['serviceDir']) / (config['name'] + '.service'), unit, 0o644)
            for item in services:
                if item['name'] not in (config['planAUnit'], config['planBUnit']):
                    continue
                old_runtime = config['planARuntime'] if item['name'] == config['planAUnit'] else config['planBRuntime']
                contents = remove_runtime_dependency(Path(item['fragment']).read_text(), old_runtime)
                write_owned(manifest, Path(config['serviceDir']) / item['name'], contents, 0o644)
                dropin = '[Unit]\nRequires=' + config['name'] + '.service\nAfter=' + config['name'] + '.service\n\n[Service]\n'
                environment = {'CODEX_HOME': config['codexHome']}
                if item['name'] == config['planAUnit']:
                    environment.update(CODEX_UNIX_SOCKET=config['socket'], CODEX_CLI_PATH=str(target.parent / 'codex-runtime-proxy'),
                                       CODEX_SHARED_TOOLS_PIPE_PATH=config['planAToolsPipe'])
                else:
                    environment.update(CODEX_RELAY_APP_SERVER_MODE='socket', CODEX_BIN=str(target.parent / 'codex-runtime-client'))
                dropin += ''.join('Environment=' + unit_quote(k + '=' + v) + '\n' for k, v in environment.items())
                write_owned(manifest, Path(config['serviceDir']) / (item['name'] + '.d') / '90-codex-runtime-share.conf', dropin, 0o644)
                cli_name = 'codex-shared' if item['name'] == config['planAUnit'] else 'codex-b'
                write_owned(manifest, binary_dir / cli_name, launcher(config, 'cli'), 0o755)
            for item in services:
                if item['name'] in (config['planAUnit'], config['planBUnit']):
                    systemctl(config, 'stop', item['name'])
            for item in services:
                if item['name'] in (config['planARuntime'], config['planBRuntime']):
                    systemctl(config, 'disable', '--now', item['name'])
        ensure_daemon(config)
        start_gateway(config)
        if config['systemd']:
            for item in services:
                if item['active'] and item['name'] in (config['planAUnit'], config['planBUnit']):
                    systemctl(config, 'start', item['name'])
        manifest['phase'] = 'installed'
        save_json(manifest_path, manifest)
        print(json.dumps({'status': 'installed', 'state': str(state), 'desktopLauncher': str(desktop_launcher),
                          'gateway': f'ws://127.0.0.1:{config["port"]}'}, ensure_ascii=False))
    except BaseException:
        stop_gateway(config)
        restore_files(manifest)
        restore_daemon(config, before_daemon)
        restore_services(config, services)
        manifest['phase'] = 'uninstalled'
        save_json(manifest_path, manifest)
        if target.exists():
            shutil.rmtree(target)
        raise


def uninstall(args):
    manifest = load_manifest(args.state)
    if manifest['phase'] == 'uninstalled':
        print(json.dumps({'status': 'already-uninstalled'})); return
    config = manifest['config']
    check_frontends_closed(config)
    if daemon_process(config):
        require_idle(config)
    if config['systemd']:
        for item in manifest['services']:
            if item['name'] in (config['planAUnit'], config['planBUnit']):
                systemctl(config, 'stop', item['name'], check=False)
    stop_gateway(config)
    manifest['phase'] = 'uninstalling'
    save_json(Path(config['state']) / 'manifest.json', manifest)
    preserved = restore_files(manifest)
    restore_daemon(config, manifest['daemonBefore'])
    restore_services(config, manifest['services'])
    manifest['phase'] = 'uninstalled'
    manifest['preservedModifiedFiles'] = preserved
    save_json(Path(config['state']) / 'manifest.json', manifest)
    shutil.rmtree(config['package'])
    print(json.dumps({'status': 'uninstalled', 'sessionDataKept': config['codexHome'],
                      'preservedModifiedFiles': preserved}, ensure_ascii=False))


def desktop(args, config):
    existing = desktop_processes(config)
    if existing:
        record = Path(config['state']) / 'desktop-process.json'
        item = json.loads(record.read_text()) if record.exists() else {}
        proc = Path('/proc') / str(item.get('pid', 0))
        if item.get('pid') in existing and proc.exists() and \
                (proc / 'stat').read_text().split()[21] == item.get('startTime'):
            # Native single-instance handling focuses the already shared application.
            focus_env = daemon_env(config)
            focus_env['CODEX_APP_SERVER_WS_URL'] = f'ws://127.0.0.1:{config["port"]}'
            focus_args = [config['desktop'], *args.remainder]
            if config.get('desktopProfile'):
                focus_env['CODEX_ELECTRON_USER_DATA_PATH'] = config['desktopProfile']
                focus_args.append('--user-data-dir=' + config['desktopProfile'])
            return run(focus_args, env=focus_env, check=False).returncode
        raise BusyError('Desktop is already running; exit it normally and launch the shared entry again')
    if config['systemd']:
        systemctl(config, 'start', config['name'] + '.service')
    env = daemon_env(config)
    env['CODEX_APP_SERVER_WS_URL'] = f'ws://127.0.0.1:{config["port"]}'
    env.pop('CODEX_APP_SERVER_USE_LOCAL_DAEMON', None)
    if config.get('desktopProfile'):
        env['CODEX_ELECTRON_USER_DATA_PATH'] = config['desktopProfile']
    command = [config['desktop'], *args.remainder]
    if config.get('desktopProfile'):
        command.append('--user-data-dir=' + config['desktopProfile'])
    log = open(Path(config['state']) / 'desktop.log', 'ab', buffering=0)
    child = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    save_json(Path(config['state']) / 'desktop-process.json', {'pid': child.pid,
              'startTime': Path(f'/proc/{child.pid}/stat').read_text().split()[21]})
    try:
        for line in child.stdout:
            log.write(line)
            match = re.search(rb'dynamic_app_tools_listening pipePath=([^\s]+)', line)
            if match:
                pipe = Path(match[1].decode())
                if pipe.parent != Path('/tmp/codex-browser-use') or not pipe.is_socket() or pipe.stat().st_uid != os.getuid():
                    raise RuntimeError('Desktop reported an unexpected tool socket')
                save_json(Path(config['state']) / 'desktop-tools-target.json', {'socket': str(pipe),
                          'pid': child.pid, 'startTime': Path(f'/proc/{child.pid}/stat').read_text().split()[21]})
                publish_tool_route(config)
        return child.wait()
    finally:
        log.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['install', 'uninstall', 'status', 'serve', 'ensure', 'desktop', 'cli', 'proxy', 'runtime-client'])
    parser.add_argument('--state')
    parser.add_argument('--home')
    parser.add_argument('--codex-home')
    parser.add_argument('--codex')
    parser.add_argument('--node')
    parser.add_argument('--desktop')
    parser.add_argument('--desktop-profile')
    parser.add_argument('--instance', default='default')
    parser.add_argument('--port', type=int, default=9277)
    parser.add_argument('--no-systemd', action='store_true')
    parser.add_argument('--service-dir')
    parser.add_argument('--plan-a-unit', default='codex-web.service')
    parser.add_argument('--plan-a-runtime', default='codex-shared.service')
    parser.add_argument('--plan-b-unit', default='codex-relay-b.service')
    parser.add_argument('--plan-b-runtime', default='codex-relay-b-runtime.service')
    parser.add_argument('--check', action='store_true')
    args, remainder = parser.parse_known_args()
    args.remainder = remainder[1:] if remainder[:1] == ['--'] else remainder
    if args.command == 'install':
        install(args); return 0
    args.state = args.state or str(Path.home() / '.local/state/codex-runtime-share')
    if args.command == 'uninstall':
        uninstall(args); return 0
    config = load_manifest(args.state)['config']
    if args.command == 'ensure':
        ensure_daemon(config)
        return 0
    if args.command == 'serve':
        ensure_daemon(config)
        os.execve(config['node'], [config['node'], config['package'] + '/adapter.mjs', 'serve', config['state'] + '/config.json'], daemon_env(config))
    if args.command == 'desktop':
        return desktop(args, config)
    if args.command == 'status':
        with urllib.request.urlopen(f'http://127.0.0.1:{config["port"]}/healthz', timeout=20) as response:
            print(response.read().decode())
        return 0
    if args.command == 'runtime-client':
        if 'app-server' in args.remainder:
            raise RuntimeError('Shared daemon unavailable; refusing to start a second runtime')
        os.execve(config['codex'], [config['codex'], *args.remainder], daemon_env(config))
    if args.command == 'proxy':
        if 'app-server' not in args.remainder:
            os.execve(config['codex'], [config['codex'], *args.remainder], daemon_env(config))
        os.execve(config['node'], [config['node'], config['package'] + '/adapter.mjs', 'proxy', config['socket']], daemon_env(config))
    if args.command == 'cli':
        interactive = not args.remainder or args.remainder[0] in ('resume', 'fork') or args.remainder[0].startswith('-')
        command = list(args.remainder)
        if interactive:
            position = 1 if command[:1] in (['resume'], ['fork']) else 0
            command[position:position] = ['--remote', 'unix://' + config['socket']]
        os.execve(config['codex'], [config['codex'], *command], daemon_env(config))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BusyError as error:
        print(str(error), file=sys.stderr); sys.exit(75)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr); sys.exit(1)
