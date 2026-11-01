# DoorCounter

A shared people counter for an event. Door staff open the counter page on their phones and tap **+** or **−**. Every device shows the same live number. An admin page sets or resets the counter, sets a capacity limit and shows a report of how many people were inside over time.

- Counter: `/doorcounter/`
- Admin: `/doorcounter/admin/`

## How it fits together

- The pages are in the repo root: `index.html` (counter), `admin/index.html` and the shared `connection.js`. In production the repo is cloned into the web root, and Apache serves the pages directly.
- `server.js` is a Node WebSocket service at `/api` (`/doorcounter/api` through Apache). It holds the counter, writes the log and pushes every change to all connected devices. It does not serve the pages in production.

Needs Node.js 18 or later. The only dependency is `ws`.

## Run locally

```sh
npm install
npm run dev        # node server.js --static
```

Open http://localhost:3000/ (counter) and http://localhost:3000/admin/ (admin). The `--static` flag makes Node serve the pages as well, standing in for Apache.

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

On the admin page, **Rensa logg** renames the current log to `data/log-<time>.csv` and starts a fresh log at 0. Use it after testing, before the event starts. **Ladda ner CSV** builds the CSV in the browser from the log it has received.

## Deploy (Linux + Apache)

Production: `ssh kalle@192.168.194.10`. The app lives in `/srv/www/mumindalen/doorcounter` and the backend runs as user `kalle` on port 8083, the same way as simplevote (8082) and triangelspelet (8081).

`install-doorcounter.sh` does both the first install and every update. It runs `git pull` and `npm ci`, installs and restarts the systemd service, and writes the Apache lines from `deploy/apache-counter.conf` into the mumindalen.nu vhost. Run it as `kalle`, not with sudo, from a terminal where you can type the sudo password:

```sh
ssh -t kalle@192.168.194.10 /srv/www/mumindalen/doorcounter/install-doorcounter.sh
```

The Apache vhost needs only one line, the WebSocket proxy (`deploy/apache-counter.conf`). The app directory lies in the web root, so `.htaccess` returns 404 for everything that isn't a page: `.git`, `*.md`, `data/`, `server.js`, `node_modules/` and so on. If you add a non-public file to the repo root, add it to `.htaccess` too.

The counter value survives restarts, because the server rebuilds it from `data/log.csv`. Phones reconnect within a few seconds.

The pages use only relative URLs. To serve the app under a path other than `/doorcounter/`, change only the Apache config.

## Checklist before the event

1. Open the counter page on every staff phone and add it to the home screen.
2. Tap + on one phone and check that all the others update.
3. Set the capacity on the admin page.
4. Click **Rensa logg** on the admin page to clear the test taps.
5. Keep phone screens awake (turn off auto-lock), or reopen the page when a phone wakes. The page reconnects by itself.

If a phone shows the red **Ingen anslutning** banner, its buttons are disabled until the connection is back. Taps made while the banner shows are not counted.
