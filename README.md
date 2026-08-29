# LAN Share

Browse and move files between your computer and any device on your local WiFi — straight from a
browser. Whole drives, no staging folder, no copying around: what you see in the browser IS the
filesystem.

Start the server, open the printed URL on your phone, enter the PIN, and you get an Explorer-like
view of your drives: open folders, download files, zip a folder to grab many at once, drag files in
to upload into the folder you're looking at.

## Features

- **Browse whole drives** (C:, D:, E:, … on Windows; real mount points on Linux) like a file explorer
- **Download** any file (with progress + speed in the Transfers panel; >300 MB falls back to a native
  browser download)
- **Zip a folder** on demand and download it as a single .zip — background job with a live progress
  bar (counting → zipping → downloading)
- **Search** any drive live as you type (capped/depth-limited walk, so big drives stay responsive)
- **The Bag** — stash files, whole folders, or a just-built zip as zero-copy pointers (the 💼 button or
  dragging a row onto the Bag), then pull them into any folder as a copy or a move; survives restarts
  via `bag.json`
- **Multi-device** — run one instance as a **hub**; other devices register to it and appear as chips
  in the Drives view. Pick a chip to browse/search/upload/zip/stash that device through the hub (same
  PIN everywhere, no per-device setup)
- **Paste a Windows path** into the address bar (`G:\Downloads\songs`) and jump straight there
- **Recent files** — each device shows the files recently opened in Windows on it (the OS Recent
  list), and other devices can see them through the hub and grab them with Download or the 💼 Bag:
  "send what I just edited" is one hop away. Click a row to jump to its folder.
- **Drive capacities** — each drive card shows its total and free space
- **Upload** files into whatever folder you're currently viewing (drag & drop or tap the box)
- **Delete** a file from the folder you're viewing
- **PIN gate** — the terminal prints a 4-digit PIN; every request needs a signed cookie
- **Read-only shares** — set `"writable": false` per share in `shares.json`; upload/delete are blocked
- **Installs like an app** (PWA): add to home screen on Android/desktop, works offline for the UI
- **Stateless browsing** — the server never stores which folder is open; each request carries its own
  `root` + `path`, so multiple devices/tabs never interfere

## Setup

```bash
python -m venv .venv
# activate it (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
```

## Run

```bash
python lanShare.py
```

The terminal prints:

- your LAN URL (`http://192.168.x.x:8000`) + a scannable QR code
- the **PIN** every visitor must enter
- the detected drives and shares

Open that URL on any device on the same WiFi, enter the PIN, and pick a drive.

> Override the PIN for development: `$env:LANSHARE_PIN="1234"` before starting.

## shares.json

Detected drives are always available. To serve extra paths, or lock one down, add entries:

```json
{
  "shares": [
    { "id": "lanshare", "name": "LAN Share", "path": "G:/lan share" },
    { "id": "photos",   "name": "Photos",    "path": "D:/Photos", "writable": false }
  ]
}
```

- `id` — short URL-safe key (`A-Z 0-9 _ -`; others are converted)
- `path` — absolute path
- `writable` — optional; defaults to `true`

`shares.json` is read once at startup — restart the server after editing it.

## Multi-device (hub + nodes)

One instance can be the **hub**: it keeps a registry of other instances and lets you browse them through
it (the frontend proxies every request over `/peer/{device_id}/...`). Automation is just environment
variables — no config file for peers:

| Variable | Meaning |
| --- | --- |
| `LANSHARE_PORT` | port to listen on (default `8000`) |
| `LANSHARE_DEVICE_ID` | stable device id (default: persisted random id) |
| `LANSHARE_DEVICE_NAME` | human name shown in the peer bar (default: hostname) |
| `LANSHARE_HUB_URL` | set this to the hub (e.g. `http://192.168.1.5:8000`) to auto-register every 15 s |
| `LANSHARE_ADVERTISE_URL` | URL peers should use to reach this device (default: guessed LAN IP) |
| `LANSHARE_TOKEN` | shared machine token (default: derived from the PIN) |
| `LANSHARE_SHARES` | point at an alternate `shares.json` for this instance |

Everyone must share the same PIN (or set `LANSHARE_TOKEN` for devices you can't type a PIN on).
Start the hub normally; start the other devices with:

```bash
LANSHARE_HUB_URL=http://192.168.1.5:8000 LANSHARE_PORT=8010 LANSHARE_DEVICE_NAME=Room1 python lanShare.py
```

The hub console prints `device registered`, and the peer bar shows the device with an online dot.

## Routes (for reference)

| Route | Purpose |
| --- | --- |
| `GET /` · `POST /login` | PIN page + signed-cookie login |
| `GET /api/drives` | detected drives + configured shares (path, writable, online, size, free) |
| `GET /api/list?root=&path=` | folders/files in one directory (dirs first) |
| `GET /api/search?root=&path=&q=&limit=&depth=` | live recursive name search (capped/depth-limited) |
| `GET /api/recent` · `GET /api/recent/file?path=` | recently opened files on this device (resolves .lnk) |
| `GET`/`HEAD /files/{share}/{subpath:path}` | download a file |
| `POST /zip/{share}/{subpath:path}/start` | start a background zip job |
| `GET /zip/status/{job_id}` | poll the zip job (bytes zipped / total) |
| `GET /zip/download/{job_id}` | download the finished zip (one-shot) |
| `POST /upload?root=&path=` | upload one or more files into that folder |
| `POST /files/{share}/{subpath:path}/delete` | delete a file (file-only by design) |
| `GET /api/bag` · `POST /api/bag/add` · `/remove` | the Bag: list / stash / drop no-copy pointers |
| `POST /api/bag/add-zip` | move a finished zip job into the Bag (kind `zip`) |
| `POST /api/bag/pull` | materialise Bag items into a folder (copy or move) |
| `POST /api/bag/clear` | empty the Bag |
| `GET /api/peers` | devices known to this hub (`online` = seen in last 60 s) |
| `POST /api/device/register` · `/heartbeat` | device auto-registration (shares `X-LANSHARE-TOKEN`) |
| `GET`/`POST`/`HEAD`/`PUT`/`DELETE /peer/{id}/{path:path}` | the hub proxies any request to that peer |

## Safety

- Every route is behind the PIN (signed cookie) **or** the shared `X-LANSHARE-TOKEN` header that the
  hub passes on behalf of peers. Sending the PIN to visitors gives them read + write access to the
  served drives — that's the point of this app, so only share it on trusted networks.
- Path traversal (`../`) is blocked on download, zip (start/status/download), upload, delete and
  search via `resolve()` + `relative_to()` in `safe_rel`.
- Uploaded filenames are stripped of `/` and `\`; collisions auto-rename to `name_1.ext`.
- Files upload/download stream in 1 MB chunks — big files don't eat RAM.

## Tech stack

- **FastAPI + uvicorn** — web server + routing
- **python-multipart** — streams multipart uploads
- **itsdangerous** — signed session cookies
- **httpx** — the hub's streaming proxy to peer devices
- **qrcode + rich** — QR in the terminal / styled startup panel
- **Bootstrap 5** (CDN) + custom **style.css** — the app shell and Explorer UI
- **Service worker + manifest** — the PWA install experience

## Learning progress

This repo `LEARN.md` is a concept-by-concept map of the whole app (57 ideas, each with a 2–5 minute
"do it yourself" task) plus a 40-minute interview rebuild drill. One page a day — the goal is to be
able to rewrite this app from scratch, not to read about it.