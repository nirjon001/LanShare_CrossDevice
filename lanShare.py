import sys
import os
import socket
import secrets
import json
from pathlib import Path
from datetime import datetime
import re
import uvicorn
import qrcode
from fastapi import FastAPI, Request, UploadFile, File, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from rich.console import Console
from rich.panel import Panel
from itsdangerous import URLSafeSerializer, BadSignature

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_FILE = BASE_DIR / "lanshare.html"
CONFIG_FILE = BASE_DIR / "shares.json"
ICON_DIR = BASE_DIR / "icons"

PIN = os.getenv("LANSHARE_PIN") or f"{secrets.randbelow(10000):04d}"
SESSION_COOKIE = "lan_share_auth"
signer = URLSafeSerializer(secrets.token_hex(32))

app = FastAPI()
console = Console()


def default_share_path():
    if sys.platform.startswith("win"):
        p = Path("G:/lan share")
        if p.is_dir():
            return p
    return Path.home() / "LANShare"


def load_config():
    default = [{"id": "lanshare", "name": "LAN Share", "path": str(default_share_path())}]
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(json.dumps({"shares": default}, indent=2), encoding="utf-8")
        return default
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        shares = data.get("shares") or default
    except (json.JSONDecodeError, OSError):
        shares = default
    if not shares:
        shares = default
    return shares


SHARES = load_config()
active = {"id": SHARES[0]["id"]}


def active_share():
    for s in SHARES:
        if s["id"] == active["id"]:
            return s
    return SHARES[0]


def current_folder():
    return Path(active_share()["path"]).resolve()


def is_authed(request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return False
    try:
        return bool(signer.loads(token).get("ok"))
    except BadSignature:
        return False


def list_files(folder):
    return [
        p for p in folder.iterdir()
        if p.is_file() and not p.name.startswith(".")
    ]


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    ok = is_authed(request)
    folder = current_folder()
    try:
        files = list_files(folder)
    except OSError:
        files = []
    page = TEMPLATE_FILE.read_text(encoding="utf-8")
    page = page.replace("{{lan_ip}}", get_lan_ip())
    page = page.replace("{{count}}", str(len(files)))
    page = page.replace("{{share_name}}", active_share()["name"])
    if ok:
        page = page.replace("{{login_hidden}}", "hidden")
        page = page.replace("{{app_hidden}}", "")
        page = page.replace("{{error_msg}}", "")
    else:
        page = page.replace("{{login_hidden}}", "")
        page = page.replace("{{app_hidden}}", "hidden")
        wrong = '<div class="text-danger small mt-2">Wrong PIN, try again.</div>'
        page = page.replace("{{error_msg}}", wrong if request.query_params.get("error") else "")
    return page


@app.post("/login")
async def login(request: Request):
    form = await request.form()
    if form.get("pin") == PIN:
        resp = RedirectResponse("/", status_code=303)
        resp.set_cookie(SESSION_COOKIE, signer.dumps({"ok": True}),
                        httponly=True, samesite="lax")
        return resp
    return RedirectResponse("/?error=1", status_code=303)


@app.get("/api/files")
async def api_files(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    folder = current_folder()
    items = []
    try:
        entries = list_files(folder)
    except OSError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    for p in entries:
        st = p.stat()
        items.append({"name": p.name, "size": st.st_size, "mtime": st.st_mtime})
    items.sort(key=lambda d: d["mtime"], reverse=True)
    return items


@app.get("/api/shares")
async def api_shares(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    result = []
    for s in SHARES:
        p = Path(s["path"])
        result.append({
            "id": s["id"],
            "name": s["name"],
            "path": s["path"],
            "online": p.is_dir(),
            "selected": s["id"] == active["id"],
        })
    return result


@app.post("/api/share")
async def select_share(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid JSON body"}, status_code=400)
    sid = (body or {}).get("id")
    for s in SHARES:
        if s["id"] == sid:
            if not Path(s["path"]).is_dir():
                return JSONResponse({"ok": False, "error": "path does not exist"}, status_code=400)
            active["id"] = sid
            console.print(f"[yellow]switched to[/yellow] [cyan]{s['name']}[/cyan] -> {s['path']}")
            return {"ok": True}
    return JSONResponse({"ok": False, "error": "no such share"}, status_code=404)


@app.get("/style.css")
async def style_css():
    return FileResponse(BASE_DIR / "style.css", media_type="text/css")


@app.get("/lanshare.js")
async def lanshare_js():
    return FileResponse(BASE_DIR / "lanshare.js", media_type="text/javascript")


@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse(BASE_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
async def service_worker():
    return FileResponse(BASE_DIR / "sw.js", media_type="text/javascript")


@app.get("/icons/{icon_name}")
async def icon(icon_name: str):
    path = (ICON_DIR / safe_filename(icon_name)).resolve()
    if path.parent != ICON_DIR.resolve() or not path.is_file():
        return Response(status_code=404)
    return FileResponse(path, media_type="image/png")


@app.post("/upload")
async def upload(request: Request, files: list[UploadFile] = File(...)):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    folder = current_folder()
    for f in files:
        name = safe_filename(f.filename)
        dest = unique_path(folder, name)
        try:
            with open(dest, "wb") as out:
                while True:
                    chunk = await f.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
        except OSError as e:
            return JSONResponse({"ok": False, "error": f"could not save: {e}"}, status_code=500)
        console.print(f"[green]saved[/green] [cyan]{dest.name}[/cyan] -> {folder}")
    return {"ok": True, "saved": len(files)}


@app.get("/files/{name}")
async def download(request: Request, name: str):
    if not is_authed(request):
        return RedirectResponse("/", status_code=307)
    path = resolve_upload_path(current_folder(), name)
    if path is None:
        return RedirectResponse("/", status_code=307)
    return FileResponse(path, filename=path.name)


@app.head("/files/{name}")
async def download_head(request: Request, name: str):
    if not is_authed(request):
        return Response(status_code=401)
    path = resolve_upload_path(current_folder(), name)
    if path is None:
        return Response(status_code=404)
    return Response(headers={
        "Content-Length": str(path.stat().st_size),
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
    })


@app.post("/files/{name}/delete")
async def delete(request: Request, name: str):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    path = resolve_upload_path(current_folder(), name)
    if path is None:
        return JSONResponse({"ok": False, "error": "file not found on this share"}, status_code=404)
    try:
        path.unlink()
    except PermissionError:
        return JSONResponse(
            {"ok": False, "error": "file is locked or read-only"},
            status_code=423,
        )
    except OSError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    console.print(f"[red]deleted[/red] [cyan]{path.name}[/cyan]")
    return {"ok": True}


def safe_filename(filename):
    return re.sub(r"[/\\]", "_", filename or "") or "unnamed"


def unique_path(folder, filename):
    p = folder / filename
    if not p.exists():
        return p
    stem, suffix = p.stem, p.suffix
    for i in range(1, 1000):
        candidate = folder / f"{stem}_{i}{suffix}"
        if not candidate.exists():
            return candidate
    return folder / f"{stem}-{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}{suffix}"


def resolve_upload_path(folder, name):
    candidate = (folder / safe_filename(name)).resolve()
    folder_r = folder.resolve()
    try:
        candidate.relative_to(folder_r)
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    return candidate


def get_lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    finally:
        s.close()


def print_qr(url):
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)


def print_startup(url):
    panel = Panel(
        f"[bold]LAN Share is running[/bold]\n\n"
        f"PIN: [bold yellow]{PIN}[/bold yellow]  (enter this on any device)\n\n"
        f"Open on any device on this WiFi:\n[bold cyan]{url}[/bold cyan]\n\n"
        f"Active share: [green]{active_share()['name']}[/green] -> {current_folder()}\n"
        f"Edit [cyan]{CONFIG_FILE}[/cyan] to add drives/shares.\n",
        title="[bold]LAN Share[/bold]",
        border_style="cyan",
    )
    console.print(panel)
    print_qr(url)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    folder = current_folder()
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        console.print(f"[yellow]warning: could not create {folder}: {e}[/yellow]")
    url = f"http://{get_lan_ip()}:8000"
    print_startup(url)
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()