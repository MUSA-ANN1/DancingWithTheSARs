#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 EC2 instance:  sudo bash setup.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
RUN_USER="${SUDO_USER:-ubuntu}"
SRC="$(cd "$(dirname "$0")" && pwd)"
APP=/opt/nisar

echo "== 1/6 swap (2 GB, so a 1 GB machine does not crash)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== 2/6 packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip git ca-certificates

echo "== 3/6 app files"
mkdir -p "$APP/out" "$APP/tmp"
cp "$SRC"/{run_job.py,nisar_lib.py,publish.sh,requirements.txt} "$APP/"
[ -f "$APP/config.json" ] || cp "$SRC/config.json" "$APP/config.json"   # keeps your edits on re-run
chmod +x "$APP/publish.sh"
chown -R "$RUN_USER":"$RUN_USER" "$APP"

echo "== 4/6 python packages (takes a few minutes)"
sudo -u "$RUN_USER" python3 -m venv "$APP/venv"
sudo -u "$RUN_USER" "$APP/venv/bin/pip" install -q --upgrade pip
sudo -u "$RUN_USER" "$APP/venv/bin/pip" install -q -r "$APP/requirements.txt"

echo "== 5/6 secrets file"
if [ ! -f /etc/nisar.env ]; then
  cat > /etc/nisar.env <<EOF
EDL_TOKEN=
GITHUB_REPO=MUSA-ANN1/DancingWithTheSARs
GITHUB_TOKEN=
FIRMS_KEY=
EOF
fi
chmod 600 /etc/nisar.env

echo "== 6/6 scheduled job (daily 04:00 UTC; it skips regions with nothing new)"
cat > /etc/systemd/system/nisar-job.service <<EOF
[Unit]
Description=NISAR change-map job
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=$RUN_USER
EnvironmentFile=/etc/nisar.env
WorkingDirectory=$APP
ExecStart=/bin/bash -c '$APP/venv/bin/python $APP/run_job.py && $APP/publish.sh'
TimeoutStartSec=3h
Nice=10
OOMScoreAdjust=500
EOF
cat > /etc/systemd/system/nisar-job.timer <<EOF
[Unit]
Description=Run the NISAR job daily
[Timer]
OnCalendar=*-*-* 04:00:00 UTC
Persistent=true
RandomizedDelaySec=15m
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now nisar-job.timer

cat <<EOF

Done. Next:
  1. sudo nano /etc/nisar.env      (paste EDL_TOKEN and GITHUB_TOKEN)
  2. sudo systemctl start nisar-job   (first run, in the background)
  3. journalctl -u nisar-job -f        (watch it; Ctrl+C to stop watching)
EOF
