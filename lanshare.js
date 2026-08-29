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
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const appView = document.getElementById("appView");
const viewFiles = document.getElementById("view-files");
const viewDrives = document.getElementById("view-drives");
const tbody = document.getElementById("fileRows");
const empty = document.getElementById("emptyState");
const dropzone = document.getElementById("dropzone");
const dropzoneLabel = document.getElementById("dropzoneLabel");
const fileInput = document.getElementById("fileInput");
const breadcrumb = document.getElementById("breadcrumb");
const upBtn = document.getElementById("upBtn");
const transferList = document.getElementById("transferList");
const clearTransfers = document.getElementById("clearTransfers");
const installBtn = document.getElementById("installBtn");

let inFlight = 0;
let current = { root: null, path: "", rootName: "" };
let writable = true;

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

/* ---------- path helpers ---------- */

function segments(path) {
  return (path || "").split("/").filter(Boolean);
}

function joinPath(...parts) {
  return parts.filter(Boolean).join("/");
}

function fileUrl(relPath) {
  const parts = [current.root, ...segments(current.path), ...segments(relPath)];
  return "/files/" + parts.map(encodeURIComponent).join("/");
}

function zipUrl(name) {
  const parts = [current.root, ...segments(current.path), ...segments(name)];
  return "/zip/" + parts.map(encodeURIComponent).join("/");
}

function deleteUrl(relPath) {
  const parts = [current.root, ...segments(current.path), ...segments(relPath)];
  return "/files/" + parts.map(encodeURIComponent).join("/") + "/delete";
}

function listQuery() {
  return "root=" + encodeURIComponent(current.root) +
    "&path=" + encodeURIComponent(current.path);
}

/* ---------- views ---------- */

function showView(name) {
  document.querySelectorAll(".side-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name)
  );
  viewFiles.hidden = name !== "files";
  viewDrives.hidden = name !== "drives";
  if (name === "drives") loadDrives();
}

document.querySelectorAll(".side-item").forEach((btn) =>
  btn.addEventListener("click", () => showView(btn.dataset.view))
);

/* ---------- drives ---------- */

async function loadDrives() {
  const list = document.getElementById("drivesList");
  let res;
  try {
    res = await fetch("/api/drives");
  } catch (e) {
    list.innerHTML = '<div class="text-danger text-center py-3 small">Could not reach server.</div>';
    return;
  }
  if (res.status === 401) {
    location.href = "/";
    return;
  }
  const drives = await res.json();
  if (!Array.isArray(drives)) return;

  list.innerHTML = "";
  if (drives.length === 0) {
    list.innerHTML = '<div class="text-secondary text-center py-3 small">No drives found.</div>';
    return;
  }

  for (const d of drives) {
    const card = document.createElement("div");
    card.className = "drive-card";

    const ico = document.createElement("span");
    ico.className = "drive-ico";
    ico.textContent = d.type === "drive" ? "💾" : "📂";

    const body = document.createElement("div");
    body.style.minWidth = "0";
    const name = document.createElement("div");
    name.className = "drive-name";
    name.textContent = d.name + (d.writable ? "" : " (read-only)");
    const path = document.createElement("div");
    path.className = "drive-path";
    path.textContent = d.path;
    body.append(name, path);

    card.append(ico, body);

    if (!d.online) {
      const chip = document.createElement("span");
      chip.className = "badge text-bg-secondary drive-status";
      chip.textContent = "Offline";
      card.append(chip);
    } else {
      const chip = document.createElement("span");
      chip.className = "badge text-bg-" + (d.writable ? "success" : "warning") + " drive-status";
      chip.textContent = d.writable ? "Online" : "Read-only";
      card.append(chip);

      const btn = document.createElement("button");
      btn.className = "btn btn-sm btn-outline-info";
      btn.textContent = "Open";
      btn.addEventListener("click", () => openDrive(d));
      card.append(btn);
    }

    list.appendChild(card);
  }
}

function openDrive(d) {
  current.root = d.id;
  current.rootName = d.name;
  current.path = "";
  writable = d.writable;
  showView("files");
  loadListing();
}

/* ---------- listing ---------- */

function renderBreadcrumb(name, driveName) {
  breadcrumb.innerHTML = "";

  const rootCrumb = document.createElement("span");
  rootCrumb.className = "crumb";
  rootCrumb.textContent = driveName;
  rootCrumb.addEventListener("click", (e) => {
    e.stopPropagation();
    current.path = "";
    writable = true;
    loadListing();
  });
  breadcrumb.appendChild(rootCrumb);

  let acc = "";
  for (const seg of segments(current.path)) {
    acc = joinPath(acc, seg);
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = "/";
    breadcrumb.appendChild(sep);
    const c = document.createElement("span");
    c.className = "crumb";
    c.textContent = seg;
    c.title = seg;
    c.addEventListener("click", (e) => {
      e.stopPropagation();
      current.path = acc;
      writable = true;
      loadListing();
    });
    breadcrumb.appendChild(c);
  }
}

async function loadListing() {
  if (appView.hidden || !current.root) return;
  let res;
  try {
    res = await fetch("/api/list?" + listQuery());
  } catch (e) {
    return;
  }
  if (res.status === 401) {
    location.href = "/";
    return;
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return;
  }
  if (!res.ok || !data || Array.isArray(data)) {
    tbody.innerHTML = "";
    empty.classList.remove("d-none");
    empty.textContent = (data && data.error) || "Something went wrong.";
    return;
  }

  writable = data.writable;
  renderBreadcrumb(data.path, current.rootName);

  document.getElementById("fileCount").textContent =
    data.dirs.length + " folder" + (data.dirs.length === 1 ? "" : "s") + ", " +
    data.files.length + " file" + (data.files.length === 1 ? "" : "s");

  dropzoneLabel.textContent = "Send to " +
    (current.rootName + "/" + current.path).replace(/\/+$/, "");

  tbody.innerHTML = "";

  const all = [
    ...data.dirs.map((d) => ({ dir: true, ...d })),
    ...data.files.map((f) => ({ dir: false, ...f })),
  ];

  if (all.length === 0) {
    empty.textContent = "This folder is empty.";
    empty.classList.remove("d-none");
    return;
  }
  empty.classList.add("d-none");

  for (const item of all) {
    const rel = joinPath(current.path, item.name);
    const tr = document.createElement("tr");
    if (item.dir) tr.className = "folder-row";

    const tdIcon = document.createElement("td");
    tdIcon.className = "fileicon";
    tdIcon.textContent = item.dir
      ? (item.locked ? "🔒" : "📁")
      : iconFor(item.name);
    tr.appendChild(tdIcon);

    const tdName = document.createElement("td");
    const nameEl = document.createElement("span");
    nameEl.className = "fname";
    nameEl.textContent = item.name;
    nameEl.title = item.name;
    tdName.appendChild(nameEl);
    tr.appendChild(tdName);

    const tdSize = document.createElement("td");
    tdSize.className = "text-secondary";
    tdSize.textContent = item.dir ? "" : formatSize(item.size);
    tr.appendChild(tdSize);

    const tdDate = document.createElement("td");
    tdDate.className = "text-secondary";
    tdDate.textContent = fmtDate(item.mtime);
    if (item.locked) tdDate.textContent = "locked";
    tr.appendChild(tdDate);

    const tdAct = document.createElement("td");
    tdAct.className = "col-actions";

    if (item.dir) {
      if (!item.locked) {
        const zipBtn = document.createElement("button");
        zipBtn.className = "btn btn-sm btn-outline-secondary";
        zipBtn.dataset.zip = rel;
        zipBtn.textContent = "ZIP";
        tdAct.appendChild(zipBtn);
      }
    } else {
      const dl = document.createElement("a");
      dl.className = "btn btn-sm btn-outline-info";
      dl.href = fileUrl(item.name);
      dl.dataset.dl = {};
      dl.dataset.name = rel;
      dl.dataset.size = item.size;
      dl.textContent = "Download";
      tdAct.appendChild(dl);

      const del = document.createElement("button");
      del.className = "btn btn-sm btn-outline-danger";
      del.dataset.del = rel;
      del.textContent = "Delete";
      tdAct.appendChild(del);
    }

    tr.appendChild(tdAct);

    if (item.dir && !item.locked) {
      tr.addEventListener("dblclick", () => openFolder(item.name));
    }
    tbody.appendChild(tr);
  }
}

/* ---------- navigation ---------- */

function openFolder(name) {
  current.path = joinPath(current.path, name);
  loadListing();
}

function goUp() {
  if (!current.path) {
    showView("drives");
    return;
  }
  const segs = segments(current.path);
  segs.pop();
  current.path = segs.join("/");
  loadListing();
}

upBtn.addEventListener("click", goUp);

tbody.addEventListener("click", (e) => {
  const row = e.target.closest("tr.folder-row");
  if (row && !e.target.closest("button,a")) {
    const name = row.querySelector(".fname").textContent;
    openFolder(name);
  }
});

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
  status.textContent = "Transferring";

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
  if (!current.root) return;
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
      if (inFlight === 0) setTimeout(loadListing, 500);
    };

    xhr.onerror = () => {
      inFlight--;
      setStatus(u, "Failed", "danger");
      if (inFlight === 0) setTimeout(loadListing, 500);
    };

    const q = listQuery();
    xhr.open("POST", "/upload?" + q);
    xhr.send(fd);
  }
}

/* ---------- downloads ---------- */

const BLOB_LIMIT = 300 * 1024 * 1024;

function downloadFile(name, rel, size) {
  if (size > BLOB_LIMIT) {
    addHistoryRow(name, "large file - native download", "warning");
    location.href = fileUrl(name);
    return;
  }

  const u = addTransferRow(name, size);
  u.status.className = "badge text-bg-info";
  u.status.textContent = "Downloading";

  const xhr = new XMLHttpRequest();
  xhr.open("GET", fileUrl(name));
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

function downloadZip(name, rel) {
  addHistoryRow(name, "zipping + downloading", "info");
  location.href = zipUrl(name);
}

/* ---------- dropzone ---------- */

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

/* ---------- table actions ---------- */

tbody.addEventListener("click", async (e) => {
  const zipBtn = e.target.closest("[data-zip]");
  if (zipBtn) {
    const rel = zipBtn.dataset.zip;
    const name = rel.split("/").pop();
    downloadZip(name, rel);
    return;
  }

  const dl = e.target.closest("[data-dl]");
  if (dl) {
    e.preventDefault();
    const name = dl.dataset.name.split("/").pop();
    downloadFile(name, dl.dataset.name, Number(dl.dataset.size) || 0);
    return;
  }

  const del = e.target.closest("[data-del]");
  if (del) {
    const rel = del.dataset.del;
    const name = rel.split("/").pop();
    if (!writable) {
      alert("This share is read-only.");
      return;
    }
    if (!confirm(`Delete "${name}"?`)) return;
    del.disabled = true;
    try {
      const res = await fetch(deleteUrl(name), { method: "POST" });
      if (res.status === 401) {
        location.href = "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addHistoryRow(name, "deleted", "danger");
        if (!appView.hidden) loadListing();
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

/* ---------- PWA ---------- */

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

if (!appView.hidden) {
  showView("drives");
}