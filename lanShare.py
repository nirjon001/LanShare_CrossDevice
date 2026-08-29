import sys
import os
import socket
import secrets
import json
import string
import tempfile
import zipfile
import shutil
import threading
from pathlib import Path
from datetime import datetime
import re
import uvicorn
import qrcode
from fastapi import FastAPI, Request, UploadFile, File, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from starlette.background import BackgroundTask
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

SKIP_SEARCH = {"system volume information", "$recycle.bin", "windows.old"}
ZIP_JOBS = {}

app = FastAPI()
console = Console()


def slugify(s):
    out = re.sub(r"[^A-Za-z0-9_-]", "_", s or "")
    return out or "share"


def detect_drives():
    """Windows: scan C:..Z:. Linux: real mount points only."""
    if sys.platform.startswith("win"):
        drives = []
        for letter in string.ascii_uppercase:
            p = Path(f"{letter}:/")
            if p.exists():
                drives.append({
                    "id": letter,
                    "name": f"Drive {letter}:",
                    "path": str(p),
                    "type": "drive",
                    "writable": True,
                })
        return drives

    drives = []
    skip = {
        "proc", "sysfs", "devpts", "tmpfs", "devtmpfs", "cgroup",
        "cgroup2", "pstore", "securityfs", "debugfs", "tracefs",
        "fusectl", "configfs", "binfmt_misc", "mqueue", "hugetlbfs",
        "overlay", "autofs",
    }
    try:
        lines = Path("/proc/mounts").read_text().splitlines()
    except OSError:
        return drives
    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue
        mount, fstype = parts[1], parts[2]
        if fstype in skip or mount in ("/proc", "/sys", "/dev"):
            continue
        label = "Root" if mount == "/" else mount.rstrip("/").split("/")[-1] or mount
        drives.append({
            "id": slugify(mount),
            "name": f"/{label}",
            "path": mount,
            "type": "drive",
            "writable": True,
        })
    return drives


def build_shares():
    shares = []
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        for s in data.get("shares", []):
            shares.append({
                "id": slugify(s.get("id") or s.get("path")),
                "name": s.get("name") or str(s.get("path")),
                "path": str(s.get("path", "")),
                "type": "share",
                "writable": bool(s.get("writable", True)),
            })
    except (json.JSONDecodeError, OSError):
        pass
    for d in detect_drives():
        if d["id"] not in {s["id"] for s in shares}:
            shares.append(d)
    return shares


SHARES = build_shares()


def share_by_id(sid):
    for s in SHARES:
        if s["id"] == sid:
            return s
    return None


def is_authed(request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return False
    try:
        return bool(signer.loads(token).get("ok"))
    except BadSignature:
        return False


def safe_rel(share, relpath):
    """Resolve a relative path inside a share. Returns (base, target) or (None, None)."""
    base = Path(share["path"]).resolve()
    rel = (relpath or "").lstrip("/\\")
    target = (base / rel).resolve() if rel else base
    try:
        target.relative_to(base)
    except ValueError:
        return None, None
    return base, target


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    ok = is_authed(request)
    page = TEMPLATE_FILE.read_text(encoding="utf-8")
    page = page.replace("{{lan_ip}}", get_lan_ip())
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


@app.get("/api/drives")
async def api_drives(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    out = []
    for s in SHARES:
        online = Path(s["path"]).is_dir()
        size = free = 0
        if online:
            try:
                usage = shutil.disk_usage(s["path"])
                size, free = usage.total, usage.free
            except OSError:
                pass
        out.append({
            "id": s["id"],
            "name": s["name"],
            "path": s["path"],
            "type": s["type"],
            "writable": s["writable"],
            "online": online,
            "size": size,
            "free": free,
        })
    return out


@app.get("/api/list")
async def api_list(request: Request, root: str, path: str = ""):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    share = share_by_id(root)
    if share is None:
        return JSONResponse({"ok": False, "error": "no such share"}, status_code=404)
    base, target = safe_rel(share, path)
    if target is None:
        return JSONResponse({"ok": False, "error": "outside share"}, status_code=403)
    if not target.is_dir():
        return JSONResponse({"ok": False, "error": "not a folder"}, status_code=404)
    dirs, files = [], []
    try:
        for p in target.iterdir():
            try:
                if p.is_dir():
                    dirs.append({"name": p.name, "mtime": p.stat().st_mtime})
                elif p.is_file():
                    st = p.stat()
                    files.append({"name": p.name, "size": st.st_size, "mtime": st.st_mtime})
            except OSError:
                dirs.append({"name": p.name, "mtime": 0, "locked": True})
    except OSError as e:
        return JSONResponse({"ok": False, "error": f"cannot read folder: {e}"}, status_code=403)
    dirs.sort(key=lambda d: d["name"].lower())
    files.sort(key=lambda d: d["name"].lower())
    return {
        "ok": True,
        "root": root,
        "path": path,
        "name": target.name or share["name"],
        "writable": share["writable"],
        "dirs": dirs,
        "files": files,
    }


@app.get("/api/search")
async def api_search(request: Request, root: str, path: str = "", q: str = "",
                     limit: int = 200, depth: int = 10):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    share = share_by_id(root)
    if share is None:
        return JSONResponse({"ok": False, "error": "no such share"}, status_code=404)
    base, target = safe_rel(share, path)
    if target is None:
        return JSONResponse({"ok": False, "error": "outside share"}, status_code=403)
    if not target.is_dir():
        return JSONResponse({"ok": False, "error": "not a folder"}, status_code=404)
    needle = (q or "").strip().lower()
    results = []
    if not needle:
        return {"ok": True, "results": results}
    limit = max(1, min(limit, 500))
    depth = max(1, min(depth, 25))

    def walk(scan_dir, rel, level):
        if len(results) >= limit or level > depth:
            return
        try:
            with os.scandir(scan_dir) as it:
                entries = sorted(it, key=lambda e: e.name.lower())
        except OSError:
            return
        for e in entries:
            if len(results) >= limit:
                return
            try:
                is_dir = e.is_dir(follow_symlinks=False)
                if needle in e.name.lower():
                    try:
                        st = e.stat()
                        results.append({
                            "name": e.name,
                            "kind": "dir" if is_dir else "file",
                            "size": st.st_size,
                            "mtime": st.st_mtime,
                            "path": "/".join(p for p in (rel, e.name) if p),
                        })
                    except OSError:
                        results.append({"name": e.name, "kind": "dir", "size": 0,
                                        "mtime": 0,
                                        "path": "/".join(p for p in (rel, e.name) if p)})
                if is_dir and e.name.lower() not in SKIP_SEARCH:
                    walk(e.path, "/".join(p for p in (rel, e.name) if p), level + 1)
            except OSError:
                continue

    walk(target, "", 1)
    return {"ok": True, "results": results}


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
    share = share_by_id(request.query_params.get("root", ""))
    if share is None:
        return JSONResponse({"ok": False, "error": "no such share"}, status_code=404)
    if not share["writable"]:
        return JSONResponse({"ok": False, "error": "this share is read-only"}, status_code=403)
    base, target = safe_rel(share, request.query_params.get("path", ""))
    if target is None or not target.is_dir():
        return JSONResponse({"ok": False, "error": "bad folder"}, status_code=400)
    for f in files:
        name = safe_filename(f.filename)
        dest = unique_path(target, name)
        try:
            with open(dest, "wb") as out:
                while True:
                    chunk = await f.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
        except OSError as e:
            return JSONResponse({"ok": False, "error": f"could not save: {e}"}, status_code=500)
        console.print(f"[green]saved[/green] [cyan]{dest}[/cyan]")
    return {"ok": True, "saved": len(files)}


@app.get("/files/{share}/{subpath:path}")
async def download(request: Request, share: str, subpath: str = ""):
    if not is_authed(request):
        return RedirectResponse("/", status_code=307)
    s = share_by_id(share)
    if s is None:
        return RedirectResponse("/", status_code=307)
    base, target = safe_rel(s, subpath)
    if target is None or not target.is_file():
        return RedirectResponse("/", status_code=307)
    return FileResponse(target, filename=target.name)


@app.head("/files/{share}/{subpath:path}")
async def download_head(request: Request, share: str, subpath: str = ""):
    if not is_authed(request):
        return Response(status_code=401)
    s = share_by_id(share)
    if s is None:
        return Response(status_code=404)
    base, target = safe_rel(s, subpath)
    if target is None or not target.is_file():
        return Response(status_code=404)
    return Response(headers={
        "Content-Length": str(target.stat().st_size),
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
    })


@app.post("/zip/{share}/{subpath:path}/start")
async def zip_start(request: Request, share: str, subpath: str = ""):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    s = share_by_id(share)
    if s is None:
        return JSONResponse({"ok": False, "error": "no such share"}, status_code=404)
    base, target = safe_rel(s, subpath)
    if target is None:
        return JSONResponse({"ok": False, "error": "outside share"}, status_code=403)
    if not target.is_dir():
        return JSONResponse({"ok": False, "error": "not a folder"}, status_code=404)
    folder_name = target.name or s["name"]
    job_id = secrets.token_hex(6)
    fd, tmp = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    job = {
        "id": job_id,
        "state": "working",
        "phase": "count",
        "done": 0,
        "total": 0,
        "name": folder_name,
        "path": tmp,
        "error": None,
    }
    ZIP_JOBS[job_id] = job
    console.print(f"[magenta]zipping[/magenta] [cyan]{target}[/cyan] (job {job_id})")
    threading.Thread(target=_zip_worker, args=(job, target, folder_name), daemon=True).start()
    return {"ok": True, "job_id": job_id, "name": folder_name}


@app.get("/zip/status/{job_id}")
async def zip_status(request: Request, job_id: str):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    job = ZIP_JOBS.get(job_id)
    if job is None:
        return JSONResponse({"ok": False, "error": "no such job"}, status_code=404)
    return {
        "ok": True,
        "id": job["id"],
        "state": job["state"],
        "phase": job["phase"],
        "done": job["done"],
        "total": job["total"],
        "name": job["name"],
        "error": job["error"],
    }


@app.get("/zip/download/{job_id}")
async def zip_download(request: Request, job_id: str):
    if not is_authed(request):
        return RedirectResponse("/", status_code=307)
    job = ZIP_JOBS.get(job_id)
    if job is None or job["state"] != "done" or not job["path"]:
        return RedirectResponse("/", status_code=307)
    tmp = job["path"]
    ZIP_JOBS.pop(job_id, None)
    console.print(f"[magenta]zip served[/magenta] {job['name']}.zip")
    return FileResponse(
        tmp,
        filename=f"{job['name']}.zip",
        media_type="application/zip",
        background=BackgroundTask(_remove_file, tmp),
    )


def _zip_worker(job, target, folder_name):
    total = 0
    for root_dir, _, fnames in os.walk(target):
        for fn in fnames:
            try:
                total += (Path(root_dir) / fn).stat().st_size
            except OSError:
                pass
    job["phase"] = "zip"
    job["total"] = total or 1
    try:
        with zipfile.ZipFile(job["path"], "w", zipfile.ZIP_DEFLATED) as zf:
            for root_dir, _, fnames in os.walk(target):
                root_p = Path(root_dir)
                for fn in fnames:
                    full = root_p / fn
                    try:
                        st = full.stat()
                        zf.write(full, str(Path(folder_name) / full.relative_to(target)))
                        job["done"] += st.st_size
                    except OSError:
                        continue
        job["state"] = "done"
        job["phase"] = "done"
    except Exception as e:
        job["state"] = "error"
        job["phase"] = "error"
        job["error"] = str(e)


@app.post("/files/{share}/{subpath:path}/delete")
async def delete(request: Request, share: str, subpath: str = ""):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    s = share_by_id(share)
    if s is None:
        return JSONResponse({"ok": False, "error": "no such share"}, status_code=404)
    if not s["writable"]:
        return JSONResponse({"ok": False, "error": "this share is read-only"}, status_code=403)
    base, target = safe_rel(s, subpath)
    if target is None or not target.is_file():
        return JSONResponse({"ok": False, "error": "file not found"}, status_code=404)
    try:
        target.unlink()
    except PermissionError:
        return JSONResponse({"ok": False, "error": "file is locked or read-only"}, status_code=423)
    except OSError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    console.print(f"[red]deleted[/red] [cyan]{target}[/cyan]")
    return {"ok": True}


def _remove_file(path):
    try:
        os.unlink(path)
    except OSError:
        pass


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
    drives = [s for s in SHARES if s["type"] == "drive"]
    shares = [s for s in SHARES if s["type"] != "drive"]
    drive_line = ", ".join(s["id"] if s["id"].endswith(":") else s["name"] for s in drives) or "none"
    panel = Panel(
        f"[bold]LAN Share is running[/bold]\n\n"
        f"PIN: [bold yellow]{PIN}[/bold yellow]  (enter this on any device)\n\n"
        f"Open on any device on this WiFi:\n[bold cyan]{url}[/bold cyan] (or scan the QR)\n\n"
        f"Detected drives: [green]{drive_line}[/green]\n"
        + (f"Extra shares: {', '.join(s['name'] for s in shares)}\n" if shares else "")
        + f"Edit [cyan]{CONFIG_FILE}[/cyan] to add more shares or set writable:false.\n"
        f"WARNING: any device with the PIN can read/write these drives.\n",
        title="[bold]LAN Share[/bold]",
        border_style="cyan",
    )
    console.print(panel)
    print_qr(url)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    url = f"http://{get_lan_ip()}:8000"
    print_startup(url)
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()