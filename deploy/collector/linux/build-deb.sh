#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.1.0}"
ARCH="${ARCH:-amd64}"
ROOT="dist-deb/orbis-collector_${VERSION}_${ARCH}"

rm -rf dist-deb
mkdir -p \
  "${ROOT}/DEBIAN" \
  "${ROOT}/opt/orbis-collector" \
  "${ROOT}/etc/orbis-collector" \
  "${ROOT}/lib/systemd/system"

cp -R ../../../packages/collector/dist ../../../packages/collector/package.json ../../../node_modules "${ROOT}/opt/orbis-collector/"
cp ../collector.env.example "${ROOT}/etc/orbis-collector/collector.env.example"
cp orbis-collector.service "${ROOT}/lib/systemd/system/orbis-collector.service"

cat > "${ROOT}/DEBIAN/control" <<EOF
Package: orbis-collector
Version: ${VERSION}
Section: net
Priority: optional
Architecture: ${ARCH}
Maintainer: Orbis
Depends: nodejs (>= 20)
Description: Orbis network discovery collector
EOF

cat > "${ROOT}/DEBIAN/postinst" <<'EOF'
#!/usr/bin/env bash
set -e
id -u orbis-collector >/dev/null 2>&1 || useradd --system --home /opt/orbis-collector --shell /usr/sbin/nologin orbis-collector
mkdir -p /etc/orbis-collector
if [ ! -f /etc/orbis-collector/collector.env ]; then
  cp /etc/orbis-collector/collector.env.example /etc/orbis-collector/collector.env
  chmod 0600 /etc/orbis-collector/collector.env
fi
chown -R orbis-collector:orbis-collector /opt/orbis-collector
systemctl daemon-reload || true
systemctl enable orbis-collector || true
EOF

cat > "${ROOT}/DEBIAN/prerm" <<'EOF'
#!/usr/bin/env bash
set -e
systemctl stop orbis-collector || true
systemctl disable orbis-collector || true
EOF

chmod 0755 "${ROOT}/DEBIAN/postinst" "${ROOT}/DEBIAN/prerm"
dpkg-deb --build "${ROOT}"
