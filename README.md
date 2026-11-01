# DoorCounter

A shared people counter for an event. Door staff open the counter page on their phones and tap **+** or **−**. Every device shows the same live number. An admin page sets or resets the counter, sets a capacity limit and shows a report of how many people were inside over time.

- Counter: https://mumindalen.nu/doorcounter/
- Admin: https://mumindalen.nu/doorcounter/admin/

No npm dependencies. Needs Node.js 16 or later.

## Run locally

```sh
node server.js
```

Open http://localhost:3000/ (counter) and http://localhost:3000/admin/ (admin).

Settings are read from environment variables: `PORT` (default 3000), `HOST` (default 127.0.0.1) and `DATA_DIR` (default `./data`).

## Data and log

Every change is appended to `data/log.csv`:

```
timestamp,action,delta,value,device
2026-11-01T18:00:03.120Z,inc,1,1,k3j9x0ab
2026-11-01T18:00:05.884Z,dec,-1,0,p02mzq7c
2026-11-01T18:10:00.000Z,set,12,12,admin
2026-11-01T17:55:00.000Z,capacity,0,500,admin
```

- `action` is one of `inc`, `dec`, `set` (admin set or reset) and `capacity` (for `capacity` rows, `value` is the new limit).
- `device` is a random id kept by each phone, so you can see which door a change came from.
- Timestamps are in UTC. The admin page shows local time.

When the server starts, it replays the log to restore the counter value and capacity, so a restart or crash loses nothing.

On the admin page, **Rensa logg** renames the current log to `data/log-<time>.csv` and starts a fresh log at 0. Use it after testing, before the event starts.

## Deploy (Linux + Apache)

```sh
# 1. Install the app
sudo useradd --system --no-create-home doorcounter
sudo mkdir -p /opt/doorcounter
sudo cp -r server.js config.js public /opt/doorcounter/
sudo mkdir -p /opt/doorcounter/data
sudo chown -R doorcounter:doorcounter /opt/doorcounter/data

# 2. systemd service
sudo cp deploy/doorcounter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now doorcounter
sudo systemctl status doorcounter

# 3. Apache reverse proxy
sudo a2enmod proxy proxy_http
#   paste deploy/apache-counter.conf into your site's <VirtualHost> block
sudo apachectl configtest && sudo systemctl reload apache2
```

If `node` is not at `/usr/bin/node`, change `ExecStart` in the service file (`which node`).

The app uses only relative URLs. To serve it under a path other than `/doorcounter/`, change only the Apache config.

## Checklist before the event

1. Open the counter page on every staff phone and add it to the home screen.
2. Tap + on one phone and check that all the others update.
3. Set the capacity on the admin page.
4. Click **Rensa logg** on the admin page to clear the test taps.
5. Keep phone screens awake (turn off auto-lock), or reopen the page when a phone wakes. The page reconnects by itself.

If a phone shows the red **Ingen anslutning** banner, its buttons are disabled until the connection is back. Taps made while the banner shows are not counted.
