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
  const files = await res.json();

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

  row.append(nameEl, sizeEl, prog, pct, status);
  transferList.prepend(row);
  return { row, bar, pct, status };
}

function setStatus(u, statusText, kind) {
  u.status.className = "badge text-bg-" + kind;
  u.status.textContent = statusText;
  u.bar.classList.remove("progress-bar-animated", "progress-bar-striped");
  u.bar.style.width = "100%";
  u.pct.textContent = "100%";
}

/* ---------- uploads with XHR progress ---------- */

function uploadFiles(files) {
  for (const file of files) {
    inFlight++;
    const u = addTransferRow(file.name, file.size);

    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append("files", file, file.name);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      u.bar.style.width = p + "%";
      u.pct.textContent = p + "%";
    };

    xhr.onload = () => {
      inFlight--;
      if (xhr.status === 200) {
        setStatus(u, "Done", "success");
      } else if (xhr.status === 401) {
        location.href = "/";
        return;
      } else {
        setStatus(u, "Failed", "danger");
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

/* ---------- table actions: download log + delete ---------- */

tbody.addEventListener("click", async (e) => {
  const dl = e.target.closest("[data-dl]");
  if (dl) {
    addHistoryRow(dl.dataset.dl, "downloaded", "info");
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    const name = del.dataset.del;
    if (!confirm(`Delete "${name}"?`)) return;
    const res = await fetch("/files/" + encodeURIComponent(name) + "/delete", {
      method: "POST",
    });
    if (res.status === 401) {
      location.href = "/";
      return;
    }
    if (res.ok) {
      addHistoryRow(name, "deleted", "danger");
if (!appView.hidden) loadFiles();
    } else {
      alert("Delete failed.");
    }
  }
});

clearTransfers.addEventListener("click", () => {
  transferList.innerHTML = "";
  showTransferEmpty();
});

loadFiles();