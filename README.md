# LAN Share

Send files to your computer over your local network. Start the server, scan the QR code with your phone — any device on the same WiFi can upload files to your laptop. No accounts, no cloud, no apps to install.

## How it works

A FastAPI server binds to `0.0.0.0`. When you start it, the terminal prints your LAN URL plus a scannable QR code. Visitors open it in a browser and upload files straight to your disk.

## Setup

```bash
python -m venv .venv
# activate it (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
```

## Run

```bash
python lanshare.py                  # saves to ~/lanshare/
python lanshare.py .                # saves to current folder
python lanshare.py ~/photos --port 9000
```

## Safety details

- Path traversal blocked — filenames are stripped of `/` and `\`
- Collisions auto-renamed: `photo.jpg` → `photo (1).jpg`
- Files stream in 1 MB chunks, so huge videos don't eat RAM

## Tech stack

- FastAPI + uvicorn (web server)
- python-multipart (streams multipart uploads)
- qrcode (renders a scannable QR in the terminal)
- rich (styled terminal output)
- Pico.css (mobile-first styling, no local CSS files)

## Learning progress

- Part 1: project setup (venv, dependencies)
- Part 2: LAN IP discovery trick (`getsockname()` over a UDP socket)
- Part 3: FastAPI routes (next)
- Part 4: `/upload` with streaming + filename safety
- Part 5: QR code + rich startup panel