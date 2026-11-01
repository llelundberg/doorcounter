#!/bin/bash
# One-time install of DoorCounter on the production server.
# Run as kalle (not with sudo; the script calls sudo itself). It is safe to re-run.
#   scp install-doorcounter.sh kalle@<server>: && ssh -t kalle@<server> ./install-doorcounter.sh
set -euo pipefail

APP_USER=kalle
APP=/srv/www/mumindalen/doorcounter
CONF=/etc/apache2/sites-available/default.conf
REPO=https://github.com/llelundberg/doorcounter

if [ "$(id -un)" != "$APP_USER" ]; then
  echo "Run as $APP_USER, not with sudo (the script calls sudo itself)"
  exit 1
fi

echo "== 1. App directory and clone"
if [ ! -d "$APP/.git" ]; then
  sudo install -d -o "$APP_USER" -g "$APP_USER" "$APP"
  git clone -q "$REPO" "$APP"
fi
# Repair ownership if an earlier run created files as root.
if [ -n "$(find "$APP" ! -user "$APP_USER" -print -quit)" ]; then
  sudo chown -R "$APP_USER:$APP_USER" "$APP"
fi
mkdir -p "$APP/data"

echo "== 2. systemd service"
sudo cp "$APP/deploy/doorcounter.service" /etc/systemd/system/doorcounter.service
sudo systemctl daemon-reload
sudo systemctl enable doorcounter
sudo systemctl restart doorcounter
sleep 2
systemctl is-active doorcounter
curl -fsS http://127.0.0.1:8083/api/state; echo

echo "== 3. Apache"
if grep -q '/doorcounter/' "$CONF"; then
  echo "Apache config already contains /doorcounter/, skipping edit"
else
  BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
  sudo cp "$CONF" "$BACKUP"
  echo "Backup: $BACKUP"
  # Insert our lines (without comments) after the simplevote ProxyPassReverse line.
  grep -vE '^\s*(#|$)' "$APP/deploy/apache-counter.conf" > /tmp/doorcounter-apache.txt
  sudo sed -i '\|ProxyPassReverse "/simplevote/"|r /tmp/doorcounter-apache.txt' "$CONF"
  rm /tmp/doorcounter-apache.txt
  if ! grep -q '/doorcounter/' "$CONF" || ! sudo apachectl configtest; then
    echo "Apache config failed - restoring backup"
    sudo cp "$BACKUP" "$CONF"
    exit 1
  fi
fi
sudo systemctl reload apache2

echo "== Done: /doorcounter/ is live"
