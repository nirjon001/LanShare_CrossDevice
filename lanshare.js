const IMG = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "svg", "avif"]);
const VID = new Set(["mp4", "mkv", "mov", "avi", "webm", "m4v"]);
const AUD = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac"]);
const ARC = new Set(["zip", "rar", "7z", "tar", "gz"]);
const DOC = new Set(["pdf", "doc", "docx", "txt", "md", "ppt", "xls", "csv"]);

function iconFor(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (IMG.has(ext)) return "🖼️";
  if (VID.has(ext)) return "🎬";
  if (AUD.has(ext)) return "🎵";
  if (ARC.has(ext)) return "🗜️";
  if (DOC.has(ext)) return "📄";
  return "📦";
}

function formatSize(n) {
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return v.toFixed(i === 0 || v >= 100 ? 0 : 1) + " " + units[i];
}

function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const appView = document.getElementById("appView");
const tbody = document.getElementById("fileRows");
const empty = document.getElementById("emptyState");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const transferList = document.getElementById("transferList");
const clearTransfers = document.getElementById("clearTransfers");
const shareNameChip = document.getElementById("shareNameChip");
const installBtn = document.getElementById("installBtn");

let inFlight = 0;

function getTransferEmpty() {
  return document.getElementById("transferEmpty");
}

function showTransferEmpty() {
  if (!getTransferEmpty()) {
    const div = document.createElement("div");
    div.id = "transferEmpty";
    div.className = "text-secondary text-center py-2 small";
    div.textContent = "No transfers yet.";
    transferList.appendChild(div);
  }
}

function hideTransferEmpty() {
  const t = getTransferEmpty();
  if (t) t.remove();
}

async function loadFiles() {
  if (appView.hidden) return;
  let res;
  try {
    res = await fetch("/api/files");
  } catch (e) {
    return;
  }
  if (res.status === 401) {
    location.href = "/";
    return;
  }
  let files;
  try {
    files = await res.json();
  } catch (e) {
    return;
  }
  if (!Array.isArray(files)) return;

  document.getElementById("fileCount").textContent =
    files.length + " file" + (files.length === 1 ? "" : "s");

  tbody.innerHTML = "";

  if (files.length === 0) {
    empty.classList.remove("d-none");
    return;
  }
  empty.classList.add("d-none");

  for (const f of files) {
    const url = "/files/" + encodeURIComponent(f.name);

    const tr = document.createElement("tr");

    const tdIcon = document.createElement("td");
    tdIcon.className = "fileicon";
    tdIcon.textContent = iconFor(f.name);
    tr.appendChild(tdIcon);

    const tdName = document.createElement("td");
    const a = document.createElement("a");
    a.className = "fname text-decoration-none";
    a.href = url;
    a.title = f.name;
    a.textContent = f.name;
    tdName.appendChild(a);
    tr.appendChild(tdName);

    const tdSize = document.createElement("td");
    tdSize.className = "text-secondary";
    tdSize.textContent = formatSize(f.size);
    tr.appendChild(tdSize);

    const tdDate = document.createElement("td");
    tdDate.className = "text-secondary";
    tdDate.textContent = fmtDate(f.mtime);
    tr.appendChild(tdDate);

    const tdAct = document.createElement("td");
    tdAct.className = "col-actions";

    const dl = document.createElement("a");
    dl.className = "btn btn-sm btn-outline-info";
    dl.href = url;
    dl.dataset.dl = f.name;
    dl.dataset.size = f.size;
    dl.textContent = "Download";
    tdAct.appendChild(dl);

    const del = document.createElement("button");
    del.className = "btn btn-sm btn-outline-danger";
    del.dataset.del = f.name;
    del.textContent = "Delete";
    tdAct.appendChild(del);

    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  }
}

/* ---------- views / sidebar ---------- */

const viewTransfer = document.getElementById("view-transfer");
const viewDrives = document.getElementById("view-drives");

document.querySelectorAll(".side-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".side-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    viewTransfer.hidden = view !== "transfer";
    viewDrives.hidden = view !== "drives";
    if (view === "drives") loadShares();
    if (view === "transfer") loadFiles();
  });
});

/* ---------- drives ---------- */

async function loadShares() {
  const list = document.getElementById("drivesList");
  let res;
  try {
    res = await fetch("/api/shares");
  } catch (e) {
    list.innerHTML = '<div class="text-danger text-center py-3 small">Could not reach server.</div>';
    return;
  }
  if (res.status === 401) {
    location.href = "/";
    return;
  }
  const shares = await res.json();
  if (!Array.isArray(shares)) return;

  list.innerHTML = "";
  if (shares.length === 0) {
    list.innerHTML = '<div class="text-secondary text-center py-3 small">No shares configured.</div>';
    return;
  }

  for (const s of shares) {
    const card = document.createElement("div");
    card.className = "drive-card";

    const ico = document.createElement("span");
    ico.className = "drive-ico";
    ico.textContent = "💾";

    const body = document.createElement("div");
    body.style.minWidth = "0";
    const name = document.createElement("div");
    name.className = "drive-name";
    name.textContent = s.name + (s.selected ? " (active)" : "");
    const path = document.createElement("div");
    path.className = "drive-path";
    path.textContent = s.path;
    body.append(name, path);

    card.append(ico, body);

    if (s.selected) {
      const chip = document.createElement("span");
      chip.className = "badge text-bg-success drive-status";
      chip.textContent = "Active";
      card.append(chip);
    } else if (!s.online) {
      const chip = document.createElement("span");
      chip.className = "badge text-bg-secondary drive-status";
      chip.textContent = "Offline";
      card.append(chip);
    } else {
      const btn = document.createElement("button");
      btn.className = "btn btn-sm btn-outline-info";
      btn.textContent = "Switch";
      btn.addEventListener("click", () => switchShare(s.id));
      card.append(btn);
    }

    list.appendChild(card);
  }
}

async function switchShare(id) {
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (res.status === 401) {
    location.href = "/";
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert("Switch failed: " + (data.error || res.status));
    return;
  }
  const shares = await (await fetch("/api/shares")).json();
  const sel = shares.find((s) => s.selected);
  if (sel) shareNameChip.textContent = sel.name;
  loadShares();
  document.querySelector('.side-item[data-view="transfer"]').click();
}

/* ---------- transfer history ---------- */

function addHistoryRow(name, note, kind) {
  hideTransferEmpty();
  const row = document.createElement("div");
  row.className = "transfer-row";
  const nameEl = document.createElement("span");
  nameEl.className = "t-name";
  nameEl.textContent = name;
  nameEl.title = name;
  const noteEl = document.createElement("span");
  noteEl.className = "t-note badge text-bg-" + (kind || "secondary");
  noteEl.textContent = note;
  row.append(nameEl, noteEl);
  transferList.prepend(row);
}

function addTransferRow(name, size) {
  hideTransferEmpty();
  const row = document.createElement("div");
  row.className = "transfer-row";

  const nameEl = document.createElement("span");
  nameEl.className = "t-name";
  nameEl.textContent = name;
  nameEl.title = name;

  const sizeEl = document.createElement("span");
  sizeEl.className = "t-size text-secondary";
  sizeEl.textContent = formatSize(size);

  const prog = document.createElement("div");
  prog.className = "progress";
  const bar = document.createElement("div");
  bar.className = "progress-bar progress-bar-striped progress-bar-animated";
  bar.style.width = "0%";
  prog.appendChild(bar);

  const pct = document.createElement("span");
  pct.className = "t-pct";
  pct.textContent = "0%";

  const status = document.createElement("span");
  status.className = "badge text-bg-secondary";
  status.textContent = "Uploading";

  const rate = document.createElement("span");
  rate.className = "t-rate";
  rate.textContent = "";

  row.append(nameEl, sizeEl, prog, pct, status, rate);
  transferList.prepend(row);
  return { row, bar, pct, status, rate };
}

function setStatus(u, statusText, kind) {
  u.status.className = "badge text-bg-" + kind;
  u.status.textContent = statusText;
  u.bar.classList.remove("progress-bar-animated", "progress-bar-striped");
  u.bar.style.width = "100%";
  u.pct.textContent = "100%";
  u.rate.textContent = "";
}

function onTransferProgress(u, e) {
  if (!e.lengthComputable) return;
  const p = Math.round((e.loaded / e.total) * 100);
  u.bar.style.width = p + "%";
  u.pct.textContent = p + "%";
  const now = Date.now();
  const dt = (now - (u.lastTime || now)) / 1000;
  if (dt > 0) {
    const bytesPerSec = (e.loaded - (u.lastLoaded || 0)) / dt;
    u.rate.textContent = formatSize(bytesPerSec) + "/s";
  }
  u.lastLoaded = e.loaded;
  u.lastTime = now;
}

/* ---------- uploads with XHR progress ---------- */

function uploadFiles(files) {
  for (const file of files) {
    inFlight++;
    const u = addTransferRow(file.name, file.size);

    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append("files", file, file.name);

    xhr.upload.onprogress = (e) => onTransferProgress(u, e);

    xhr.onload = () => {
      inFlight--;
      if (xhr.status === 200) {
        setStatus(u, "Done", "success");
      } else if (xhr.status === 401) {
        location.href = "/";
        return;
      } else {
        let msg = "Failed";
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch (e) {}
        setStatus(u, msg, "danger");
      }
      if (inFlight === 0) setTimeout(loadFiles, 500);
    };

    xhr.onerror = () => {
      inFlight--;
      setStatus(u, "Failed", "danger");
      if (inFlight === 0) setTimeout(loadFiles, 500);
    };

    xhr.open("POST", "/upload");
    xhr.send(fd);
  }
}

/* ---------- downloads with XHR progress ---------- */

const BLOB_LIMIT = 300 * 1024 * 1024;

function downloadFile(name, size) {
  const url = "/files/" + encodeURIComponent(name);

  if (size > BLOB_LIMIT) {
    addHistoryRow(name, "large file - native download", "warning");
    location.href = url;
    return;
  }

  const u = addTransferRow(name, size);
  u.status.className = "badge text-bg-info";
  u.status.textContent = "Downloading";

  const xhr = new XMLHttpRequest();
  xhr.open("GET", url);
  xhr.responseType = "blob";
  xhr.onprogress = (e) => onTransferProgress(u, e);
  xhr.onload = () => {
    if (xhr.status === 401) {
      location.href = "/";
      return;
    }
    if (xhr.status !== 200) {
      setStatus(u, "Failed", "danger");
      return;
    }
    const blobUrl = URL.createObjectURL(xhr.response);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    setStatus(u, "Done", "success");
  };
  xhr.onerror = () => setStatus(u, "Failed", "danger");
  xhr.send();
}

/* ---------- dropzone: drag & drop + click to pick ---------- */

["dragenter", "dragover", "dragleave", "drop"].forEach((ev) =>
  document.body.addEventListener(ev, (e) => e.preventDefault())
);

dropzone.addEventListener("dragover", () => dropzone.classList.add("dragover"));
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  dropzone.classList.remove("dragover");
  if (e.dataTransfer && e.dataTransfer.files.length) {
    uploadFiles(e.dataTransfer.files);
  }
});

dropzone.addEventListener("click", (e) => {
  if (e.target.tagName !== "INPUT") fileInput.click();
});

fileInput.addEventListener("change", () => {
  uploadFiles(fileInput.files);
  fileInput.value = "";
});

/* ---------- table actions: download + delete ---------- */

tbody.addEventListener("click", async (e) => {
  const dl = e.target.closest("[data-dl]");
  if (dl) {
    e.preventDefault();
    downloadFile(dl.dataset.dl, Number(dl.dataset.size) || 0);
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    const name = del.dataset.del;
    if (!confirm(`Delete "${name}"?`)) return;
    del.disabled = true;
    try {
      const res = await fetch("/files/" + encodeURIComponent(name) + "/delete", {
        method: "POST",
      });
      if (res.status === 401) {
        location.href = "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addHistoryRow(name, "deleted", "danger");
        if (!appView.hidden) loadFiles();
      } else {
        alert("Delete failed: " + (data.error || res.status));
      }
    } catch (err) {
      alert("Delete failed: " + err.message);
    } finally {
      del.disabled = false;
    }
  }
});

clearTransfers.addEventListener("click", () => {
  transferList.innerHTML = "";
  showTransferEmpty();
});

/* ---------- PWA: install + service worker ---------- */

let deferredInstall = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  installBtn.classList.remove("d-none");
});

installBtn.addEventListener("click", async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  deferredInstall = null;
  if (choice.outcome === "accepted") installBtn.classList.add("d-none");
});

window.addEventListener("appinstalled", () => {
  installBtn.classList.add("d-none");
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

if (!appView.hidden) loadFiles();