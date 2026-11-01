# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single shared people counter for a ~6-hour event. Door staff tap +/− on phones (portrait); all devices see the same live value. An admin page (`/admin/`) sets/resets the value, sets a capacity limit, and shows a report (chart, stats, CSV). UI text is Swedish. In production it runs on Linux behind Apache at https://mumindalen.nu/doorcounter/ (admin at `/doorcounter/admin/`).

## Commands

```sh
node server.js                                  # http://localhost:3000/ and /admin/
PORT=3123 DATA_DIR=/some/tmp/dir node server.js  # isolated test run (keeps ./data clean)
```

No build step, no npm dependencies, no test suite or linter. Verify changes by running the server and exercising the API with curl, e.g.:

```sh
curl -X POST -H 'Content-Type: application/json' -d '{"delta":1,"device":"x"}' localhost:3000/api/change
```

## Architecture

- **Backend (`server.js`)** uses only Node built-ins (`http`, `fs`, `path`). Keep it dependency-free. Config comes from env vars via `config.js` (`PORT`, `HOST` default 127.0.0.1, `DATA_DIR`).
- **The log is the single source of truth.** `data/log.csv` (`timestamp,action,delta,value,device`) is append-only. On startup `loadLog()` replays it to rebuild `state.value` and `state.capacity`; there is no separate state file. Actions: `inc`, `dec`, `set` (admin), and `capacity` (where `value` is the new limit, not the headcount). Anything that reads the log must treat `capacity` rows separately from count rows.
- **All mutations go through `record()`.** It appends to the file synchronously, updates in-memory `entries`/`state`, then calls `broadcast()`. Correctness under concurrent taps relies on Node's single thread plus this synchronous path, so don't add `await` between reading `state.value` and calling `record()`.
- **Live sync is Server-Sent Events** (`GET /api/events`), not WebSockets. Clients render only server-authoritative values (from SSE or the POST response), never optimistic local increments. The counter page disables its buttons whenever the SSE connection is down or a POST fails. This is deliberate: taps made offline are not queued.
- **`POST /api/archive`** renames the log to `log-<timestamp>.csv` and starts fresh at 0, keeping the current capacity. It's meant for clearing test runs before the event.
- **Frontend** is two self-contained HTML files with inline CSS and JS, using plain ES5-style JS and no libraries. The admin chart is hand-drawn on `<canvas>`.

## Constraints

- **Relative URLs only** in `public/` (`api/...` on the counter page, `../api/...` in admin). The app is served under an Apache subpath, so absolute `/api` paths would break production. The server's directory redirect (`/admin` → `admin/`) is also relative for the same reason.
- SSE through Apache needs `flushpackets=on` and no gzip (see `deploy/apache-counter.conf`). The server sends `X-Accel-Buffering: no` and a 15 s keep-alive ping; keep those if you touch `handleEvents`.
- Deployment artifacts live in `deploy/`: a systemd unit and the Apache snippet. `README.md` has the install and update steps and the pre-event checklist.
- Production is `ssh kalle@192.168.194.10` (Ubuntu, Node 22). The app is a git clone at `/srv/www/mumindalen/doorcounter`, runs as `kalle` on port 8083, and the Apache lines sit inline in the mumindalen.nu vhost in `/etc/apache2/sites-available/default.conf`. Ports 8081 and 8082 belong to other apps. sudo needs a password, so it can't be run non-interactively over ssh.
