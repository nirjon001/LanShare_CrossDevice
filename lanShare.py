import sys
import html
import socket
from urllib.parse import quote
from fastapi.responses import FileResponse, HTMLResponse
from fastapi import FastAPI, UploadFile, File, Response
import uvicorn
import re
from pathlib import Path
from datetime import datetime
import qrcode
from rich.console import Console
from rich.panel import Panel
UPLOAD_FOLDER = Path("G:/lan share")
app = FastAPI()
console = Console()

CSS = """
:root {
  --brand: #38bdf8;
}
body {
  background: linear-gradient(165deg, #0a111f 0%, #0e1630 55%, #0a111f 100%);
  min-height: 100vh;
}
main { padding-top: 3rem; }
.hero { text-align: center; margin-bottom: 2.2rem; }
.hero h1 { margin-bottom: .3rem; letter-spacing: .5px; }
.hero p { opacity: .75; }
.badge {
  display: inline-block; margin-top: .6rem; padding: .25rem .8rem;
  border: 1px solid var(--brand); color: var(--brand); border-radius: 999px;
  font-size: .85rem; letter-spacing: .5px;
}
.dropzone {
  border: 2px dashed var(--brand); border-radius: 16px;
  padding: 2.2rem 1.6rem; text-align: center; margin-bottom: 2.6rem;
  transition: background .15s ease, transform .15s ease;
}
.dropzone:hover { background: rgba(56, 189, 248, .06); transform: translateY(-1px); }
.dropzone .dz-icon { font-size: 2.2rem; }
.dropzone input[type=file] { margin: .8rem auto; display: block; width: 100%; }
section h2 { font-size: 1.15rem; opacity: .9; }
section h2 small { color: #7d8fa5; }
.gallery {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 1rem; margin-top: 1.2rem;
}
.gcard {
  background: #141d31; border: 1px solid #22304a; border-radius: 14px;
  padding: 1.1rem; display: flex; flex-direction: column; gap: .55rem;
  transition: border-color .15s ease, transform .15s ease;
}
.gcard:hover { border-color: var(--brand); transform: translateY(-2px); }
.gcard .icon { font-size: 1.9rem; line-height: 1; }
.gcard .fname { font-weight: 600; word-break: break-all; font-size: .95rem; }
.gcard .meta { color: #8aa0bd; font-size: .82rem; }
.gcard .actions { margin-top: auto; display: flex; }
.gcard .actions a { margin: 0; }
.empty { text-align: center; opacity: .55; padding: 2rem 0; }
.footer { text-align: center; color: #5b6b82; margin-top: 3rem; font-size: .85rem; }
"""

IMG_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp", ".svg", ".avif"}
VID_EXT = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"}
AUD_EXT = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
ARC_EXT = {".zip", ".rar", ".7z", ".tar", ".gz"}
DOC_EXT = {".pdf", ".doc", ".docx", ".txt", ".md", ".ppt", ".xls", ".csv"}


def file_icon(name):
    ext = Path(name).suffix.lower()
    if ext in IMG_EXT:
        return "🖼️"
    if ext in VID_EXT:
        return "🎬"
    if ext in AUD_EXT:
        return "🎵"
    if ext in ARC_EXT:
        return "🗜️"
    if ext in DOC_EXT:
        return "📄"
    return "📦"


def format_size(n):
    n = float(n)
    for unit in ("KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


HTML_PAGE = """<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LAN Share</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
<style>{css}</style>
</head>
<body>
<main class="container">
  <header class="hero">
    <hgroup>
      <h1>LAN Share</h1>
      <p>Any device on this WiFi can send files to this computer.</p>
    </hgroup>
    <span class="badge">{lan_ip}</span>
  </header>

  <form method="post" action="/upload" enctype="multipart/form-data" class="dropzone">
    <div class="dz-icon">📁</div>
    <input type="file" name="files" multiple required>
    <button type="submit">Send files</button>
  </form>

  <section>
    <h2>Files <small>({count})</small></h2>
    <div class="gallery">{gallery}</div>
  </section>

  <footer class="footer">LAN Share &middot; running on your local network</footer>
</main>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
async def index():
    lan_ip = get_lan_ip()
    files = sorted(
        [p for p in UPLOAD_FOLDER.iterdir() if p.is_file() and not p.name.startswith(".")],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return HTML_PAGE.format(
        css=CSS,
        lan_ip=lan_ip,
        gallery=render_gallery(files),
        count=len(files),
    )
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
    if not files:
        return '<div class="empty">No files uploaded yet.</div>'
    cards = []
    for p in files:
        size = format_size(p.stat().st_size)
        stamp = datetime.fromtimestamp(p.stat().st_mtime).strftime("%b %d, %H:%M")
        escaped = html.escape(p.name)
        url = quote(p.name)
        cards.append(f"""
        <article class="gcard">
          <div class="icon">{file_icon(p.name)}</div>
          <div class="fname" title="{escaped}">{escaped}</div>
          <div class="meta">{size} &middot; {stamp}</div>
          <div class="actions">
            <a role="button" href="/files/{url}">Download</a>
          </div>
        </article>""")
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