#!/bin/bash
# Install or update DoorCounter on the production server.
# Run as kalle (not with sudo; the script calls sudo itself). It is safe to re-run.
#   ssh -t kalle@<server> /srv/www/mumindalen/doorcounter/install-doorcounter.sh
# First install, before the clone exists:
#   scp install-doorcounter.sh kalle@<server>: && ssh -t kalle@<server> ./install-doorcounter.sh
set -euo pipefail

# Braces make bash parse the whole script before running it, since step 1
# may git pull a newer version of this file.
{

APP_USER=kalle
APP=/srv/www/mumindalen/doorcounter
CONF=/etc/apache2/sites-available/default.conf
REPO=https://github.com/llelundberg/doorcounter

if [ "$(id -un)" != "$APP_USER" ]; then
  echo "Run as $APP_USER, not with sudo (the script calls sudo itself)"
  exit 1
fi
sudo -v

echo "== 1. Code"
if [ ! -d "$APP/.git" ]; then
  sudo install -d -o "$APP_USER" -g "$APP_USER" "$APP"
  git clone -q "$REPO" "$APP"
fi
# Repair ownership if an earlier run created files as root.
if [ -n "$(find "$APP" ! -user "$APP_USER" -print -quit)" ]; then
  sudo chown -R "$APP_USER:$APP_USER" "$APP"
fi
git -C "$APP" pull -q --ff-only
git -C "$APP" log --oneline -1
mkdir -p "$APP/data"
(cd "$APP" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

echo "== 2. systemd service"
sudo cp "$APP/deploy/doorcounter.service" /etc/systemd/system/doorcounter.service
sudo systemctl daemon-reload
sudo systemctl enable -q doorcounter
sudo systemctl restart doorcounter
sleep 2
systemctl is-active doorcounter

echo "== 3. Apache"
BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
sudo cp "$CONF" "$BACKUP"
BLOCK=$(mktemp)
grep -vE '^\s*(#|$)' "$APP/deploy/apache-counter.conf" > "$BLOCK"
# Remove the previous doorcounter lines (including the marked block from an
# older version), then insert the current ones after the simplevote lines.
sudo sed -i -e '/# BEGIN doorcounter/,/# END doorcounter/d' -e '/doorcounter/d' "$CONF"
sudo sed -i "\\|ProxyPassReverse \"/simplevote/\"|r $BLOCK" "$CONF"
rm "$BLOCK"
if sudo cmp -s "$CONF" "$BACKUP"; then
  echo "Apache config unchanged"
  sudo rm "$BACKUP"
else
  echo "Apache config updated, backup: $BACKUP"
  if ! grep -q '/doorcounter/api' "$CONF" || ! sudo apachectl configtest; then
    echo "Apache config failed - restoring backup"
    sudo cp "$BACKUP" "$CONF"
    exit 1
  fi
  sudo systemctl reload apache2
fi

echo "== Done: /doorcounter/ is live"
exit
}
