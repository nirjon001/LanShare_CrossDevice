import socket
from fastapi.responses import HTMLResponse
from fastapi import FastAPI
import uvicorn
import re
from pathlib import Path
from fastapi import UploadFile, File
from datetime import datetime
UPLOAD_FOLDER = Path.home() / "lanshare"
app = FastAPI()

@app.get("/", response_class=HTMLResponse)
async def index():
    lan_ip = get_lan_ip()
    return f"""
     <html>
        <body>
            <h1>LanShare</h1>
            <p>LAN IP Address: {lan_ip}</p>
            <form method="post" action="/upload" enctype="multipart/form-data">
                <input type="file" name="files" multiple required>
                <button type="submit">Upload</button>
            </form>
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
    return {"message": f"Uploaded {len(files)} files successfully."}

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

def get_lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8",80))
        return s.getsockname()[0]
    finally:
        s.close()

print("LAN IP Address:", get_lan_ip())


def main():

    UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
    uvicorn.run(app, host="0.0.0.0", port=8000)

if __name__ == "__main__":
    main()