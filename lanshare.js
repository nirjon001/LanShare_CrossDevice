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

async function loadFiles() {
  const res = await fetch("/api/files");
  const files = await res.json();

  const tbody = document.getElementById("fileRows");
  const empty = document.getElementById("emptyState");
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
    const dl = document.createElement("a");
    dl.className = "btn btn-sm btn-outline-info";
    dl.href = url;
    dl.textContent = "Download";
    tdAct.appendChild(dl);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  }
}

loadFiles();