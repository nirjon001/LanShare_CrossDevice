import sys
import socket
from fastapi.responses import FileResponse, HTMLResponse
from fastapi import FastAPI
import uvicorn
import re
from pathlib import Path
from fastapi import UploadFile, File
from datetime import datetime
import qrcode
from rich.console import Console
from rich.panel import Panel
UPLOAD_FOLDER = Path.home() / "lanshare"
app = FastAPI()
console = Console()

@app.get("/", response_class=HTMLResponse)
async def index():
    lan_ip = get_lan_ip()
    files = sorted(
        [p for p in UPLOAD_FOLDER.iterdir() if p.is_file() and not p.name.startswith(".")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    gallery = render_gallery(files)
    return f"""
     <html>
        <body>
            <h1>LanShare</h1>
            <p>LAN IP Address: {lan_ip}</p>
            <form method="post" action="/upload" enctype="multipart/form-data">
                <input type="file" name="files" multiple required>
                <button type="submit">Upload</button>
            </form>
            <h2>Files on this computer</h2>
            <div class="gallery">
            {gallery}
            </div>
        </body>
    </html>
    """
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


def safe_filename(filename):
    return re.sub(r"[/\\]", "_", filename)

def unique_path(UPLOAD_FOLDER, filename):
    p = UPLOAD_FOLDER / filename
    if not p.exists():
        return p
    stem, suffix = p.stem, p.suffix
    for i in range(1, 1000):
        candidate = UPLOAD_FOLDER / f"{stem}_{i}{suffix}"
        if not candidate.exists():
            return candidate
    return UPLOAD_FOLDER / f"{stem}-{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}{suffix}"


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


def render_gallery(files):
    cards = []
    for p in files:
        size_kb = p.stat().st_size / 1024
        stamp = datetime.fromtimestamp(p.stat().st_mtime).strftime("%b %d, %H:%M")
        cards.append(f"""
        <div class="card">
          <strong>{p.name}</strong>
          <span>{size_kb:.1f} KB | {stamp}</span>
          <div>
            <a href="/files/{p.name}">Download</a>
          </div>
        </div>""")
    return "".join(cards)


def get_lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8",80))
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