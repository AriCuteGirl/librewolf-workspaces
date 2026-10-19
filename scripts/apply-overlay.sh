#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/librewolf-source"
  exit 1
fi

source_root=$(cd "$1" && pwd)
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cp -a "$repo_root/overlay/." "$source_root/"
echo "Workspace overlay applied to $source_root"
