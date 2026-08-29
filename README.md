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
- **Paste a Windows path** into the address bar (`G:\Downloads\songs`) and jump straight there
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

## Routes (for reference)

| Route | Purpose |
| --- | --- |
| `GET /` · `POST /login` | PIN page + signed-cookie login |
| `GET /api/drives` | detected drives + configured shares (path, writable, online, size, free) |
| `GET /api/list?root=&path=` | folders/files in one directory (dirs first) |
| `GET /api/search?root=&path=&q=&limit=&depth=` | live recursive name search (capped/depth-limited) |
| `GET`/`HEAD /files/{share}/{subpath:path}` | download a file |
| `POST /zip/{share}/{subpath:path}/start` | start a background zip job |
| `GET /zip/status/{job_id}` | poll the zip job (bytes zipped / total) |
| `GET /zip/download/{job_id}` | download the finished zip (one-shot) |
| `POST /upload?root=&path=` | upload one or more files into that folder |
| `POST /files/{share}/{subpath:path}/delete` | delete a file (file-only by design) |

## Safety

- Every route is behind the PIN (signed cookie). Sending the PIN to visitors gives them read + write
  access to the served drives — that's the point of this app, so only share it on trusted networks.
- Path traversal (`../`) is blocked on download, zip (start/status/download), upload, delete and
  search via `resolve()` + `relative_to()` in `safe_rel`.
- Uploaded filenames are stripped of `/` and `\`; collisions auto-rename to `name_1.ext`.
- Files upload/download stream in 1 MB chunks — big files don't eat RAM.

## Tech stack

- **FastAPI + uvicorn** — web server + routing
- **python-multipart** — streams multipart uploads
- **itsdangerous** — signed session cookies
- **qrcode + rich** — QR in the terminal / styled startup panel
- **Bootstrap 5** (CDN) + custom **style.css** — the app shell and Explorer UI
- **Service worker + manifest** — the PWA install experience

## Learning progress

This repo `LEARN.md` is a concept-by-concept map of the whole app (47 ideas, each with a 2–5 minute
"do it yourself" task) plus a 40-minute interview rebuild drill. One page a day — the goal is to be
able to rewrite this app from scratch, not to read about it.