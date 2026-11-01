# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single shared people counter for a ~6-hour event. Door staff tap +/− on phones (portrait); all devices see the same live value. An admin page (`/admin/`) sets/resets the value, sets a capacity limit, and shows a report (chart, stats, CSV). UI text is Swedish. In production it runs on Linux behind Apache at https://mumindalen.nu/doorcounter/ (admin at `/doorcounter/admin/`).

## Commands

```sh
npm install
npm run dev                                              # node server.js --static: http://localhost:3000/ and /admin/
PORT=3125 DATA_DIR=/some/tmp/dir node server.js --static  # isolated test run (keeps ./data clean)
```

There is no build step, test suite or linter. Verify backend changes with a small Node script using the global `WebSocket` client against `ws://127.0.0.1:<port>/api`, and verify page changes in a browser.

## Architecture

- **Split delivery.** Apache serves `public/` (static HTML plus the shared `connection.js`). `server.js` is only a WebSocket service at `/api`, proxied from `/doorcounter/api`. The `--static` flag (or `SERVE_STATIC=1`) makes Node serve `public/` too, but that's for local development only.
- **The log is the single source of truth.** `data/log.csv` (`timestamp,action,delta,value,device`) is append-only. On startup `loadLog()` replays it to rebuild `state.value` and `state.capacity`; there is no separate state file. Actions: `inc`, `dec`, `set` (admin), and `capacity` (where `value` is the new limit, not the headcount). Anything that reads the log must treat `capacity` rows separately from count rows.
- **All mutations go through `record()`.** It appends to the file synchronously, updates in-memory `entries`/`state`, then broadcasts. Correctness under concurrent taps relies on Node's single thread plus this synchronous path, so don't add `await` between reading `state.value` and calling `record()`.
- **WebSocket protocol** is documented in a comment block in `server.js`. Every client message carries an `id` and gets an `ack` (with the new state, or an error). All clients receive `state` broadcasts. The admin page sends `subscribeLog` to get the full log, then live `entry` messages. After `archive` it gets a fresh `log`.
- **`public/connection.js`** handles reconnecting, acks and heartbeats for both pages. A request with no ack within 5 s tears the connection down, because a WebSocket can die silently on phones. The counter page disables its buttons whenever the connection is offline. This is deliberate: taps are never queued or resent, so they can't be lost unnoticed or counted twice. Pages render only server-authoritative values, never optimistic local increments.
- **Frontend** is plain ES5-style JS with no libraries. The admin chart is hand-drawn on `<canvas>`, and the CSV is built in the browser from the received log.

## Constraints

- **Relative URLs only** in `public/` (`api` and `connection.js` on the counter page, `../api` and `../connection.js` in admin). The app is served under an Apache subpath. `connection.js` turns the relative path into a `ws:`/`wss:` URL.
- Every WebSocket needs an `error` listener (`ws.on('error')` in `server.js`). Without one, a protocol error such as an oversized message crashes the whole server.
- Deployment: `install-doorcounter.sh` is used both for the first install and for updates. It pulls, runs `npm ci`, restarts the service, and replaces the `# BEGIN doorcounter` … `# END doorcounter` block in the Apache vhost with the non-comment lines of `deploy/apache-counter.conf`. That config denies the whole app directory except `public/`, because the app lives inside the web root.
- Production is `ssh kalle@192.168.194.10` (Ubuntu, Node 22, Apache 2.4 with proxy_wstunnel). The app is a git clone at `/srv/www/mumindalen/doorcounter` and runs as `kalle` on port 8083. Ports 8081 and 8082 belong to other apps. sudo needs a password, so the install script must be run by the user in an interactive terminal (`ssh -t`).
- `.gitattributes` forces LF for `*.sh`, `*.service` and `*.conf`, because they run or are read on Linux.
