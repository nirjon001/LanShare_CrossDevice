# LEARN.md — the LAN Share code map

You didn't "watch AI build this". This file turns the app into a map you walk yourself.
Each section is ONE idea. For every idea there is:

- **What it is** — 2 sentence plain-English explanation
- **Find it** — the exact spot. References use `file → name` (function/variable/id) so they never
  drift when code moves. To jump there in VS Code: right-click → *Go to Definition*, or just search
  the name.
- **Do it yourself** — a 2-5 minute task. Do these until the answer comes without thinking.

The whole app = ~59 ideas. One page a day = a month to real ownership.

## The 20-minute rule

When you open a gap and don't understand: try 20 minutes alone. Then ask for help.
Never move to the next section with an unchecked gap — gaps compound.

---

## Group A — the server boot & config (lanShare.py)

### 1. Script entry point
- **What it is**: `if __name__ == "__main__"` means "run this only when I run this file directly".
- **Find it**: `lanShare.py → main()` (bottom of file)
- **Do it**: add a `print("hi")` at the top of `main()` and confirm it prints when you run the file.

### 2. Environment variable
- **What it is**: settings read from the system instead of hardcoded. `os.getenv("LANSHARE_PIN")`
  reads a variable; `or` gives a fallback.
- **Find it**: `lanShare.py → PIN`
- **Do it**: in PowerShell run `$env:LANSHARE_PIN="0000"` then start the server — the PIN line prints 0000.

### 3. Path object (pathlib)
- **What it is**: `Path(...)` is like a string that knows how to join, check existence, resolve.
- **Find it**: `lanShare.py → BASE_DIR`, `safe_rel()` (uses `resolve()` + `relative_to`),
  `unique_path()` (uses `.stem`/`.suffix`/`exists()`)
- **Do it**: in Python REPL, `p = Path("C:/")`; print `p / "x"`, `p.exists()`, `p.resolve()`.

### 4. Config file (shares.json)
- **What it is**: extra folders to serve live in a separate file so you don't edit code. Each share can
  say `"writable": false` to make it read-only. `/api/drives` = detected drives + these shares.
- **Find it**: `lanShare.py → build_shares()`, `share_by_id()`; the file `shares.json`
- **Do it**: add a share pointing at any folder with files, restart, and check the Drives tab.

### 5. Stateless requests (there is no "current folder")
- **What it is**: the server never remembers which folder any client is looking at. Every request
  carries its own `root` + `path`. No `active = {...}` global, nothing to go stale.
- **Find it**: every route signature, e.g. `lanShare.py → api_list(root, path)`; the query string is
  built by `lanshare.js → listQuery()`
- **Do it**: open two browser tabs in different folders — click around in one; the other still shows
  its own folder. Open the second tab again (reload) — it stays. Nothing is shared server-side.

---

## Group B — the web framework (FastAPI)

### 6. What a server actually is
- **What it is**: a program that waits on a port, receives text ("HTTP request"), sends text back ("response").
- **Find it**: `lanShare.py → app = FastAPI()`, and `main() → uvicorn.run(...)`
- **Do it**: run the server, then open `http://127.0.0.1:8000/` — that whole round trip is idea #6.

### 7. Route = URL → function mapping
- **What it is**: `@app.get("/path")` says "when someone GETs this URL, call this function".
- **Find it**: `lanShare.py → index()`, `login()`, `api_drives()`, `api_list()`, `api_search()`,
  `upload()`, `download()`, `download_head()`, `zip_start()`, `zip_status()`, `zip_download()`,
  `delete()`, `bag_list()`, `bag_add()`, `bag_remove()`, `bag_pull()`, `bag_clear()`
- **Do it**: add `@app.get("/ping")` returning `{"pong": True}`; visit `/ping`. (Now add auth to it —
  see idea 15.)

### 8. Path parameters and the catch-all
- **What it is**: part of the URL is a variable passed to the function. `{subpath:path}` is a
  *catch-all*: it matches any number of segments including slashes (`/files/C/Windows/System32/x.ini`).
- **Find it**: `lanShare.py → download(share, subpath)` (`/files/{share}/{subpath:path}`),
  `delete(share, subpath)`, `zip_folder(share, subpath)`, `icon(icon_name)`
- **Do it**: trace how a URL like `/files/G/Downloads/movie.mp4` fills the two parameters.

### 9. Request object
- **What it is**: everything the client (browser/phone) sends — headers, cookies, body.
- **Find it**: `request: Request` in every route, e.g. `lanShare.py → index(request)`;
  `request.query_params.get(...)` in `upload()` reads `root`/`path`
- **Do it**: `return {"cookies": request.cookies}` in a test route and log in with a cookie.

### 10. Response types
- **What it is**: a route returns different kinds of answers: HTML, JSON, a file, a redirect, or a status.
- **Find it**: `HTMLResponse` in `index()`; `JSONResponse` in `api_drives()` / `api_list()` /
  `api_search()` / `zip_start()` / `zip_status()` / `upload()` / `delete()`; `RedirectResponse` in
  `login()` / `download()` / `zip_download()`; `FileResponse` in `download()` / `zip_download()` and
  the css/js/icons routes; bare `Response(status_code=...)` in `download_head()`
- **Do it**: change the "missing file" case in `download_head()` to
  `JSONResponse({"error":"missing"}, status_code=404)` and HEAD a missing file.

### 11. Status codes
- **What it is**: 200 ok, 303 redirect after login, 401 unauthorized, 403 outside a share / read-only,
  404 not found, 423 locked file.
- **Find it**: every `status_code=` in `lanShare.py`
- **Do it**: make the delete route return 418 when the file is "not found".

### 12. Three ways a client sends data
- **What it is**: form fields (`login`), query parameters (`/api/list?root=C&path=`), and path
  parameters (`/files/C/Folder/file.txt`). Each is read with a different API.
- **Find it**: `lanShare.py → login()` (`await request.form()`), `api_list(root, path)`,
  read via `request.query_params` in `upload()`
- **Do it**: change `login()` to also accept `?pin=1234` in the URL.

---

## Group C — security concepts

### 13. Random secrets
- **What it is**: `secrets.randbelow` and `token_hex` are cryptographically random (unlike `random`).
- **Find it**: `lanShare.py → PIN`, `signer`
- **Do it**: run `.venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(8))"`.

### 14. Signed cookie
- **What it is**: after you log in with the PIN, the server gives you a cookie signed so you can't fake
  it. `signer.loads` throws `BadSignature` if tampered.
- **Find it**: `lanShare.py → signer`, `is_authed()`
- **Do it**: in DevTools delete the cookie, reload the page, log back in.

### 15. The auth guard pattern
- **What it is**: at the top of every protected route: "if not authed, bail out early."
- **Find it**: `lanShare.py → is_authed()` — used at the top of every route that needs it
- **Do it**: add auth protection to a route that lacks it (your `/ping` from idea 7).

### 16. Path traversal defence
- **What it is**: attack where `../` reaches outside the allowed folder. Defence: `resolve()` then
  `relative_to()` must stay inside the share root. One helper (`safe_rel`) guards download, zip,
  upload and delete.
- **Find it**: `lanShare.py → safe_rel()`; callers include `download()`, `zip_start()`,
  `zip_download()`, `delete()`, `api_search()`
- **Do it**: curl `/files/C/..%2F..%2FWindows/win.ini` — it must bounce back to the login page.
  Try the same through `/zip` (POST `/zip/C/..%2F..%2FWindows/start` → 403), `/api/list?root=C&path=..%2F..%2FWindows`,
  and `/api/search?root=C&path=..%2F..%2FWindows&q=x`.

### 17. Filename sanitising
- **What it is**: strip `/` and `\` from an uploaded name so it can't escape or create subfolders.
- **Find it**: `lanShare.py → safe_filename()`
- **Do it**: call it with `"../../evil.txt"` in a REPL and guess the result first.

### 18. Unique names on conflict
- **What it is**: uploading `a.txt` twice makes `a_1.txt` instead of overwriting.
- **Find it**: `lanShare.py → unique_path()`
- **Do it**: upload the same file twice and inspect both names.

---

## Group D — file upload

### 19. Chunked streaming
- **What it is**: don't load the whole file into memory; read and write 1 MB at a time.
- **Find it**: `lanShare.py → upload()` (the `while True:` read-chunk loop)
- **Do it**: change 1 MB to 256 KB, upload, verify the file is identical (byte count).

### 20. Why async
- **What it is**: `async`/`await` = don't block while waiting for network/disk. One user's slow upload
  doesn't freeze others.
- **Find it**: every route is `async def ...` `lanShare.py`
- **Do it**: put `await asyncio.sleep(2)` in `/ping` and hit it twice — both wait, neither blocks.

---

## Group E — the browser side (lanshare.js)

### 21. DOM = the page as a tree
- **What it is**: `document.getElementById("fileRows")` grabs a hole in the HTML that JS fills.
- **Find it**: `lanshare.js → const tbody`; HTML → `id="fileRows"`, `id="breadcrumb"`,
  `id="drivesList"`, `id="dropzoneLabel"`
- **Do it**: in the browser console type `document.getElementById("fileCount").textContent = "hi"`.

### 22. Building HTML with code
- **What it is**: `createElement` + `appendChild` build table rows without injecting strings → safe
  against script injection.
- **Find it**: `lanshare.js → loadListing()` (the `for (const item of all)` row-building loop)
- **Do it**: rewrite the size cell using `innerHTML` instead and spot why it's riskier.

### 23. fetch = AJAX call
- **What it is**: JS asks the server for JSON without reloading the page; `await` waits for it.
- **Find it**: `lanshare.js → loadListing()` (fetches `/api/list`), `loadDrives()` (fetches `/api/drives`)
- **Do it**: make `loadListing()` show "Loading..." until the request returns.

### 24. XHR + upload progress
- **What it is**: `XMLHttpRequest` gives `onprogress` events → live progress bar. `fetch` can't report
  upload progress easily.
- **Find it**: `lanshare.js → uploadFiles()`, `onTransferProgress()`
- **Do it**: delete the `rate` field line in `onTransferProgress()` and watch the Transfer panel lose its
  speed readout — then undo.

### 25. Blob + programmatic download
- **What it is**: fetch the bytes, wrap them as a "Blob", create a temp URL, click a fake `<a download>`.
- **Find it**: `lanshare.js → downloadFile()`; the limit is `BLOB_LIMIT`
- **Do it**: lower `BLOB_LIMIT` to 1 MB, download the big zip, confirm the "native download" fallback.

### 26. Building safe URLs: encodeURIComponent
- **What it is**: filenames can contain `/`, `#`, `?`, spaces, non-ASCII. Encoding each segment turns
  them into `%XX` so they survive inside a URL.
- **Find it**: `lanshare.js → fileUrl()`, `zipUrl()`, `deleteUrl()`, `listQuery()`
- **Do it**: make a folder `my photos #2` and watch what the URL request line contains (DevTools → Network).

### 27. event.preventDefault
- **What it is**: stop the browser's default behaviour (navigating/opening a file) and do your own thing.
- **Find it**: `lanshare.js → the body drag handlers` and the Download click handler (`data-dl`)
- **Do it**: remove `preventDefault` from the drag handlers, drop a file — the browser navigates to it.

### 28. Event delegation
- **What it is**: one listener on the table handles clicks on ALL rows, current and future. `closest()`
  walks UP from the click to find the row's element. One handler serves the zip, download AND delete
  buttons — see the two `tbody.addEventListener("click", ...)` blocks.
- **Find it**: `lanshare.js → tbody.addEventListener("click", ...)` (both of them);
  the delete branch uses `closest("[data-del]")`
- **Do it**: explain to a friend how `closest("[data-del]")` finds the button's row.

### 29. Data attributes
- **What it is**: `data-zip`, `data-dl`, `data-name`, `data-size`, `data-del` are extra fields glued to
  HTML elements so JS can read the row's file name and size.
- **Find it**: `lanshare.js → loadListing()` (button creation), then the click handlers
- **Do it**: add `data-date` to each row and print it in the click handler.

### 30. Sets for lookups
- **What it is**: `new Set(["jpg", ...])` = instant membership check `IMG.has(ext)`.
- **Find it**: `lanshare.js → IMG/VID/AUD/ARC/DOC`, `iconFor()`
- **Do it**: add `.json` to the DOC set.

### 31. Early-return guard
- **What it is**: `if (appView.hidden || !current.root) return;` stops code that shouldn't run on the
  login screen — this killed your infinite reload bug.
- **Find it**: `lanshare.js → loadListing()` (first line)
- **Do it**: temporarily remove the line, open the PIN page, and watch the reload loop.

### 32. The JS state machine
- **What it is**: `current = { root, path, rootName }` IS the browser's memory of where you are.
  Opening a folder = mutate `current.path` then re-`loadListing()`. The breadcrumb is built from the
  same segments.
- **Find it**: `lanshare.js → current`, `openDrive()`, `openFolder()`, `goUp()`, `renderBreadcrumb()`
- **Do it**: browse into a folder while `console.log(current)` — type it in the console.

---

## Group F — the visible UI (HTML + CSS)

### 33. hidden attribute + two views
- **What it is**: the server decides which of two blocks (login vs app) gets `hidden`; the other shows.
  The app itself swaps between `view-files` and `view-drives`.
- **Find it**: `lanshare.html → id="loginView"`, `id="appView"`, `id="view-files"`, `id="view-drives"`;
  server logic `index()`; client logic `lanshare.js → showView()`
- **Do it**: swap the two `..._hidden` placeholder conditions in `index()` and log in — see the flip.

### 34. Template placeholders
- **What it is**: `{{lan_ip}}` is a marker the server replaces before sending HTML (`page.replace`).
- **Find it**: `lanShare.py → index()` (the `.replace(...)` calls)
- **Do it**: add a `{{year}}` placeholder and replace it in `index()`.

### 35. CSS Flexbox sidebar
- **What it is**: `display:flex` lays content in a row/column; `flex: 0 0 220px` keeps the sidebar a
  fixed width.
- **Find it**: `style.css → .app-shell`, `#sidebar`
- **Do it**: change the sidebar width to 150px and watch the layout reflow.

### 36. Media queries (mobile switch)
- **What it is**: different CSS on small screens — the sidebar becomes a bottom tab bar.
- **Find it**: `style.css → @media (max-width: 767px)`
- **Do it**: change 767 to 900 and resize.

### 37. Responsive hiding of columns
- **What it is**: hide Size/Date on phones with `display:none` so Name + buttons survive.
- **Find it**: `style.css → inside the @media block`, the `.col-size`/`.col-date` rules
- **Do it**: comment those two lines out and resize — see the mess.

---

## Group G — making it feel like an app (PWA)

### 38. Manifest
- **What it is**: a JSON file that tells browsers "this site is an installable app" (name, icons, theme).
- **Find it**: `manifest.webmanifest`; served by `lanShare.py → manifest()`
- **Do it**: change `theme_color` and `background_color`, refresh the phone.

### 39. Service worker
- **What it is**: a background script that caches the app shell and intercepts requests (network-first,
  cache fallback).
- **Find it**: `sw.js`; served by `lanShare.py → service_worker()`
- **Do it**: in browser DevTools → Application → Service Workers → Update; watch it re-cache.

### 40. Install prompt
- **What it is**: the browser's install event; we grab it and expose our own "Install App" button.
- **Find it**: `lanshare.js → beforeinstallprompt`, `installBtn`
- **Do it**: break the service-worker registration and see the install button disappear.

---

## Group H — the network-share browser (v2, this is the real feature)

### 41. Drive detection
- **What it is**: Windows: loop `C:`..`Z:` and keep the letters that exist. Linux: read `/proc/mounts`
  and drop virtual filesystems (tmpfs, sysfs…). The same piece of code, two operating systems.
- **Find it**: `lanShare.py → detect_drives()`; result merged with extra shares in `build_shares()`
- **Do it**: plug in a USB stick and rerun — the new drive appears in the Drives tab without restart
  code changes (run the server again) and is browsable in the browser.

### 42. Zipping a folder — the background job
- **What it is**: zipping a big folder is slow, so `zip_start()` launches a **thread** that counts the
  bytes, then writes the zip. The browser **polls** `zip_status()` every 400 ms and shows the same
  progress bar filling from "Counting…" through "Zipping… %" and into the download %. When the
  download finishes, a `BackgroundTask` deletes the temp zip.
- **Find it**: `lanShare.py → zip_start()`, `zip_status()`, `zip_download()`, `_zip_worker()`,
  `ZIP_JOBS`; client side `lanshare.js → downloadZip()`, `updateZipBar()`, `transferZip()`
- **Do it**: while a big folder zips, open `/zip/status/<job>` in another tab and watch the JSON
  `done`/`total` numbers climb.

### 43. Read-only shares
- **What it is**: a share can be `writable: false`; upload and delete then return 403 before touching
  the disk. Drives show an "Online / Read-only" badge instead of the writable one.
- **Find it**: `lanShare.py → upload()` and `delete()` (the `if not share["writable"]` guard);
  `lanshare.js → loadDrives()` badge + `delete()` button check
- **Do it**: set `"writable": false` on the lanshare share, restart, try an upload from the phone — 403.

### 44. The Drives view
- **What it is**: `/api/drives` returns the full list (type, path, writable, online, and now **size +
  free space** via `shutil.disk_usage`). The parent "Open" button calls `openDrive()` which sets
  `current.root` and jumps to the Files view — the state machine in action. Each card is also a drag
  target: dropping a file on a drive root uploads it there.
- **Find it**: `lanShare.py → api_drives()`; `lanshare.js → loadDrives()`, `openDrive()`
- **Do it**: add a share with a path that doesn't exist; it should show "Offline" and no Open button.

---

## Group I — search & go-to-path (M1)

### 45. Recursive search
- **What it is**: `/api/search` walks the folder tree with `os.scandir` (depth- and result-capped so a
  3 TB drive stays responsive) and returns every entry whose name contains the query. The client
  debounces the keystrokes (300 ms) and marks each result with a "previous request" sequence number so
  an old slow answer can't paint over a new one.
- **Find it**: `lanShare.py → api_search()` (`walk()` closure, `SKIP_SEARCH`, `limit`/`depth`);
  `lanshare.js → runSearch()`, `renderSearchResults()`, the `searchSeq` counter
- **Do it**: search "hello" on a drive — then curl `/api/search?root=G&path=&q=hello&depth=1` and see
  the depth cap hide anything nested.

### 46. The address bar (paste a Windows path)
- **What it is**: the breadcrumb has a pencil button that swaps it for a text field. You paste
  `G:\Downloads\songs` and press Enter. The **client** maps the text to a share+relative path using a
  longest-prefix match against the drives list — no server change, and it normalises `\` → `/`.
- **Find it**: `lanshare.js → findShareForPath()`, `displayPath()`, `commitPath()`; `Ctrl+L` also opens it
- **Do it**: paste a path you copied from Windows Explorer, then paste one that isn't a shared drive
  (`H:\...`) and read the alert.

### 47. One progress bar across two phases
- **What it is**: a single transfer row tracks two separate efforts — the server zip job (0–90%, by
  polling) and the XHR blob download of the finished file (90–100%, by `onprogress`). Same bar, both
  islands of progress, one finish state.
- **Find it**: `lanshare.js → updateZipBar()` (zip phase), `transferZip()` (download phase),
  `setStatus()` (final)
- **Do it**: lower the 88 to 40 in `updateZipBar()` and watch the zip phase overflow the bar before
  the file even starts coming down.

---

## Group J — the Bag (M2)

### 48. The Bag — no-copy pointers
- **What it is**: a file row's 💼 button (or dragging the row onto the Bag panel) stores only a
  **pointer** — `{id, share, path, name, size, added}` — into a `bag.json` list. Zero bytes are
  copied. The bag endures restarts, dedupes by share+path, shows a "gone" badge when a stashed file
  has vanished, and clicking a row jumps you to the folder that holds it.
- **Find it**: `lanShare.py → BagStore`, `bag_list()`, `bag_add()`; `lanshare.js → handleStash()`,
  `refreshBag()`, `renderBagRows()`, the `BAG_MIME` drag protocol
- **Do it**: stash the same file twice — the second response has `"already": true`. Delete the real
  file, reopen the Bag, and watch the red "gone" badge.

### 49. Pulling from the Bag — copy vs move
- **What it is**: "Pull into current folder" (or dropping a bag row onto any folder row / drive card)
  materialises the pointers. `copy` writes the files and keeps the bag entries; `move` writes them,
  then drops the entries, leaving exactly one copy on disk. Name clashes auto-rename
  (`name_1.ext`), and an entry whose source vanished is reported as `failed` rather than crashing.
- **Find it**: `lanShare.py → bag_pull()` (`shutil.copy2` / `shutil.move`, `unique_path`);
  `lanshare.js → pullBag()`, `bagDropPull()`, `announceBagPull()`
- **Do it**: move a stashed file into the folder it already lives in — watch `unique_path` mint a
  `_1` twin instead of overwriting.

---

## Group K — multi-device (M3)

> Same PIN on every device. Every device serves its own web app; one of them can act as a **hub** that
> keeps a registry of the others and **proxies** reads/writes to them through `/peer/{id}/...`. No mDNS,
> no UDP broadcast — a device that knows the hub's URL simply registers itself over HTTP.

### 50. Device identity
- **What it is**: each install needs a stable id so the hub can address it. Ids come from
  `LANSHARE_DEVICE_ID` (env), else a persisted random hex from `device.id`. The same env also names
  the device (`LANSHARE_DEVICE_NAME`) and picks its port (`LANSHARE_PORT`, default 8000).
- **Find it**: `lanShare.py → get_device_id()`, `DEVICE_ID`, `PORT`, `DEVICE_NAME`
- **Do it**: run two copies on different ports with `LANSHARE_DEVICE_ID` set and watch each print its own id.

### 51. The shared machine token
- **What it is**: devices authenticate to each other with one shared secret — `LANSHARE_TOKEN` or a
  hash of the PIN. `is_authed()` now accepts it as an `X-LANSHARE-TOKEN` header OR a signed session
  cookie, so the hub can present the token on a peer's behalf while browsers keep logging in with the
  PIN. `peer_token_ok()` is the stricter check on the registry routes.
- **Find it**: `lanShare.py → TOKEN`, `is_authed()`, `peer_token_ok()` (`secrets.compare_digest`)
- **Do it**: `curl -H "X-LANSHARE-TOKEN: ..." http://host/api/list?root=...` — no login needed.

### 52. Peer registry
- **What it is**: the hub stores devices in `devices.json` (`id`, `name`, `url`, `last_seen`).
  `/api/device/register` upserts a device (validated id/url), `/api/device/heartbeat` refreshes
  `last_seen`, and `/api/peers` lists everyone with an `online` flag = seen in the last 60 s.
- **Find it**: `lanShare.py → _load_peers/_save_peers/find_peer`, `device_register()`,
  `device_heartbeat()`, `api_peers()`; the file `devices.json`
- **Do it**: register a fake device by hand with curl, then check `/api/peers` shows it — wait 60 s and
  it flips to offline.

### 53. The reverse proxy (`/peer/{id}/{path}`)
- **What it is**: one generic route forwards any request to a peer and streams the answer back,
  after passing its own auth check. It keeps only a safe list of headers, forwards the
  `X-LANSHARE-TOKEN` (so the peer accepts it), streams the body (big downloads stay streaming), and
  returns 502 when the peer is unreachable.
- **Find it**: `lanShare.py → peer_proxy()` (`httpx` `client.send(..., stream=True)` + `StreamingResponse`
  with `BackgroundTask(r.aclose)`)
- **Bug to remember**: the first version wrapped the call in `async with client.stream(...)` and built
  the response *after* the block — exiting the context closed the httpx stream, so every proxied body
  aborted with `httpx.StreamClosed`. The response must keep the stream open until consumed.
- **Do it**: browse a peer's folder, then `curl -o file http://hub/peer/<id>/files/...` to fetch a big file.

### 54. The registration loop
- **What it is**: when `LANSHARE_HUB_URL` is set, the device starts a daemon thread that POSTs
  `/api/device/register` every 15 s with its id/name and `LANSHARE_ADVERTISE_URL` (or a LAN IP guess),
  so the hub registry stays fresh automatically.
- **Find it**: `lanShare.py → _peer_registration_loop()`, `main()`
- **Do it**: start a hub and a node with the hub URL, watch the hub console print `device registered`.

### 55. The peer switcher on the frontend
- **What it is**: the Drives view shows a bar of device chips. Picking one sets `peerState`, and
  `peerPrefix()` prepends `/peer/{id}` to every API call, file URL, zip endpoint, and bag call — so
  browsing, searching, uploading, zipping, and stashing all happen on the *selected device* while the
  UI stays identical.
- **Find it**: `lanshare.js → loadPeers()`, `peerPrefix()`, `peerState`; `lanshare.html → #peerBar`;
  the service worker skips `/peer/` (`sw.js`)
- **Do it**: pick a peer chip, navigate it like a local drive, then stash one of its files in the bag.

### 56. Folders and virtual zips in the Bag
- **What it is**: the Bag entries gained a `kind` — `file`, `dir`, or `zip`. Folders store a pointer and
  a `_dir_size` snapshot; pulling copies/moves the whole tree. "Zip → Bag" runs the zip job then moves
  the finished temp archive into `.bag_stash/<job_id>.zip` as a durable entry (`kind: "zip"`) that is
  deleted after one pull.
- **Find it**: `lanShare.py → _dir_size()`, `bag_add()`, `bag_add_zip()`, `bag_pull()`; the
  `destination inside the folder` guard (a folder may not be pulled into itself — `shutil.copytree`
  would recurse forever); `lanshare.js → stashZipFromJob()`, the 💼 ZIP button
- **Do it**: stash a folder, then try to pull it into one of its own subfolders — read the `failed`
  reason the guard returns.

### 57. Recent files — parsing a .lnk
- **What it is**: Windows keeps a `.lnk` shortcut for every file opened recently, in
  `%APPDATA%\Microsoft\Windows\Recent`. A shortcut is a *binary* file, but a tiny structured one:
  a 76-byte header whose LinkFlags (offset 0x14) say what follows, plus a LinkInfo block holding the
  target path as NUL-terminated text. `/api/recent` resolves the newest ones to real files and
  `/api/recent/file?path=` serves one — so "send what I just edited" is one hop from any device.
- **Find it**: `lanShare.py → resolve_lnk()` (`struct.unpack_from`, `utf-16-le`/`cp1252`),
  `api_recent()`, `recent_file()`; `lanshare.js → openRecent()`, `downloadRecent()`,
  `jumpToRecent()` (reuses `findShareForPath` so rows jump to the owning share)
- **Do it**: open a Random file in Notepad, then hit `/api/recent` — it's listed first. Add the Recent
  card to the Drives view and it shows the same list.

### 58. Zero-config LAN discovery (UDP)
- **What it is**: the hub registry answers "who pressed the same PIN", but that still needs someone to
  run the hub. So every instance *also* whispers on the LAN: a tiny JSON blob (id + name + url) is
  multicasted to `239.255.43.21:41337` every 5 s, and each instance listens on that same address,
  remembering who it has heard from recently. The noisy process is self-quieting — a received announce
  whose `id == DEVICE_ID` is thrown away. So two PCs that never configured a hub see each other appear
  on the radar as soon as they're on the same network. `LANSHARE_DISCOVERY_PEERS` unicasts to specific
  `host:port` pairs (not just the multicast group) — which is exactly what the test harness uses to run
  3 processes on one machine deterministically.
- **Find it**: `lanShare.py → _discovery_loop()`, `_ingest_discovery()`, `api_peers()` (merges the
  `devices.json` registry with `DISCOVERED`), `find_peer()` (fallback to discovered entries so the
  `/peer/{id}/...` proxy works hub-less too)
- **Do it**: `LANSHARE_DISCOVERY=0` to turn it off; run two instances on two machines with no pin
  registry and watch both radars light up.

### 59. The radar (a sweep, not a list)
- **What it is**: instead of buttons, the Drives view draws a sonar: a circular screen with radial rings
  and a `conic-gradient` sweep animated by a CSS `@keyframes` spin. Each peer is a dot on the circle
  (online = green pulse via `filter: drop-shadow`, offline = gray, selected = cyan), label beneath its
  dot; "You" sit in the center. The frontend polls `/api/peers` every 5 s while the view is open so
  online/offline transitions and new arrivals appear live.
- **Find it**: `style.css → .peer-radar/.radar-sweep/.blip`; `lanshare.js → loadPeers()` rebuilding
  the radar (`bar.innerHTML = ""` then absolute dots at `50 + 42*cos(θ)` / `50 + 42*sin(θ)`), polled by
  the `peerTimer` interval from `showView("drives")`
- **Do it**: open Drives with a phone also running the app on the same WiFi — its dot should blink
  green within 5–10 s; click it to browse that phone.

---

## The interview rebuild drill

Take `lanShare.py` (the server) and write it from an empty file in under 40 minutes with ONLY this checklist:

1. imports + paths + config (`detect_drives` + `build_shares`)
2. PIN + signed-cookie signer + `is_authed`
3. `GET /` serving the HTML with placeholders swapped
4. `POST /login` set cookie
5. `GET /api/drives` (drives + shares + size/free) and `GET /api/list?root=&path=`
6. `GET /api/search?root=&path=&q=` (walk with depth/limit caps)
7. `POST /upload?root=&path=` streaming big files to disk (unique name)
8. `GET /files/{share}/{subpath:path}` + `HEAD`
9. `POST /zip/{share}/{subpath:path}/start` + `GET /zip/status/{id}` + `GET /zip/download/{id}`
10. `POST /files/{share}/{subpath:path}/delete`
11. the `safe_rel` traversal guard used by every filesystem route
12. the Bag: `GET /api/bag`, `POST /api/bag/add` · `/api/bag/remove` · `/api/bag/pull` · `/api/bag/clear`
    (+ `kind` file/dir/zip, `add-zip` stash, destination-inside-source guard)
13. multi-device: device id + shared token, `register`/`heartbeat`/`peers`, the generic streaming
    `/peer/{id}/{path}` proxy, and the registration loop
14. recent files: `resolve_lnk` + `GET /api/recent` + `GET /api/recent/file?path=`
15. UDP LAN discovery (`_discovery_loop` + `_ingest_discovery`, merged into `/api/peers` and `find_peer`)
16. startup panel (rich) + QR + uvicorn

Then do the same for `lanshare.js`: `loadDrives`, `openDrive`, `loadListing` + breadcrumb render,
folder navigation (state machine), live search (debounce + sequence guard), go-to-path (`findShareForPath`),
zip job polling with a two-phase progress bar, XHR progress uploads, blob download + native fallback,
the Bag (stash button, row drag via `BAG_MIME`, pull copy/move into the current folder), the
peer radar (`loadPeers` drawing dots + `peerPrefix` + `peerState`), and the
401 guard. If a step stalls longer than 20 minutes, stop, look it up, and do it from memory the next
day. Repeat weekly.