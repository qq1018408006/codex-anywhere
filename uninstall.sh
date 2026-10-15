#!/bin/sh
# Copyright 2026 Codex Anywhere contributors. Licensed under Apache-2.0.
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$project_dir/shared-runtime/uninstall.sh" "$@"
