#!/usr/bin/env bash
set -euo pipefail
cp -a /input /work/app
rm -rf /work/app/node_modules
chown -R builder:builder /work
runuser -u builder -- bash -c 'cd /work/app && npm ci --omit=dev --ignore-scripts --no-audit --no-fund'
runuser -u builder -- node /scripts/linux-release/package.mjs
runuser -u builder -- bash -c 'cd /work/package && makepkg --noconfirm'
cp /work/package/*.pkg.tar.zst /output/
runuser -u builder -- bash -c 'cd /work && tar -czf /output/Laptop-Assistant-1.1.0-linux-x64.tar.gz Laptop-Assistant-linux-x64'
pacman -U --noconfirm /output/*.pkg.tar.zst
runuser -u builder -- dbus-run-session -- xvfb-run -a -s '-screen 0 1280x1024x24' node /scripts/linux-release/verify.mjs
cp /scripts/linux-release/INSTALL.txt /output/INSTALL.txt
