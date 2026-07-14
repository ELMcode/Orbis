#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.1.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/deploy/releases"

rm -rf "${OUT}"
mkdir -p "${OUT}"

corepack pnpm --filter @orbis/collector build

tar -czf "${OUT}/orbis-collector-docker-${VERSION}.tar.gz" \
  -C "${ROOT}/deploy/collector" \
  docker-compose.collector.yml collector.env.example

tar -czf "${OUT}/orbis-collector-linux-kit-${VERSION}.tar.gz" \
  -C "${ROOT}/deploy/collector" \
  collector.env.example linux

zip -qr "${OUT}/OrbisCollector-windows-kit-${VERSION}.zip" \
  -j "${ROOT}/deploy/collector/collector.env.example" \
  "${ROOT}/deploy/collector/windows/install-collector.ps1" \
  "${ROOT}/deploy/collector/windows/OrbisCollector.wxs"

tar -czf "${OUT}/orbis-collector-appliance-kit-${VERSION}.tar.gz" \
  -C "${ROOT}/deploy/collector" \
  collector.env.example appliance linux

cat > "${OUT}/manifest.json" <<EOF
{
  "version": "${VERSION}",
  "files": [
    { "platform": "docker", "label": "Docker Compose", "file": "orbis-collector-docker-${VERSION}.tar.gz" },
    { "platform": "linux", "label": "Linux .deb kit", "file": "orbis-collector-linux-kit-${VERSION}.tar.gz" },
    { "platform": "windows", "label": "Windows MSI kit", "file": "OrbisCollector-windows-kit-${VERSION}.zip" },
    { "platform": "vm", "label": "VM appliance kit", "file": "orbis-collector-appliance-kit-${VERSION}.tar.gz" }
  ]
}
EOF

echo "Collector release artifacts written to ${OUT}"
