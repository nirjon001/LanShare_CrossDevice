# LEARN.md — the LAN Share code map

You didn't "watch AI build this". This file turns the app into a map you walk yourself.
Each section is ONE idea. For every idea there is:

- **What it is** — 2 sentence plain-English explanation
- **Find it** — the exact spot. References use `file → name` (function/variable/id) so they never
  drift when code moves. To jump there in VS Code: right-click → *Go to Definition*, or just search
  the name.
- **Do it yourself** — a 2-5 minute task. Do these until the answer comes without thinking.

The whole app = ~38 ideas. One page a day = a month to real ownership.

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
- **Find it**: `lanShare.py → BASE_DIR`, `current_folder()`, `resolve_upload_path()`
- **Do it**: in Python REPL, `p = Path("C:/")`; print `p / "x"`, `p.exists()`, `p.resolve()`.

### 4. Config file (shares.json)
- **What it is**: the list of folders the app serves lives in a separate file so you don't edit code.
- **Find it**: `lanShare.py → load_config()`, `active_share()`, `current_folder()`
- **Do it**: add a new share to `shares.json` pointing at any folder with files. Restart and check the Drives tab.

### 5. Global mutable "state"
- **What it is**: `active = {"id": ...}` remembers which share is selected. Any function can read/change it.
- **Find it**: `lanShare.py → active`, `active_share()`
- **Do it**: add a `console.print("active id is", active["id"])` inside `current_folder()`.

---

## Group B — the web framework (FastAPI)

### 6. What a server actually is
- **What it is**: a program that waits on a port, receives text ("HTTP request"), sends text back ("response").
- **Find it**: `lanShare.py → app = FastAPI()`, and `main() → uvicorn.run(...)`
- **Do it**: run the server, then open `http://127.0.0.1:8000/` — that whole round trip is idea #6.

### 7. Route = URL → function mapping
- **What it is**: `@app.get("/path")` says "when someone GETs this URL, call this function".
- **Find it**: `lanShare.py → index()`, `api_files()`, `api_shares()`, `select_share()`, `upload()`, `delete()`, `download()`
- **Do it**: add `@app.get("/ping")` returning `{"pong": True}`; visit `/ping`.

### 8. Path parameters `{name}`
- **What it is**: part of the URL is a variable that gets passed to the function.
- **Find it**: `lanShare.py → download(name)` (`/files/{name}`), `delete(name)`, `icon(icon_name)`
- **Do it**: add a route `/hello/{who}` returning the value of `who`.

### 9. Request object
- **What it is**: everything the client (browser/phone) sends — headers, cookies, body.
- **Find it**: `request: Request` in every route, e.g. `lanShare.py → index(request)`
- **Do it**: `return {"cookies": request.cookies}` in a test route and log in with a cookie.

### 10. Response types
- **What it is**: a route returns different types of answers: HTML, JSON, a file, a redirect, or just a status.
- **Find it**: `HTMLResponse` in `index()`; `JSONResponse` in `api_files()` / `select_share()` / `upload()`;
  `RedirectResponse` in `login()` / `download()`; `FileResponse` in `download()` and the css/js icons routes;
  bare `Response(status_code=...)` in `download_head()`
- **Do it**: change the "file missing" case in `download_head()` from `Response(404)` to
  `JSONResponse({"error":"missing"}, status_code=404)` and HEAD a missing file.

### 11. Status codes
- **What it is**: 200 ok, 303 redirect after login, 401 unauthorized, 404 not found, 423 locked.
- **Find it**: every `status_code=` in `lanShare.py`
- **Do it**: make the delete route return 418 when the file is "not found".

### 12. Form vs JSON body
- **What it is**: `await request.form()` reads form-encoded fields (login); `await request.json()`
  reads a JSON body (share select).
- **Find it**: `lanShare.py → login()` (form), `select_share()` (json)
- **Do it**: change `login()` to parse JSON too (don't worry about the HTML, just curl it).

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
- **Do it**: add auth protection to one route that lacks it (your `/ping` from idea 7).

### 16. Path traversal defence
- **What it is**: attack where `../` reaches outside the folder. Defence: `resolve()` then
  `relative_to()` must stay inside.
- **Find it**: `lanShare.py → resolve_upload_path()`
- **Do it**: curl `/files/..%2F..%2Fsecret.txt` — the file must never resolve outside the share.

### 17. Filename sanitising
- **What it is**: strip `/` and `\` from a name so it can't escape or create subfolders.
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
- **Find it**: `lanshare.js → const tbody`; HTML → `id="fileRows"`
- **Do it**: in the browser console type `document.getElementById("fileCount").textContent = "hi"`.

### 22. Building HTML with code
- **What it is**: `createElement` + `appendChild` build table rows without injecting strings → safe
  against script injection.
- **Find it**: `lanshare.js → loadFiles()` (the `for (const f of files)` row-building loop)
- **Do it**: rewrite the size cell using `innerHTML` instead and spot why it's riskier.

### 23. fetch = AJAX call
- **What it is**: JS asks the server for JSON without reloading the page; `await` waits for it.
- **Find it**: `lanshare.js → loadFiles()`, `loadShares()`
- **Do it**: make `loadFiles()` show "Loading..." until the request returns.

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

### 26. Template literals
- **What it is**: backtick strings with `${variable}`.
- **Find it**: `lanshare.js → downloadFile()`, `uploadFiles()`, and the delete `confirm(...)`
- **Do it**: change the delete `confirm` text to include the file size.

### 27. event.preventDefault
- **What it is**: stop the browser's default behaviour (navigating/opening a file) and do your own thing.
- **Find it**: `lanshare.js → the body drag handlers` and the Download click handler
- **Do it**: remove `preventDefault` from the drag handlers, drop a file — the browser navigates to it.

### 28. Event delegation
- **What it is**: one listener on the table handles clicks on ALL rows, current and future. `closest()`
  walks UP from the click to find the row's element.
- **Find it**: `lanshare.js → tbody.addEventListener("click", ...)`; the delete branch uses
  `closest("[data-del]")`
- **Do it**: explain to a friend how `closest("[data-del]")` finds the button's row.

### 29. Data attributes
- **What it is**: `data-dl`, `data-del`, `data-size` are extra fields glued to HTML elements so JS can
  read the row's file name.
- **Find it**: `lanshare.js → loadFiles()` (the Download/Delete buttons), then the click handler
- **Do it**: add `data-date` to each row and print it in the click handler.

### 30. Sets for lookups
- **What it is**: `new Set(["jpg", ...])` = instant membership check `IMG.has(ext)`.
- **Find it**: `lanshare.js → IMG/VID/AUD/ARC/DOC`, `iconFor()`
- **Do it**: add `.json` to the DOC set.

### 31. Early-return guard
- **What it is**: `if (appView.hidden) return;` stops code that shouldn't run on the login screen — this
  killed your infinite reload bug.
- **Find it**: `lanshare.js → loadFiles()` (first line)
- **Do it**: temporarily remove the line, open the PIN page, and watch the reload loop.

---

## Group F — the visible UI (HTML + CSS)

### 32. hidden attribute + two views
- **What it is**: the server decides which of two blocks (login vs app) gets `hidden`; the other shows.
- **Find it**: `lanshare.html → id="loginView"`, `id="appView"`; server logic `index()`
- **Do it**: swap the two `..._hidden` placeholder conditions in `index()` and log in — see the flip.

### 33. Template placeholders
- **What it is**: `{{lan_ip}}` is a marker the server replaces before sending HTML (`page.replace`).
- **Find it**: `lanShare.py → index()` (the four `.replace(...)` calls)
- **Do it**: add a `{{year}}` placeholder and replace it in `index()`.

### 34. CSS Flexbox sidebar
- **What it is**: `display:flex` lays content in a row/column; `flex: 0 0 220px` keeps the sidebar a
  fixed width.
- **Find it**: `style.css → .app-shell`, `#sidebar`
- **Do it**: change the sidebar width to 150px and watch the layout reflow.

### 35. Media queries (mobile switch)
- **What it is**: different CSS on small screens — the sidebar becomes a bottom tab bar.
- **Find it**: `style.css → @media (max-width: 767px)`
- **Do it**: change 767 to 900 and resize.

### 36. Responsive hiding of columns
- **What it is**: hide Size/Date on phones with `display:none` so Name + buttons survive.
- **Find it**: `style.css → inside the @media block`, the `.col-size`/`.col-date` rules
- **Do it**: comment those two lines out and resize — see the mess.

---

## Group G — making it feel like an app (PWA)

### 37. Manifest
- **What it is**: a JSON file that tells browsers "this site is an installable app" (name, icons, theme).
- **Find it**: `manifest.webmanifest`; served by `lanShare.py → manifest()`
- **Do it**: change `theme_color` and `background_color`, refresh the phone.

### 38. Service worker
- **What it is**: a background script that caches the app shell and intercepts requests (network-first,
  cache fallback).
- **Find it**: `sw.js`; served by `lanShare.py → service_worker()`
- **Do it**: in browser DevTools → Application → Service Workers → Update; watch it re-cache.

### 39. Install prompt
- **What it is**: the browser's install event; we grab it and expose our own "Install App" button.
- **Find it**: `lanshare.js → beforeinstallprompt`, `installBtn`
- **Do it**: break the service-worker registration and see the install button disappear.

---

## The interview rebuild drill

Take `lanShare.py` (the server) and write it from an empty file in under 40 minutes with ONLY this checklist:

1. imports + paths + config
2. PIN + signed-cookie signer + `is_authed`
3. `GET /` serving the HTML with placeholders swapped
4. `POST /login` set cookie
5. `GET /api/files` + `GET /api/shares` + `POST /api/share`
6. `POST /upload` streaming big files to disk (unique name)
7. `GET /files/{name}` + `HEAD` with path-traversal guard
8. `POST /files/{name}/delete`
9. startup panel (rich) + QR + uvicorn

Then do the same for `lanshare.js`: load files, build rows, click handling, XHR progress upload,
blob download, and the 401 guard. If a step stalls longer than 20 minutes, stop, look it up, and do it
from memory the next day. Repeat weekly.