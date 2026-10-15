#!/usr/bin/env python3
"""Build a portable installer archive without logs, state, credentials or node_modules."""
import hashlib
import io
from pathlib import Path
import tarfile
from manager import VERSION

root = Path(__file__).resolve().parent
output = root / 'artifacts'
output.mkdir(exist_ok=True)
archive = output / ('codex-runtime-share-' + VERSION + '.tar.gz')
names = ['README.md', 'LICENSE', 'NOTICE', 'manager.py', 'adapter.mjs', 'install.sh', 'uninstall.sh',
         'package.py', 'test_manager.py', 'test_adapter.mjs']
files = [root / name for name in names] + sorted((root / 'vendor/ws').rglob('*'))
with tarfile.open(archive, 'w:gz') as pack:
    for path in files:
        if not path.is_file(): continue
        relative = path.relative_to(root)
        entry = tarfile.TarInfo('codex-runtime-share/' + str(relative))
        contents = path.read_bytes()
        entry.size = len(contents)
        entry.mode = 0o755 if path.name in ('install.sh', 'uninstall.sh', 'manager.py', 'package.py') else 0o644
        entry.mtime = 0
        pack.addfile(entry, io.BytesIO(contents))
checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / 'SHA256SUMS').write_text(checksum + '  ' + archive.name + '\n')
print(f'{archive} ({archive.stat().st_size} bytes)\nsha256 {checksum}')
