#!/usr/bin/env bash
set -euo pipefail

install -d -m 0755 /opt/orbis-collector /etc/orbis-collector
id -u orbis-collector >/dev/null 2>&1 || useradd --system --home /opt/orbis-collector --shell /usr/sbin/nologin orbis-collector

if [ ! -f /etc/orbis-collector/collector.env ]; then
  install -m 0600 collector.env.example /etc/orbis-collector/collector.env
fi

cp -R dist package.json node_modules /opt/orbis-collector/
chown -R orbis-collector:orbis-collector /opt/orbis-collector
install -m 0644 orbis-collector.service /etc/systemd/system/orbis-collector.service

systemctl daemon-reload
systemctl enable --now orbis-collector
systemctl status orbis-collector --no-pager
