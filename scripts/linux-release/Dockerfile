FROM node:24-bookworm-slim AS node
FROM archlinux:base
RUN pacman -Syu --noconfirm --needed nodejs npm base-devel gtk3 nss alsa-lib libxss libsecret xdg-utils git openssh mesa libdrm libxkbcommon xorg-server-xvfb dbus && pacman -Scc --noconfirm
RUN useradd -m builder && mkdir -p /tools /work && chown builder:builder /work
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN cd /tools && npm install --no-audit --no-fund @electron/packager@20.0.0 @playwright/test@1.55.0
ENV NODE_PATH=/tools/node_modules
CMD ["bash", "/scripts/linux-release/build.sh"]
