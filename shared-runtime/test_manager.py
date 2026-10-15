"""Tests for restoration and interruption behavior, without touching user services."""
import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('manager', Path(__file__).with_name('manager.py'))
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.manifest = {'state': str(self.state), 'files': []}

    def tearDown(self):
        self.directory.cleanup()

    def test_symlink_restored_without_modifying_its_target(self):
        target = self.root / 'original'
        target.write_text('original executable')
        path = self.root / 'launcher'
        path.symlink_to(target)
        manager.write_owned(self.manifest, path, 'shared executable', 0o755)
        self.assertEqual(target.read_text(), 'original executable')
        manager.restore_files(self.manifest)
        self.assertTrue(path.is_symlink())
        self.assertEqual(path.resolve(), target)
        self.assertEqual(target.read_text(), 'original executable')

    def test_modified_installer_owned_file_is_preserved_before_restore(self):
        path = self.root / 'launcher'
        path.write_text('original')
        manager.write_owned(self.manifest, path, 'installed')
        path.write_text('user changed installed file')
        preserved = manager.restore_files(self.manifest)
        self.assertEqual(path.read_text(), 'original')
        self.assertEqual(preserved, [str(path)])
        record = json.loads(next((self.state / 'preserved').glob('*.json')).read_text())
        self.assertEqual(base64.b64decode(record['modified']['content']), b'user changed installed file')

    def test_unrelated_file_and_session_data_are_kept(self):
        owned = self.root / 'owned'
        other = self.root / 'other.conf'
        sessions = self.root / 'sessions'
        other.write_text('post-install unrelated config')
        sessions.mkdir()
        (sessions / 'thread.jsonl').write_text('new session')
        manager.write_owned(self.manifest, owned, 'temporary')
        manager.restore_files(self.manifest)
        self.assertFalse(owned.exists())
        self.assertEqual(other.read_text(), 'post-install unrelated config')
        self.assertEqual((sessions / 'thread.jsonl').read_text(), 'new session')

    def test_busy_runtime_prevents_daemon_stop(self):
        config = {'toolsPipe': '/new/tools.sock', 'mcpNode': '/node'}
        old = {'remoteControl': False, 'toolEnv': {}}
        with patch.object(manager, 'daemon_process', return_value=old), \
             patch.object(manager, 'publish_tool_route'), \
             patch.object(manager, 'inspect_runtime', return_value={'busy': [{'id': 'active'}]}), \
             patch.object(manager, 'daemon_command') as command:
            with self.assertRaises(manager.BusyError):
                manager.ensure_daemon(config)
            command.assert_not_called()

    def test_live_feature_alignment_keeps_busy_daemon_running(self):
        config = {'toolsPipe': '/tools.sock', 'mcpNode': '/node'}
        existing = {'remoteControl': False, 'toolEnv': {
            'CODEX_APP_TOOLS_PIPE_PATH': '/tools.sock', 'CODEX_MCP_NODE_PATH': '/node'}}
        with patch.object(manager, 'daemon_process', return_value=existing), \
             patch.object(manager, 'publish_tool_route'), \
             patch.object(manager, 'inspect_runtime', return_value={'busy': [{'id': 'active'}]}), \
             patch.object(manager, 'reconcile_shared_features') as align, \
             patch.object(manager, 'daemon_command') as command:
            manager.ensure_daemon(config)
            align.assert_called_once_with(config)
            command.assert_not_called()

    def test_shared_policy_captures_cli_values_with_multiword_feature_stages(self):
        config = {'userHome': '/probe', 'codexHome': '/probe/.codex', 'codex': '/codex',
                  'toolsPipe': '/tools', 'mcpNode': '/node'}
        output = 'api_key_model_discovery\tunder development\tfalse\n' \
                 'auth_elicitation\tstable\ttrue\ncode_mode_host\tstable\ttrue\n' \
                 'mcp_oauth_refresh_coordination\tunder development\tfalse\n'
        with patch.object(manager, 'run') as run:
            run.return_value.stdout = output
            self.assertEqual(manager.cli_shared_features(config), {
                'api_key_model_discovery': False, 'auth_elicitation': True,
                'code_mode_host': True, 'mcp_oauth_refresh_coordination': False})

    def test_snapshot_saved_before_write_can_restore_interrupted_install(self):
        path = self.root / 'config'
        path.write_text('before')
        with patch.object(manager, 'atomic_write', wraps=manager.atomic_write) as write:
            manager.write_owned(self.manifest, path, 'after')
            first_path = write.call_args_list[0].args[0]
            self.assertEqual(first_path, self.state / 'manifest.json')
        interrupted = json.loads((self.state / 'manifest.json').read_text())
        interrupted['files'][0]['installed'] = None
        manager.restore_files(interrupted)
        self.assertEqual(path.read_text(), 'before')

    def test_old_runtime_dependency_removed_other_dependencies_preserved(self):
        unit = '[Unit]\nRequires=network.target old-runtime.service\nAfter=network.target old-runtime.service\n[Service]\nExecStart=/original\n'
        result = manager.remove_runtime_dependency(unit, 'old-runtime.service')
        self.assertNotIn('old-runtime.service', result)
        self.assertIn('Requires=network.target', result)
        self.assertIn('After=network.target', result)
        self.assertIn('ExecStart=/original', result)

    def test_daemon_launch_does_not_inherit_parent_session_identity(self):
        config = {'userHome': '/probe', 'codexHome': '/probe/.codex', 'toolsPipe': '/tools', 'mcpNode': '/node'}
        with patch.dict(manager.os.environ, {'CODEX_SESSION_ID': 'parent', 'CODEX_CI': 'context', 'CODEX_THREAD_ID': 'parent'}):
            env = manager.daemon_env(config)
        for key in ('CODEX_SESSION_ID', 'CODEX_CI', 'CODEX_THREAD_ID'):
            self.assertNotIn(key, env)
        self.assertEqual(env['CODEX_HOME'], '/probe/.codex')

    def test_process_home_is_used_when_daemon_has_no_explicit_codex_home(self):
        procdir = self.root / 'proc'
        proc = procdir / '123'
        proc.mkdir(parents=True)
        (proc / 'cmdline').write_bytes(b'codex\0app-server\0--managed-daemon\0')
        (proc / 'environ').write_bytes(b'HOME=/real-user\0')
        config = {'userHome': '/probe', 'codexHome': '/probe/.codex'}
        with patch.object(manager, 'Path', side_effect=lambda p: procdir if p == '/proc' else Path(p)):
            self.assertIsNone(manager.daemon_process(config))
            config['codexHome'] = '/real-user/.codex'
            self.assertEqual(manager.daemon_process(config)['pid'], 123)

    def test_plan_a_tool_socket_is_reached_through_a_separate_symlink(self):
        provider = self.state / 'plan-a-tools.sock'
        route = self.state / 'desktop-tools.sock'
        with manager.socket.socket(manager.socket.AF_UNIX) as listener:
            listener.bind(str(provider))
            listener.listen()
            config = {'state': str(self.state), 'toolsPipe': str(route), 'planAToolsPipe': str(provider)}
            manager.publish_tool_route(config)
            self.assertTrue(route.is_symlink())
            self.assertEqual(route.resolve(), provider)
            self.assertTrue(provider.is_socket())
            route.unlink()
            route.write_text('unrelated file')
            with self.assertRaises(RuntimeError): manager.publish_tool_route(config)
            self.assertEqual(route.read_text(), 'unrelated file')

    def test_discovered_node_is_available_to_npm_cli_in_systemd_environment(self):
        config = {'userHome': '/probe', 'codexHome': '/probe/.codex', 'toolsPipe': '/tools',
                  'mcpNode': '/desktop/node', 'node': '/nvm/bin/node'}
        with patch.dict(manager.os.environ, {'PATH': '/usr/bin:/bin'}):
            env = manager.daemon_env(config)
        self.assertEqual(env['PATH'], '/nvm/bin:/usr/bin:/bin')


if __name__ == '__main__':
    unittest.main()
