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
const viewRecent = document.getElementById("view-recent");
const tbody = document.getElementById("fileRows");
const empty = document.getElementById("emptyState");
const dropzone = document.getElementById("dropzone");
const dropzoneLabel = document.getElementById("dropzoneLabel");
const fileInput = document.getElementById("fileInput");
const breadcrumb = document.getElementById("breadcrumb");
const upBtn = document.getElementById("upBtn");
const editPathBtn = document.getElementById("editPathBtn");
const pathInput = document.getElementById("pathInput");
const searchInput = document.getElementById("searchInput");
const searchPanel = document.getElementById("searchPanel");
const transferList = document.getElementById("transferList");
const clearTransfers = document.getElementById("clearTransfers");
const installBtn = document.getElementById("installBtn");
const bagToggle = document.getElementById("bagToggle");
const bagCount = document.getElementById("bagCount");
const bagPanel = document.getElementById("bagPanel");
const bagList = document.getElementById("bagList");
const bagEmpty = document.getElementById("bagEmpty");
const bagMode = document.getElementById("bagMode");
const bagPullBtn = document.getElementById("bagPull");
const bagClear = document.getElementById("bagClear");
const bagClose = document.getElementById("bagClose");
const BAG_MIME = "application/x-lanshare-bag";

let inFlight = 0;
let current = { root: null, path: "", rootName: "" };
let writable = true;
let drivesCache = null;
let searchTimer = null;
let searchSeq = 0;
let bagCache = [];
let peerState = null;
let recentTimer = null;
let recentBusy = false;

function peerPrefix() {
  return peerState ? "/peer/" + encodeURIComponent(peerState.id) : "";
}

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
  return peerPrefix() + "/files/" + parts.map(encodeURIComponent).join("/");
}

function encParts(parts) {
  return parts.map(encodeURIComponent).join("/");
}

function deleteUrl(relPath) {
  const parts = [current.root, ...segments(current.path), ...segments(relPath)];
  return peerPrefix() + "/files/" + encParts(parts) + "/delete";
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
  viewRecent.hidden = name !== "recent";
  if (name !== "recent") { window.clearInterval(recentTimer); recentTimer = null; }
  if (name === "drives") loadDrives();
  if (name === "recent") openRecent();
}

document.querySelectorAll(".side-item").forEach((btn) =>
  btn.addEventListener("click", () => showView(btn.dataset.view))
);

/* ---------- drives ---------- */

async function loadDrives() {
  const list = document.getElementById("drivesList");
  loadPeers();
  let res;
  try {
    res = await fetch(peerPrefix() + "/api/drives");
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
  drivesCache = drives;

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
    const space = document.createElement("div");
    space.className = "drive-space";
    space.textContent = (d.online && d.size) ? (formatSize(d.free) + " free of " + formatSize(d.size)) : "";
    body.append(name, path, space);

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

      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("dragover");
      });
      card.addEventListener("dragleave", () => card.classList.remove("dragover"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("dragover");
        const dropped = e.dataTransfer && e.dataTransfer.getData(BAG_MIME);
        if (dropped) {
          let d2;
          try { d2 = JSON.parse(dropped); } catch (err) { return; }
          if (d2 && d2.id) bagDropPull(d2.id, d.id, "");
          return;
        }
        if (e.dataTransfer && e.dataTransfer.files.length) {
          uploadFiles(e.dataTransfer.files, d.id, "");
        }
      });
    }

    list.appendChild(card);
  }

  const rcard = document.createElement("div");
  rcard.className = "drive-card";
  const rico = document.createElement("span");
  rico.className = "drive-ico";
  rico.textContent = "🕘";
  const rbody = document.createElement("div");
  rbody.style.minWidth = "0";
  const rname = document.createElement("div");
  rname.className = "drive-name";
  rname.textContent = "Recent files";
  const rpath = document.createElement("div");
  rpath.className = "drive-path";
  rpath.textContent = "things opened recently on " + (peerState ? peerState.name : "this device");
  rbody.append(rname, rpath);
  rcard.append(rico, rbody);
  const rchip = document.createElement("span");
  rchip.className = "badge text-bg-success drive-status";
  rchip.textContent = "Online";
  rcard.append(rchip);
  const ropen = document.createElement("button");
  ropen.className = "btn btn-sm btn-outline-info";
  ropen.textContent = "Open";
  ropen.addEventListener("click", () => showView("recent"));
  rcard.append(ropen);
  list.appendChild(rcard);
}

function openDrive(d) {
  current.root = d.id;
  current.rootName = d.name;
  current.path = "";
  writable = d.writable;
  showView("files");
  loadListing();
}

async function loadPeers() {
  const bar = document.getElementById("peerBar");
  if (!bar) return;
  let res;
  try {
    res = await fetch("/api/peers");
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
  const devices = (data && Array.isArray(data.devices)) ? data.devices : [];
  const chips = [];
  const me = document.createElement("button");
  me.className = "btn btn-sm peer-chip" + (peerState ? " btn-outline-secondary" : " btn-info");
  me.textContent = "This device";
  me.addEventListener("click", () => {
    if (peerState) {
      peerState = null;
      loadDrives();
    }
  });
  chips.push(me);
  for (const d of devices) {
    const b = document.createElement("button");
    const active = peerState && peerState.id === d.id;
    b.className = "btn btn-sm peer-chip" + (active ? " btn-info" : " btn-outline-secondary");
    b.textContent = (d.online ? "● " : "○ ") + d.name;
    b.title = d.url;
    b.addEventListener("click", () => {
      if (!active) {
        peerState = { id: d.id, name: d.name };
        loadDrives();
      }
    });
    chips.push(b);
  }
  bar.innerHTML = "";
  for (const c of chips) bar.appendChild(c);
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
  endPathEdit();
  hideSearch();
  searchInput.placeholder = "Search " + (current.rootName || current.root) + "…";
  let res;
  try {
    res = await fetch(peerPrefix() + "/api/list?" + listQuery());
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

        const zipBag = document.createElement("button");
        zipBag.className = "btn btn-sm btn-outline-secondary";
        zipBag.dataset.zipbag = rel;
        zipBag.title = "Zip this folder and stash the zip in the Bag";
        zipBag.textContent = "💼ZIP";
        tdAct.appendChild(zipBag);

        const stashF = document.createElement("button");
        stashF.className = "btn btn-sm btn-outline-warning";
        stashF.dataset.stash = rel;
        stashF.title = "Stash this folder in the Bag (zero-copy pointer)";
        stashF.textContent = "💼";
        tdAct.appendChild(stashF);
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

      const stash = document.createElement("button");
      stash.className = "btn btn-sm btn-outline-warning";
      stash.dataset.stash = rel;
      stash.title = "Stash in Bag (no copy yet)";
      stash.textContent = "💼";
      tdAct.appendChild(stash);

      const del = document.createElement("button");
      del.className = "btn btn-sm btn-outline-danger";
      del.dataset.del = rel;
      del.textContent = "Delete";
      tdAct.appendChild(del);
    }

    tr.appendChild(tdAct);

    if (item.dir && !item.locked) {
      tr.addEventListener("dblclick", () => openFolder(item.name));
      tr.addEventListener("dragover", (e) => {
        e.preventDefault();
        tr.classList.add("dragover");
      });
      tr.addEventListener("dragleave", () => tr.classList.remove("dragover"));
      tr.addEventListener("drop", (e) => {
        e.preventDefault();
        tr.classList.remove("dragover");
        const dropped = e.dataTransfer && e.dataTransfer.getData(BAG_MIME);
        if (!dropped) return;
        let d;
        try { d = JSON.parse(dropped); } catch (err) { return; }
        if (d && d.id) bagDropPull(d.id, current.root, joinPath(current.path, item.name));
      });
    } else {
      tr.draggable = true;
      tr.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(BAG_MIME, JSON.stringify({ share: current.root, path: rel }));
        e.dataTransfer.effectAllowed = "copy";
      });
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

/* ---------- recent files ---------- */

function openRecent() {
  document.getElementById("recentDevice").textContent =
    peerState ? peerState.name : "this device";
  document.getElementById("recentExpired").hidden = true;
  document.getElementById("recentEmpty").hidden = true;
  document.getElementById("recentRows").innerHTML =
    '<tr><td colspan="4" class="text-secondary text-center py-3 small">Loading...</td></tr>';
  window.clearInterval(recentTimer);
  refreshRecent();
  recentTimer = window.setInterval(refreshRecent, 5000);
}

async function refreshRecent() {
  if (recentBusy) return;
  recentBusy = true;
  const list = document.getElementById("recentRows");
  const emptyEl = document.getElementById("recentEmpty");
  let res;
  try {
    res = await fetch(peerPrefix() + "/api/recent");
  } catch (e) {
    recentBusy = false;
    return;
  }
  if (res.status === 401) {
    location.href = "/";
    return;
  }
  let data;
  try { data = await res.json(); } catch (e) { recentBusy = false; return; }
  recentBusy = false;
  const entries = (data && Array.isArray(data.entries)) ? data.entries : [];
  list.innerHTML = "";
  if (entries.length === 0) { emptyEl.hidden = false; return; }
  for (const en of entries) {
    const m = findShareForPath(en.path);
    const tr = document.createElement("tr");
    tr.className = "file-row";
    if (m) tr.style.cursor = "pointer";
    if (m) tr.addEventListener("click", () => jumpToRecent(m, en));
    const ico = document.createElement("td");
    ico.textContent = iconFor(en.name);
    tr.appendChild(ico);
    const nm = document.createElement("td");
    const n1 = document.createElement("div");
    n1.className = "fname";
    n1.textContent = en.name;
    const n2 = document.createElement("div");
    n2.className = "text-secondary small text-truncate";
    n2.textContent = en.path;
    n2.style.maxWidth = "60vw";
    nm.append(n1, n2);
    tr.appendChild(nm);
    const sz = document.createElement("td");
    sz.className = "text-secondary";
    sz.textContent = en.exists ? formatSize(en.size) : "unavailable";
    tr.appendChild(sz);
    const act = document.createElement("td");
    act.className = "col-actions";
    const dl = document.createElement("a");
    dl.className = "btn btn-sm btn-outline-info";
    dl.href = peerPrefix() + "/api/recent/file?path=" + encodeURIComponent(en.path);
    dl.dataset.rname = en.name;
    dl.dataset.rsize = en.size || 0;
    dl.textContent = "Download";
    act.appendChild(dl);
    if (m) {
      const openBtn = document.createElement("button");
      openBtn.className = "btn btn-sm btn-outline-secondary ms-1";
      openBtn.textContent = "Open folder";
      openBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        jumpToRecent(m, en);
      });
      act.appendChild(openBtn);
      const stash = document.createElement("button");
      stash.className = "btn btn-sm btn-outline-warning ms-1";
      stash.title = "Stash in Bag (no copy yet)";
      stash.textContent = "💼";
      stash.addEventListener("click", (ev) => {
        ev.stopPropagation();
        stashRecent(m, en);
      });
      act.appendChild(stash);
    }
    tr.appendChild(act);
    list.appendChild(tr);
  }
}

function jumpToRecent(m, en) {
  const d = Array.isArray(drivesCache) ? drivesCache.find((x) => x.id === m.root) : null;
  current.root = m.root;
  current.rootName = d ? d.name : current.rootName;
  current.path = m.path;
  writable = d ? d.writable : true;
  showView("files");
  loadListing();
}

async function stashRecent(m, en) {
  const u = addTransferRow(en.name + " → Bag", null);
  u.status.className = "badge text-bg-warning";
  u.status.textContent = "Stashing";
  try {
    const res = await fetch(peerPrefix() + "/api/bag/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share: m.root, path: m.path }),
    });
    if (res.status === 401) { location.href = "/"; return; }
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      u.status.className = "badge text-bg-" + (data.already ? "secondary" : "success");
      u.status.textContent = data.already ? "Already in Bag" : "In Bag";
      u.bar.classList.remove("progress-bar-animated", "progress-bar-striped");
      u.bar.style.width = "100%";
      u.pct.textContent = "";
      refreshBag();
    } else {
      u.status.className = "badge text-bg-danger";
      u.status.textContent = data.error || "Failed";
      u.bar.classList.remove("progress-bar-animated", "progress-bar-striped");
    }
  } catch (err) {
    u.status.className = "badge text-bg-danger";
    u.status.textContent = "Failed";
  }
}

document.getElementById("recentRows").addEventListener("click", (e) => {
  const dl = e.target.closest("a[data-rname]");
  if (!dl) return;
  e.preventDefault();
  downloadRecent(dl.dataset.rname, dl.dataset.rsize, decodeURIComponent(dl.href.split("path=")[1] || ""));
});

function downloadRecent(name, size, url) {
  if (Number(size) > BLOB_LIMIT) {
    addHistoryRow(name, "large file - native download", "warning");
    location.href = url;
    return;
  }
  const u = addTransferRow(name, Number(size) || 0);
  u.status.className = "badge text-bg-info";
  u.status.textContent = "Downloading";
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url);
  xhr.responseType = "blob";
  xhr.onprogress = (e) => onTransferProgress(u, e);
  xhr.onload = () => {
    if (xhr.status === 401) { location.href = "/"; return; }
    if (xhr.status !== 200) { setStatus(u, "Failed", "danger"); return; }
    const blobUrl = URL.createObjectURL(xhr.response);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    setStatus(u, "Done", "success");
    addHistoryRow(name, "downloaded", "info");
  };
  xhr.onerror = () => setStatus(u, "Failed", "danger");
  xhr.send();
}

document.getElementById("recentBack").addEventListener("click", () => showView("drives"));

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
  sizeEl.textContent = size == null ? "—" : formatSize(size);

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

function uploadFiles(files, rootId = current.root, path = current.path) {
  if (!rootId) return;
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

    const q = "root=" + encodeURIComponent(rootId) + "&path=" + encodeURIComponent(path);
    xhr.open("POST", peerPrefix() + "/upload?" + q);
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

/* ---------- zip folders: background job + progress ---------- */

function zipFolder(name, mode) {
  if (!current.root) return;
  const u = addTransferRow(name + ".zip", null);
  if (mode === "bag") {
    u.status.textContent = "Bagging";
    u.status.className = "badge text-bg-warning";
  }
  u.bar.style.width = "2%";
  u.pct.textContent = "";

  const parts = [current.root, ...segments(current.path), ...segments(name)];
  fetch(peerPrefix() + "/zip/" + encParts(parts) + "/start", { method: "POST" })
    .then((r) => r.json())
    .then((j) => {
      if (!j.ok) {
        setStatus(u, j.error || "Failed", "danger");
        return;
      }
      const jobId = j.job_id;
      const iv = setInterval(() => {
        fetch(peerPrefix() + "/zip/status/" + encodeURIComponent(jobId))
          .then((r) => r.json())
          .then(async (st) => {
            if (!st.ok || st.state === "error") {
              clearInterval(iv);
              setStatus(u, (st && st.error) || "Failed", "danger");
              return;
            }
            updateZipBar(u, st);
            if (st.state === "done") {
              clearInterval(iv);
              if (mode === "bag") {
                await stashZipFromJob(jobId, u);
              } else {
                transferZip(jobId, st.name, u);
              }
            }
          })
          .catch(() => {});
      }, 400);
    })
    .catch(() => setStatus(u, "Failed", "danger"));
}

async function stashZipFromJob(jobId, u) {
  let res;
  try {
    res = await fetch(peerPrefix() + "/api/bag/add-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
    });
  } catch (e) {
    setStatus(u, "Failed", "danger");
    return;
  }
  if (res.status === 401) {
    location.href = "/";
    return;
  }
  const d = await res.json().catch(() => ({}));
  if (res.ok && d.ok) {
    u.status.className = "badge text-bg-success";
    u.status.textContent = "In Bag";
    u.bar.classList.remove("progress-bar-animated", "progress-bar-striped");
    u.bar.style.width = "100%";
    u.pct.textContent = "100%";
    refreshBag();
  } else {
    setStatus(u, (d && d.error) || "Failed", "danger");
  }
}

function updateZipBar(u, st) {
  let pct = 2;
  let label = "Counting files…";
  if (st.phase === "zip") {
    if (st.total > 0) {
      pct = 2 + 88 * Math.min(1, st.done / st.total);
      label = "Zipping… " + Math.round((st.done / st.total) * 100) + "%";
    } else {
      label = "Zipping…";
    }
  } else if (st.phase === "error") {
    label = "Failed";
  }
  u.bar.style.width = Math.round(pct) + "%";
  u.pct.textContent = Math.round(pct) + "%";
  u.status.textContent = label;
}

function transferZip(jobId, zipName, u) {
  u.status.textContent = "Downloading";
  const xhr = new XMLHttpRequest();
  xhr.open("GET", peerPrefix() + "/zip/download/" + encodeURIComponent(jobId));
  xhr.responseType = "blob";
  xhr.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round(90 + 10 * (e.loaded / e.total));
    u.bar.style.width = pct + "%";
    u.pct.textContent = pct + "%";
    const now = Date.now();
    const dt = (now - (u.lastTime || now)) / 1000;
    if (dt > 0) {
      const bytesPerSec = (e.loaded - (u.lastLoaded || 0)) / dt;
      u.rate.textContent = formatSize(bytesPerSec) + "/s";
    }
    u.lastLoaded = e.loaded;
    u.lastTime = now;
  };
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
    a.download = zipName + ".zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    setStatus(u, "Done", "success");
  };
  xhr.onerror = () => setStatus(u, "Failed", "danger");
  xhr.send();
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
    zipFolder(name, "download");
    return;
  }

  const zipBag = e.target.closest("[data-zipbag]");
  if (zipBag) {
    const rel = zipBag.dataset.zipbag;
    const name = rel.split("/").pop();
    zipFolder(name, "bag");
    return;
  }

  const dl = e.target.closest("[data-dl]");
  if (dl) {
    e.preventDefault();
    const name = dl.dataset.name.split("/").pop();
    downloadFile(name, dl.dataset.name, Number(dl.dataset.size) || 0);
    return;
  }

  const stash = e.target.closest("[data-stash]");
  if (stash) {
    handleStash(stash.dataset.stash);
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

/* ---------- search ---------- */

function hideSearch() {
  searchPanel.classList.add("d-none");
  searchPanel.innerHTML = "";
}

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q || !current.root) {
    hideSearch();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 300);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideSearch();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-bar")) hideSearch();
});

async function runSearch(q) {
  const mySeq = ++searchSeq;
  let res;
  try {
    res = await fetch(peerPrefix() + "/api/search?root=" + encodeURIComponent(current.root) +
      "&path=" + encodeURIComponent(current.path) + "&q=" + encodeURIComponent(q));
  } catch (e) {
    return;
  }
  if (mySeq !== searchSeq) return;
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
  const results = (data && Array.isArray(data.results)) ? data.results : [];
  if (mySeq !== searchSeq) return;
  renderSearchResults(results, q);
}

function renderSearchResults(results, q) {
  searchPanel.innerHTML = "";
  searchPanel.classList.remove("d-none");
  if (!results.length) {
    const d = document.createElement("div");
    d.className = "search-empty";
    d.textContent = 'Nothing found matching "' + q + '".';
    searchPanel.appendChild(d);
    return;
  }
  for (const r of results) {
    const row = document.createElement("div");
    row.className = "search-row";

    const ico = document.createElement("span");
    ico.textContent = r.kind === "dir" ? "📁" : iconFor(r.name);

    const nm = document.createElement("span");
    nm.className = "s-name";
    nm.textContent = r.name;
    nm.title = r.name;

    const p = document.createElement("span");
    p.className = "s-path";
    p.textContent = r.path;
    p.title = r.path;

    const sz = document.createElement("span");
    sz.className = "s-size";
    sz.textContent = r.kind === "dir" ? "" : formatSize(r.size);

    row.append(ico, nm, p, sz);

    row.addEventListener("click", () => {
      hideSearch();
      const segs = segments(r.path);
      if (r.kind === "dir") {
        current.path = segs.join("/");
      } else {
        segs.pop();
        current.path = segs.join("/");
      }
      if (viewFiles.hidden) showView("files");
      loadListing();
    });
    searchPanel.appendChild(row);
  }
}

/* ---------- go to a path (paste a Windows path) ---------- */

function driveRootFor(share) {
  return (share.path || "").replace(/\\+/g, "/").replace(/\/+$/, "");
}

function displayPath() {
  const d = Array.isArray(drivesCache)
    ? drivesCache.find((x) => x.id === current.root)
    : null;
  const rp = d ? driveRootFor(d) : (current.rootName || current.root);
  return current.path ? rp + "/" + current.path : rp;
}

function beginPathEdit() {
  pathInput.value = displayPath();
  pathInput.classList.remove("d-none");
  breadcrumb.hidden = true;
  pathInput.focus();
  pathInput.select();
}

function endPathEdit() {
  pathInput.classList.add("d-none");
  breadcrumb.hidden = false;
}

function findShareForPath(text) {
  if (!Array.isArray(drivesCache)) return null;
  const t = (text || "").trim().replace(/\\+/g, "/").replace(/\/+$/, "").toLowerCase();
  if (!t) return null;
  for (const d of drivesCache) {
    if (t === driveRootFor(d).toLowerCase() || t === d.id.toLowerCase()) {
      return { root: d.id, path: "" };
    }
  }
  let best = null;
  for (const d of drivesCache) {
    const rp = driveRootFor(d).toLowerCase();
    if (t.startsWith(rp + "/") && (!best || rp.length > best.len)) {
      best = { root: d.id, path: t.slice(rp.length + 1), len: rp.length };
    }
  }
  return best ? { root: best.root, path: best.path } : null;
}

function commitPath() {
  const val = pathInput.value;
  endPathEdit();
  if (!val.trim()) return;
  const m = findShareForPath(val);
  if (!m) {
    alert("That path is not inside any shared drive on this device.");
    return;
  }
  const d = Array.isArray(drivesCache)
    ? drivesCache.find((x) => x.id === m.root)
    : null;
  current.root = m.root;
  current.rootName = d ? d.name : current.rootName;
  current.path = m.path;
  writable = d ? d.writable : true;
  if (viewFiles.hidden) showView("files");
  loadListing();
}

editPathBtn.addEventListener("click", beginPathEdit);

pathInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    commitPath();
  } else if (e.key === "Escape") {
    endPathEdit();
  }
});

pathInput.addEventListener("blur", endPathEdit);

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    beginPathEdit();
  }
});

/* ---------- the Bag (no-copy pointer panel) ---------- */

function bagOpen() {
  bagPanel.classList.remove("d-none");
  refreshBag();
}

function bagClosePanel() {
  bagPanel.classList.add("d-none");
}

bagToggle.addEventListener("click", bagOpen);
bagClose.addEventListener("click", bagClosePanel);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !bagPanel.classList.contains("d-none")) {
    bagClosePanel();
  }
});

async function handleStash(rel) {
  const name = rel.split("/").pop();
  const u = addTransferRow(name + " → Bag", null);
  u.status.className = "badge text-bg-warning";
  u.status.textContent = "Stashing";
  try {
    const res = await fetch(peerPrefix() + "/api/bag/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share: current.root, path: rel }),
    });
    if (res.status === 401) {
      location.href = "/";
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const already = data.already || data.item;
      u.status.className = "badge text-bg-success";
      u.status.textContent = already ? "Already in Bag" : "In Bag";
      u.bar.classList.remove("progress-bar-animated", "progress-bar-striped");
      u.bar.style.width = "100%";
      u.pct.textContent = "";
      refreshBag();
    } else {
      u.status.className = "badge text-bg-danger";
      u.status.textContent = data.error || "Failed";
      u.bar.classList.remove("progress-bar-animated", "progress-bar-striped");
    }
  } catch (err) {
    u.status.className = "badge text-bg-danger";
    u.status.textContent = "Failed";
  }
}

bagPanel.addEventListener("dragover", (e) => {
  e.preventDefault();
  bagPanel.classList.add("dragover");
});
bagPanel.addEventListener("dragleave", () => bagPanel.classList.remove("dragover"));
bagPanel.addEventListener("drop", (e) => {
  e.preventDefault();
  bagPanel.classList.remove("dragover");
  const dropped = e.dataTransfer && e.dataTransfer.getData(BAG_MIME);
  if (!dropped) return;
  let d;
  try { d = JSON.parse(dropped); } catch (err) { return; }
  if (d && d.share && d.path) handleStash(d.path);
});

async function refreshBag() {
  let res;
  try {
    res = await fetch(peerPrefix() + "/api/bag");
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
  bagCache = (data && Array.isArray(data.items)) ? data.items : [];
  bagCount.textContent = bagCache.length;
  renderBagRows();
}

function renderBagRows() {
  bagList.innerHTML = "";
  bagEmpty.hidden = bagCache.length !== 0;
  bagPullBtn.disabled = bagCache.length === 0 || !current.root;

  for (const item of bagCache) {
    const row = document.createElement("div");
    row.className = "bag-row";
    row.draggable = true;
    row.dataset.id = item.id;

    const ico = document.createElement("span");
    const kind = item.kind || "file";
    ico.textContent = kind === "dir" ? "📁" : kind === "zip" ? "🗜️" : "📄";

    const nm = document.createElement("span");
    nm.className = "t-name";
    nm.textContent = item.name;
    nm.title = (item.path || "") + " on " + item.share;

    const sz = document.createElement("span");
    sz.className = "b-size";
    if (item.missing) {
      sz.className = "badge text-bg-danger b-size";
      sz.textContent = "gone";
    } else {
      sz.textContent = formatSize(item.size);
    }

    const rm = document.createElement("button");
    rm.className = "btn btn-sm btn-link text-secondary p-0 ps-1";
    rm.title = "Remove from Bag";
    rm.textContent = "✕";
    rm.addEventListener("click", (ev) => {
      ev.stopPropagation();
      bagRemove([item.id]);
    });

    row.append(ico, nm, sz, rm);

    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(BAG_MIME, JSON.stringify({ id: item.id }));
      e.dataTransfer.effectAllowed = "copy";
    });

    row.addEventListener("click", () => {
      const segs = segments(item.path || "");
      segs.pop();
      current.root = item.share;
      current.path = segs.join("/");
      const d = Array.isArray(drivesCache)
        ? drivesCache.find((x) => x.id === item.share)
        : null;
      current.rootName = d ? d.name : item.share;
      writable = d ? d.writable : true;
      if (viewFiles.hidden) showView("files");
      loadListing();
      bagClosePanel();
    });

    bagList.appendChild(row);
  }
}

async function bagRemove(ids) {
  try {
    const res = await fetch(peerPrefix() + "/api/bag/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (res.status === 401) {
      location.href = "/";
      return;
    }
  } catch (e) {}
  refreshBag();
}

bagClear.addEventListener("click", () => {
  if (bagCache.length && !confirm("Remove all " + bagCache.length + " items from the Bag?")) return;
  bagRemove(bagCache.map((i) => i.id));
});

async function pullBag(ids, mode, destRoot, destPath) {
  if (!destRoot) return null;
  let res;
  try {
    res = await fetch(peerPrefix() + "/api/bag/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, mode, dest_root: destRoot, dest_path: destPath }),
    });
  } catch (e) {
    return null;
  }
  if (res.status === 401) {
    location.href = "/";
    return null;
  }
  return res.json().catch(() => null);
}

function announceBagPull(data, mode) {
  const ok = (data && Array.isArray(data.done)) ? data.done : [];
  const fail = (data && Array.isArray(data.failed)) ? data.failed : [];
  for (const o of ok) {
    addHistoryRow(o.name, mode === "move" ? "moved from Bag" : "pulled from Bag", "success");
  }
  if (fail.length) {
    alert("Pull finished with " + fail.length + " problem(s):\n" +
      fail.slice(0, 5).map((f) => f.name + " — " + f.error).join("\n"));
  }
}

async function bagDropPull(id, destRoot, destPath) {
  const data = await pullBag([id], "copy", destRoot, destPath);
  if (!data) return;
  announceBagPull(data, "copy");
  refreshBag();
  if (!appView.hidden) loadListing();
}

bagPullBtn.addEventListener("click", async () => {
  if (!bagCache.length || !current.root) return;
  const mode = bagMode.value;
  const data = await pullBag(bagCache.map((i) => i.id), mode, current.root, current.path);
  if (!data) return;
  announceBagPull(data, mode);
  refreshBag();
  loadListing();
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