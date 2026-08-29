import sys
import os
import re
import time
import socket
import secrets
import json
import hashlib
import string
import tempfile
import zipfile
import shutil
import threading
from pathlib import Path
from datetime import datetime
import httpx
import uvicorn
import qrcode
from fastapi import FastAPI, Request, UploadFile, File, Response
from fastapi.responses import (FileResponse, HTMLResponse, RedirectResponse,
                               JSONResponse, StreamingResponse)
from starlette.background import BackgroundTask
from rich.console import Console
from rich.panel import Panel
from itsdangerous import URLSafeSerializer, BadSignature

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_FILE = BASE_DIR / "lanshare.html"
CONFIG_FILE = Path(os.getenv("LANSHARE_SHARES") or BASE_DIR / "shares.json")
DEVICES_FILE = BASE_DIR / "devices.json"
DEVICE_ID_FILE = BASE_DIR / "device.id"
ICON_DIR = BASE_DIR / "icons"
BAG_STASH_DIR = BASE_DIR / ".bag_stash"

PIN = os.getenv("LANSHARE_PIN") or f"{secrets.randbelow(10000):04d}"
SESSION_COOKIE = "lan_share_auth"
signer = URLSafeSerializer(secrets.token_hex(32))

PORT = int(os.getenv("LANSHARE_PORT") or 8000)
TOKEN = os.getenv("LANSHARE_TOKEN") or hashlib.sha256(f"lanshare:{PIN}".encode()).hexdigest()
HUB_URL = (os.getenv("LANSHARE_HUB_URL") or "").rstrip("/")
DEVICE_NAME = os.getenv("LANSHARE_DEVICE_NAME") or socket.gethostname().split(".")[0]
ADVERTISE_URL = (os.getenv("LANSHARE_ADVERTISE_URL") or "").rstrip("/")
PEER_TIMEOUT = 12.0

SKIP_SEARCH = {"system volume information", "$recycle.bin", "windows.old"}
ZIP_JOBS = {}
BAG_FILE = BASE_DIR / "bag.json"


def get_device_id():
    override = (os.getenv("LANSHARE_DEVICE_ID") or "").strip()
    if override and re.fullmatch(r"[A-Za-z0-9_-]+", override):
        return override
    if DEVICE_ID_FILE.is_file():
        txt = DEVICE_ID_FILE.read_text().strip()
        if txt:
            return txt
    did = secrets.token_hex(6)
    DEVICE_ID_FILE.write_text(did)
    return did


DEVICE_ID = get_device_id()

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
    hdr = request.headers.get("x-lanshare-token", "")
    if hdr and secrets.compare_digest(hdr, TOKEN):
        return True
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


class BagStore:
    """The no-copy side list: pointers to files (name + share + path), zero bytes stored."""

    def __init__(self):
        self._lock = threading.Lock()
        self._entries = self._read()

    def _read(self):
        try:
            data = json.loads(BAG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return data
        except (OSError, json.JSONDecodeError):
            pass
        return []

    def all(self):
        with self._lock:
            return list(self._entries)

    def add(self, **entry):
        with self._lock:
            self._entries = [e for e in self._entries if e.get("id") != entry["id"]]
            self._entries.append(entry)
            self._write()
            return entry

    def remove(self, ids):
        with self._lock:
            idset = set(ids)
            before = len(self._entries)
            self._entries = [e for e in self._entries if e["id"] not in idset]
            self._write()
            return before - len(self._entries)

    def _write(self):
        BAG_FILE.write_text(json.dumps(self._entries, indent=2), encoding="utf-8")


BAG = BagStore()


# ---- peer registry (hub role) ----

PEER_LOCK = threading.Lock()


def _load_peers():
    try:
        data = json.loads(DEVICES_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return []


def _save_peers(peers):
    DEVICES_FILE.write_text(json.dumps(peers, indent=2), encoding="utf-8")


def find_peer(pid):
    for p in _load_peers():
        if p.get("id") == pid:
            return p
    return None


def peer_token_ok(request):
    got = request.headers.get("X-LANSHARE-TOKEN", "")
    return bool(got) and secrets.compare_digest(got, TOKEN)


@app.get("/api/peers")
async def api_peers(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    now = time.time()
    out = []
    for e in _load_peers():
        out.append({
            "id": e.get("id"),
            "name": e.get("name"),
            "url": e.get("url"),
            "online": now - e.get("last_seen", 0) < 60,
        })
    return {"ok": True, "devices": out}


@app.post("/api/device/register")
async def device_register(request: Request):
    if not peer_token_ok(request):
        return JSONResponse({"ok": False, "error": "bad token"}, status_code=403)
    body = await request.json()
    pid = (body.get("id") or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", pid):
        return JSONResponse({"ok": False, "error": "bad device id"}, status_code=400)
    url = (body.get("url") or "").strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        return JSONResponse({"ok": False, "error": "bad url"}, status_code=400)
    name = (body.get("name") or pid)[:40].strip()
    with PEER_LOCK:
        peers = _load_peers()
        entry = {"id": pid, "name": name, "url": url, "last_seen": time.time()}
        peers = [p for p in peers if p.get("id") != pid] + [entry]
        _save_peers(peers)
    console.print(f"[green]device registered[/green] [cyan]{name}[/cyan] ({url})")
    return {"ok": True, "device": {"id": pid, "name": name, "url": url}}


@app.post("/api/device/heartbeat")
async def device_heartbeat(request: Request):
    if not peer_token_ok(request):
        return JSONResponse({"ok": False, "error": "bad token"}, status_code=403)
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    pid = (body.get("id") or "").strip()
    if not pid:
        return JSONResponse({"ok": False, "error": "bad device id"}, status_code=400)
    with PEER_LOCK:
        peers = _load_peers()
        for p in peers:
            if p.get("id") == pid:
                p["last_seen"] = time.time()
                _save_peers(peers)
                return {"ok": True}
        return JSONResponse({"ok": False, "error": "unknown device"}, status_code=404)


@app.api_route("/peer/{pid}/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "DELETE"])
async def peer_proxy(request: Request, pid: str, path: str = ""):
    if not is_authed(request):
        if request.method == "GET":
            return RedirectResponse("/", status_code=307)
        return JSONResponse({"error": "auth"}, status_code=401)
    peer = find_peer(pid)
    if peer is None:
        return JSONResponse({"ok": False, "error": "no such peer"}, status_code=404)
    target = f"{str(peer['url']).rstrip('/')}/{path}"
    if request.url.query:
        target += f"?{request.url.query}"
    headers = {"X-LANSHARE-TOKEN": TOKEN}
    ct = request.headers.get("content-type")
    if ct:
        headers["Content-Type"] = ct
    try:
        body = await request.body() if request.method in ("POST", "PUT", "PATCH", "DELETE") else None
        client = httpx.AsyncClient(timeout=PEER_TIMEOUT, follow_redirects=False)
        req = client.build_request(request.method, target, headers=headers, content=body)
        r = await client.send(req, stream=True)
        if request.method == "HEAD":
            safe = {k: v for k, v in r.headers.items()
                    if k.lower() in ("content-type", "content-length")}
            await r.aclose()
            return Response(status_code=r.status_code, headers=safe)
        safe = {k: v for k, v in r.headers.items()
                if k.lower() in ("content-type", "content-disposition",
                                 "content-length", "content-range",
                                 "accept-ranges", "etag", "last-modified")}
        return StreamingResponse(r.aiter_bytes(), status_code=r.status_code,
                                 headers=safe, background=BackgroundTask(r.aclose))
    except httpx.RequestError:
        return JSONResponse({"ok": False, "error": "peer unreachable"}, status_code=502)


@app.get("/api/bag")
async def bag_list(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    out = []
    for e in BAG.all():
        entry = dict(e)
        entry["missing"] = False
        kind = e.get("kind", "file")
        if kind == "zip":
            src = Path(e["path"])
            if not src.is_file():
                entry["missing"] = True
            else:
                entry["size"] = src.stat().st_size
        else:
            s = share_by_id(e["share"])
            if s is None:
                entry["missing"] = True
            else:
                base, target = safe_rel(s, e["path"])
                good = target is not None and target.exists()
                if kind == "dir" and good and not target.is_dir():
                    good = False
                if kind == "file" and good and not target.is_file():
                    good = False
                if not good:
                    entry["missing"] = True
                elif kind == "file":
                    entry["size"] = target.stat().st_size
        out.append(entry)
    return {"ok": True, "items": out}


def _dir_size(path):
    total = 0
    for root_dir, _, fnames in os.walk(path):
        for fn in fnames:
            try:
                total += (Path(root_dir) / fn).stat().st_size
            except OSError:
                pass
    return total


@app.post("/api/bag/add")
async def bag_add(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    body = await request.json()
    s = share_by_id(body.get("share", ""))
    if s is None:
        return JSONResponse({"ok": False, "error": "no such share"}, status_code=404)
    base, target = safe_rel(s, body.get("path", ""))
    if target is None:
        return JSONResponse({"ok": False, "error": "outside share"}, status_code=403)
    if not target.exists():
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    if target.is_dir():
        kind, size = "dir", _dir_size(target)
    elif target.is_file():
        kind, size = "file", target.stat().st_size
    else:
        return JSONResponse({"ok": False, "error": "not a file or folder"}, status_code=404)
    entry = {
        "id": secrets.token_hex(6),
        "share": s["id"],
        "path": body["path"],
        "name": target.name,
        "kind": kind,
        "size": size,
        "added": datetime.now().isoformat(timespec="seconds"),
    }
    for existing in BAG.all():
        if existing.get("share") == entry["share"] and existing.get("path") == entry["path"]:
            return {"ok": True, "already": True, "item": existing}
    BAG.add(**entry)
    console.print(f"[cyan]bag +[/cyan] {entry['kind']} {entry['name']} ({entry['size']} B)")
    return {"ok": True, "item": entry}


@app.post("/api/bag/add-zip")
async def bag_add_zip(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    body = await request.json()
    job_id = body.get("job_id", "")
    job = ZIP_JOBS.get(job_id)
    if job is None:
        return JSONResponse({"ok": False, "error": "no such job"}, status_code=404)
    if job["state"] != "done":
        return JSONResponse({"ok": False, "error": "job not finished"}, status_code=400)
    ZIP_JOBS.pop(job_id, None)
    tmp = Path(job["path"])
    if not tmp.is_file():
        return JSONResponse({"ok": False, "error": "zip gone"}, status_code=500)
    BAG_STASH_DIR.mkdir(exist_ok=True)
    stash_file = BAG_STASH_DIR / f"{job_id}.zip"
    try:
        shutil.move(str(tmp), str(stash_file))
    except OSError as ex:
        return JSONResponse({"ok": False, "error": str(ex)}, status_code=500)
    entry = {
        "id": job_id,
        "share": "_stash",
        "path": str(stash_file),
        "name": f"{job['name']}.zip",
        "kind": "zip",
        "size": stash_file.stat().st_size,
        "added": datetime.now().isoformat(timespec="seconds"),
    }
    BAG.add(**entry)
    console.print(f"[cyan]bag +[/cyan] zip {entry['name']}")
    return {"ok": True, "item": entry}


@app.post("/api/bag/remove")
async def bag_remove(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    body = await request.json()
    removed = BAG.remove(body.get("ids") or [])
    return {"ok": True, "removed": removed}


@app.post("/api/bag/pull")
async def bag_pull(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    body = await request.json()
    ids = body.get("ids") or []
    mode = body.get("mode", "copy")
    s = share_by_id(body.get("dest_root", ""))
    if s is None:
        return JSONResponse({"ok": False, "error": "no such share"}, status_code=404)
    if not s["writable"]:
        return JSONResponse({"ok": False, "error": "this share is read-only"}, status_code=403)
    base, dest = safe_rel(s, body.get("dest_path", ""))
    if dest is None:
        return JSONResponse({"ok": False, "error": "outside share"}, status_code=403)
    if not dest.is_dir():
        return JSONResponse({"ok": False, "error": "not a folder"}, status_code=404)
    done, failed, pulled_ids = [], [], []
    for e in BAG.all():
        if e["id"] not in ids:
            continue
        kind = e.get("kind", "file")
        name = e.get("name", "?")
        dest_file = None
        try:
            if kind == "zip":
                src = Path(e["path"])
                if not src.is_file():
                    failed.append({"id": e["id"], "name": name, "error": "file missing"})
                    continue
                dest_file = unique_path(dest, e.get("name") or src.name)
                shutil.copy2(str(src), str(dest_file))
                try:
                    os.unlink(src)
                except OSError:
                    pass
                pulled_ids.append(e["id"])
            else:
                src_s = share_by_id(e["share"])
                if src_s is None:
                    failed.append({"id": e["id"], "name": name, "error": "share gone"})
                    continue
                sbase, src = safe_rel(src_s, e["path"])
                if src is None or not src.exists():
                    failed.append({"id": e["id"], "name": name, "error": "file missing"})
                    continue
                if kind == "dir" and not src.is_dir():
                    failed.append({"id": e["id"], "name": name, "error": "not a folder"})
                    continue
                if kind == "file" and not src.is_file():
                    failed.append({"id": e["id"], "name": name, "error": "not a file"})
                    continue
                dest_file = unique_path(dest, src.name)
                if kind == "dir":
                    sd, dd = str(src.resolve()), str(dest_file.resolve())
                    if dd.startswith(sd + os.sep) or dd == sd:
                        failed.append({"id": e["id"], "name": name,
                                       "error": "destination inside the folder"})
                        continue
                if mode == "move":
                    shutil.move(str(src), str(dest_file))
                    pulled_ids.append(e["id"])
                elif kind == "dir":
                    shutil.copytree(src, dest_file)
                else:
                    shutil.copy2(str(src), str(dest_file))
        except (OSError, shutil.Error) as ex:
            failed.append({"id": e["id"], "name": name, "error": str(ex)})
            continue
        done.append({"id": e["id"], "name": dest_file.name, "size": dest_file.stat().st_size})
    if pulled_ids:
        BAG.remove(pulled_ids)
    console.print(f"[cyan]bag pull[/cyan] {mode}: {len(done)} ok, {len(failed)} failed")
    return {"ok": True, "done": done, "failed": failed}


@app.post("/api/bag/clear")
async def bag_clear(request: Request):
    if not is_authed(request):
        return JSONResponse({"error": "auth"}, status_code=401)
    removed = BAG.remove([e["id"] for e in BAG.all()])
    return {"ok": True, "removed": removed}


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
        f"Device: [green]{DEVICE_NAME}[/green] ([cyan]{DEVICE_ID}[/cyan])\n"
        f"Detected drives: [green]{drive_line}[/green]\n"
        + (f"Extra shares: {', '.join(s['name'] for s in shares)}\n" if shares else "")
        + (f"Hub: registering to [cyan]{HUB_URL}[/cyan]\n" if HUB_URL else "")
        + f"Edit [cyan]{CONFIG_FILE}[/cyan] to add more shares or set writable:false.\n"
        f"WARNING: any device with the PIN can read/write these drives.\n",
        title="[bold]LAN Share[/bold]",
        border_style="cyan",
    )
    console.print(panel)
    print_qr(url)


def _peer_registration_loop():
    """When pointed at a hub via LANSHARE_HUB_URL, register and stay alive."""
    payload = {
        "id": DEVICE_ID,
        "name": DEVICE_NAME,
        "url": ADVERTISE_URL or f"http://{get_lan_ip()}:{PORT}",
    }
    while True:
        try:
            with httpx.Client(timeout=5) as c:
                r = c.post(f"{HUB_URL}/api/device/register", json=payload,
                           headers={"X-LANSHARE-TOKEN": TOKEN})
                if r.status_code >= 300:
                    console.print(f"[yellow]hub register {r.status_code}[/yellow]")
        except Exception:
            pass
        time.sleep(15)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    url = f"http://{get_lan_ip()}:{PORT}"
    print_startup(url)
    if HUB_URL:
        threading.Thread(target=_peer_registration_loop, daemon=True).start()
        console.print(f"[cyan]registering to hub[/cyan] {HUB_URL} as [green]{DEVICE_NAME}[/green]")
    uvicorn.run(app, host="0.0.0.0", port=PORT)


if __name__ == "__main__":
    main()