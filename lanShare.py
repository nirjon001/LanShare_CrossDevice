import sys
import socket
from pathlib import Path
from datetime import datetime
import re
import uvicorn
import qrcode
from fastapi import FastAPI, UploadFile, File, Response
from fastapi.responses import FileResponse, HTMLResponse
from rich.console import Console
from rich.panel import Panel

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_FILE = BASE_DIR / "lanshare.html"
UPLOAD_FOLDER = Path("G:/lan share")

app = FastAPI()
console = Console()


@app.get("/", response_class=HTMLResponse)
async def index():
    lan_ip = get_lan_ip()
    files = [
        p for p in UPLOAD_FOLDER.iterdir()
        if p.is_file() and not p.name.startswith(".")
    ]
    page = TEMPLATE_FILE.read_text(encoding="utf-8")
    page = page.replace("{{lan_ip}}", lan_ip)
    page = page.replace("{{count}}", str(len(files)))
    return page


@app.get("/api/files")
async def api_files():
    items = []
    for p in UPLOAD_FOLDER.iterdir():
        if not p.is_file() or p.name.startswith("."):
            continue
        st = p.stat()
        items.append({"name": p.name, "size": st.st_size, "mtime": st.st_mtime})
    items.sort(key=lambda d: d["mtime"], reverse=True)
    return items


@app.get("/style.css")
async def style_css():
    return FileResponse(BASE_DIR / "style.css", media_type="text/css")


@app.get("/lanshare.js")
async def lanshare_js():
    return FileResponse(BASE_DIR / "lanshare.js", media_type="text/javascript")


@app.post("/upload")
async def upload(files: list[UploadFile] = File(...)):
    for f in files:
        name = safe_filename(f.filename)
        dest = unique_path(UPLOAD_FOLDER, name)
        with open(dest, "wb") as out:
            while True:
                chunk = await f.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        console.print(f"[green]saved[/green] [cyan]{dest.name}[/cyan]")
    return {"message": f"Uploaded {len(files)} files successfully."}


@app.get("/files/{name}")
async def download(name: str):
    path = resolve_upload_path(UPLOAD_FOLDER, name)
    if path is None:
        return HTMLResponse("<h1>404 - not found</h1>", status_code=404)
    return FileResponse(path, filename=path.name)


@app.head("/files/{name}")
async def download_head(name: str):
    path = resolve_upload_path(UPLOAD_FOLDER, name)
    if path is None:
        return Response(status_code=404)
    return Response(headers={
        "Content-Length": str(path.stat().st_size),
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
    })


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
        f"Open on any device on this WiFi:\n[bold cyan]{url}[/bold cyan]\n\n"
        f"Uploads are saved to: [green]{UPLOAD_FOLDER}[/green]\n",
        title="[bold]LAN Share[/bold]",
        border_style="cyan",
    )
    console.print(panel)
    print_qr(url)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
    url = f"http://{get_lan_ip()}:8000"
    print_startup(url)
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()