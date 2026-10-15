#!/usr/bin/env python3
"""Wait for a real Unix listener without sending an incomplete WS handshake."""
from pathlib import Path
import sys
import time

socket = Path(sys.argv[1])
for attempt in range(400):
    target = str(socket.resolve())
    for line in Path('/proc/net/unix').read_text().splitlines()[1:]:
        parts = line.split(maxsplit=7)
        if len(parts) == 8 and parts[7] == target and int(parts[3], 16) & 0x10000:
            sys.exit(0)
    time.sleep(0.1)
raise SystemExit('Plan B runtime did not create a listening socket within 40 seconds')
