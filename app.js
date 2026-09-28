import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile, setPersistence,
  browserLocalPersistence, browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL, GITHUB } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ================= helpers ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const fmtDate = t => t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const initials = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
const byNew = (a, b) => (b.created || 0) - (a.created || 0);
const byName = (a, b) => String(a.name).localeCompare(String(b.name));
const show = (sel, on = true) => { $(sel).hidden = !on; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};
const mediaUrl = p => p ? (/^https?:/i.test(p) ? p : p.split("/").map(encodeURIComponent).join("/")) : "";

const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>'
};

let toastT;
function toast(m, ms = 3200) { const el = $("#toast"); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, ms); }

/* ================= state ================= */
let ME = null;                       // { uid, email, name, admin }
let FOLDERS = [];
let ALL = null;                      // all tracks (admin, or after a search)
const BY_FOLDER = new Map();         // folderId|null -> tracks
const S = { view: "library", folder: null, track: null, q: "" };
const isAdmin = () => !!(ME && ME.admin);
const folderById = id => FOLDERS.find(f => f.id === id);

function pathOf(fid) { const out = []; let f = folderById(fid), g = 0; while (f && g++ < 50) { out.unshift(f); f = folderById(f.parent); } return out; }
const pathLabel = fid => pathOf(fid).map(f => f.name).join(" › ") || "Library";
function descendants(fid) { const out = [fid]; FOLDERS.filter(f => f.parent === fid).forEach(f => out.push(...descendants(f.id))); return out; }
function folderOptions(sel, exclude = []) {
  return `<option value="">Library (top level)</option>` + FOLDERS.filter(f => !exclude.includes(f.id))
    .map(f => ({ f, l: pathLabel(f.id) })).sort((a, b) => a.l.localeCompare(b.l))
    .map(({ f, l }) => `<option value="${f.id}" ${f.id === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
}
function coverHTML(t) {
  return `<span class="cover">${t.imagePath ? `<img src="${esc(mediaUrl(t.imagePath))}" alt="" loading="lazy">` : esc((t.title || "?").trim().charAt(0))}</span>`;
}

/* ================= data ================= */
async function loadFolders() { FOLDERS = rows(await getDocs(collection(db, "folders"))); }
async function loadAll() { ALL = rows(await getDocs(collection(db, "tracks"))); return ALL; }
async function tracksIn(fid) {
  if (ALL) return ALL.filter(t => (t.folder || null) === fid);
  if (!BY_FOLDER.has(fid)) BY_FOLDER.set(fid, rows(await getDocs(query(collection(db, "tracks"), where("folder", "==", fid)))));
  return BY_FOLDER.get(fid);
}
async function refreshData() { BY_FOLDER.clear(); ALL = null; await loadFolders(); if (isAdmin()) await loadAll(); }
async function findTrack(id) {
  const t = (ALL || []).find(x => x.id === id) || [...BY_FOLDER.values()].flat().find(x => x.id === id);
  if (t) return t;
  const s = await getDoc(doc(db, "tracks", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
function countFor(fid) { const f = folderById(fid); return f && f.count ? f.count : 0; }

/* ================= auth ================= */
function authMsg(e) {
  const c = e?.code || "";
  if (/invalid-credential|wrong-password|user-not-found/.test(c)) return "That email and password don’t match.";
  if (c.includes("invalid-email")) return "Enter a valid email address.";
  if (c.includes("email-already-in-use")) return "An account with this email already exists. Sign in instead.";
  if (c.includes("weak-password")) return "Use at least 8 characters for your password.";
  if (c.includes("too-many-requests")) return "Too many attempts. Wait a few minutes and try again.";
  if (c.includes("network")) return "Check your internet connection and try again.";
  return "Something went wrong (" + (c || e?.message || "unknown") + ").";
}
function setTab(t) {
  $("#tabIn").setAttribute("aria-selected", t === "in"); $("#tabUp").setAttribute("aria-selected", t === "up");
  show("#fIn", t === "in"); show("#fUp", t === "up");
  $("#inMsg").textContent = ""; $("#upMsg").textContent = ""; $("#inMsg").className = "msg";
}
async function busyBtn(form, fn) {
  const b = form.querySelector('button[type="submit"]'); b.disabled = true;
  try { await fn(); } finally { b.disabled = false; }
}

$("#fIn").addEventListener("submit", e => {
  e.preventDefault();
  const email = $("#inEmail").value.trim(), pw = $("#inPass").value, msg = $("#inMsg");
  msg.className = "msg"; msg.textContent = "";
  if (!email || !pw) { msg.textContent = "Enter your email and password."; return; }
  busyBtn(e.target, async () => {
    try {
      await setPersistence(auth, $("#inKeep").checked ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, pw);
      $("#inPass").value = "";
    } catch (err) { msg.textContent = authMsg(err); }
  });
});

$("#fUp").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("#upName").value.trim(), email = $("#upEmail").value.trim(), pw = $("#upPass").value, pw2 = $("#upPass2").value, msg = $("#upMsg");
  msg.textContent = "";
  if (!name) { msg.textContent = "Enter your name."; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Enter a valid email address."; return; }
  if (pw.length < 8) { msg.textContent = "Use at least 8 characters for your password."; return; }
  if (pw !== pw2) { msg.textContent = "The two passwords don’t match."; return; }
  busyBtn(e.target, async () => {
    try {
      await setPersistence(auth, $("#upKeep").checked ? browserLocalPersistence : browserSessionPersistence);
      pendingName = name;
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), { name, email: email.toLowerCase(), created: Date.now() });
      if (ME) { ME.name = name; renderNav(); }
      ["#upName", "#upEmail", "#upPass", "#upPass2"].forEach(s => $(s).value = "");
      toast("Account created. Welcome!");
    } catch (err) { pendingName = null; msg.textContent = authMsg(err); }
  });
});
let pendingName = null;

async function forgot() {
  const email = $("#inEmail").value.trim(), msg = $("#inMsg");
  if (!email) { msg.className = "msg"; msg.textContent = "Type your email above first, then tap “Forgot password?”."; return; }
  try { await sendPasswordResetEmail(auth, email); msg.className = "msg ok"; msg.textContent = "If that email has an account, a reset link is on its way."; }
  catch (err) { msg.className = "msg"; msg.textContent = authMsg(err); }
}

onAuthStateChanged(auth, async user => {
  show("#boot", false);
  if (!user) { ME = null; stopPlayer(); closeModal(true); show("#app", false); show("#auth"); return; }
  ME = {
    uid: user.uid, email: user.email,
    name: user.displayName || pendingName || (user.email || "").split("@")[0],
    admin: (user.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase()
  };
  show("#auth", false); show("#app");
  Object.assign(S, { view: "library", folder: null, track: null, q: "" }); $("#q").value = "";
  $("#view").innerHTML = `<div class="empty">Loading…</div>`;
  renderNav();
  try { await refreshData(); render(); }
  catch (err) { console.error(err); $("#view").innerHTML = `<div class="empty">Couldn’t load the library. Refresh the page to try again.</div>`; }
});

/* ================= render ================= */
function renderNav() {
  const tab = (v, l) => `<button class="tab" data-act="view" data-view="${v}" aria-current="${S.view === v || (v === "library" && S.view === "track")}">${l}</button>`;
  $("#nav").innerHTML = (isAdmin() ? tab("library", "Library") + tab("members", "Members") + `<button class="btn primary sm" data-act="upload">${I.up}Upload</button>` : "") +
    `<div class="user"><button class="avatar" data-act="menu" aria-label="Account" aria-expanded="false">${esc(initials(ME.name))}</button>
      <div class="menu" id="menu" hidden>
        <div class="who"><b dir="auto">${esc(ME.name)}</b><span>${esc(ME.email)}</span><br><span class="role">${isAdmin() ? "Admin" : "Member"}</span></div>
        ${isAdmin() ? `<button data-act="storage">Upload settings</button>` : ""}
        <button data-act="signout">Sign out</button>
      </div></div>`;
}
let renderId = 0;
async function render() {
  const my = ++renderId; renderNav();
  const v = $("#view");
  try {
    if (S.q) await renderSearch(v, my);
    else if (S.view === "members" && isAdmin()) await renderMembers(v, my);
    else if (S.view === "track") await renderTrack(v, my);
    else await renderLibrary(v, my);
  } catch (err) { console.error(err); if (my === renderId) v.innerHTML = `<div class="empty">Something went wrong. Refresh the page to try again.</div>`; }
}
function crumbs(fid, includeSelf) {
  const p = pathOf(fid); if (!includeSelf) p.pop();
  return `<nav class="crumbs"><button data-act="folder" data-id="">Library</button>${p.map(f => `<span>›</span><button data-act="folder" data-id="${f.id}" dir="auto">${esc(f.name)}</button>`).join("")}</nav>`;
}
function rowHTML(t, showPath) {
  const current = P.id === t.id, on = current && !audio.paused;
  return `<div class="row ${current ? "current" : ""}">
    <button class="playbtn ${on ? "on" : ""}" data-act="play" data-id="${t.id}" aria-label="${on ? "Pause" : "Play"} ${esc(t.title)}">${on ? I.pause : I.play}</button>
    ${coverHTML(t)}
    <button class="t" data-act="track" data-id="${t.id}"><b dir="auto">${esc(t.title)}</b><span dir="auto">${showPath ? esc(pathLabel(t.folder || null)) : fmtDate(t.created)}</span></button>
    <span class="dur num">${t.duration ? fmt(t.duration) : ""}</span>
    ${isAdmin() ? `<span class="acts"><button class="btn ghost sm" data-act="edit" data-id="${t.id}">Edit</button><button class="btn ghost sm danger" data-act="delTrack" data-id="${t.id}">Delete</button></span>` : ""}
  </div>`;
}
async function renderLibrary(v, my) {
  const fid = S.folder, cur = folderById(fid);
  if (fid && !cur) { S.folder = null; return renderLibrary(v, my); }
  const folders = FOLDERS.filter(f => (f.parent || null) === fid).sort(byName);
  const tracks = (await tracksIn(fid)).slice().sort(byNew);
  if (my !== renderId) return;
  const n = tracks.length;
  v.innerHTML = `${fid ? crumbs(fid, false) : ""}
  <div class="head"><div><h1 dir="auto">${fid ? esc(cur.name) : "Library"}</h1>
    <div class="sub num">${folders.length ? `${folders.length} folder${folders.length === 1 ? "" : "s"}` : ""}${folders.length && n ? " · " : ""}${n ? `${n} recording${n === 1 ? "" : "s"}` : ""}</div></div>
    ${isAdmin() ? `<div class="tools">
      <button class="btn sm" data-act="newFolder">${I.plus}New folder</button>
      ${fid ? `<button class="btn sm" data-act="editFolder" data-id="${fid}">Rename / move</button><button class="btn sm danger" data-act="delFolder" data-id="${fid}">Delete folder</button>` : ""}
      <button class="btn sm primary" data-act="upload">${I.up}Upload here</button></div>` : ""}
  </div>
  ${folders.length ? `<p class="label">Folders</p><div class="folders">${folders.map(f => { const c = countFor(f.id); return `<button class="folder" data-act="folder" data-id="${f.id}">${I.folder}<span><b dir="auto">${esc(f.name)}</b><small>${c ? `${c} recording${c === 1 ? "" : "s"}` : "Folder"}</small></span></button>`; }).join("")}</div>` : ""}
  ${n ? `<p class="label">Recordings</p><div class="list">${tracks.map(t => rowHTML(t, false)).join("")}</div>` : ""}
  ${!folders.length && !n ? `<div class="empty">${isAdmin() ? "Nothing here yet. Upload a recording or create a folder." : "Nothing here yet."}</div>` : ""}`;
}
async function renderSearch(v, my) {
  if (!ALL) { v.innerHTML = `<div class="empty">Searching…</div>`; await loadAll(); }
  if (my !== renderId) return;
  const q = S.q.toLowerCase();
  const res = ALL.filter(t => ((t.title || "") + " " + (t.description || "") + " " + pathLabel(t.folder || null)).toLowerCase().includes(q)).sort(byNew);
  v.innerHTML = `<div class="head"><div><h1>Search</h1><div class="sub num">${res.length} result${res.length === 1 ? "" : "s"} for “<span dir="auto">${esc(S.q)}</span>”</div></div></div>
  ${res.length ? `<div class="list">${res.map(t => rowHTML(t, true)).join("")}</div>` : `<div class="empty">No recordings match. Try a word from the title or the poem.</div>`}`;
}
async function renderTrack(v, my) {
  const t = await findTrack(S.track);
  if (my !== renderId) return;
  if (!t) { S.view = "library"; return renderLibrary(v, my); }
  const on = P.id === t.id && !audio.paused;
  v.innerHTML = `${crumbs(t.folder || null, true)}
  <article class="track">
    ${coverHTML(t)}
    <div>
      <div class="meta"><span dir="auto">${esc(pathLabel(t.folder || null))}</span></div>
      <h1 dir="auto">${esc(t.title)}</h1>
      <div class="meta num">${t.duration ? `<span>${fmt(t.duration)}</span>` : ""}<span>Added ${fmtDate(t.created)}</span></div>
      <div class="cta">
        <button class="btn primary" data-act="play" data-id="${t.id}">${on ? I.pause + "Pause" : I.play + "Play"}</button>
        <button class="btn" data-act="copyTitle" data-id="${t.id}">Copy title</button>
        ${isAdmin() ? `<button class="btn" data-act="edit" data-id="${t.id}">Edit</button><button class="btn danger" data-act="delTrack" data-id="${t.id}">Delete</button>` : ""}
      </div>
      <div class="poem"><p class="label">Poem · القصيدة</p>
        ${t.description ? `<p class="verse" dir="auto">${esc(t.description)}</p>` : `<p class="sub">No text added for this recording.</p>`}</div>
    </div>
  </article>`;
  scrollTo({ top: 0 });
}
async function renderMembers(v, my) {
  v.innerHTML = `<div class="empty">Loading members…</div>`;
  const users = rows(await getDocs(collection(db, "users"))).sort(byNew);
  if (my !== renderId) return;
  const total = ALL ? ALL.length : 0;
  v.innerHTML = `<div class="head"><div><h1>Members</h1><div class="sub">Everyone who created an account. Only you can upload.</div></div></div>
  <div class="stats">
    <div class="stat"><b class="num">${users.length}</b><span>Members</span></div>
    <div class="stat"><b class="num">${total}</b><span>Recordings</span></div>
    <div class="stat"><b class="num">${FOLDERS.length}</b><span>Folders</span></div>
  </div>
  <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Joined</th></tr></thead><tbody>
  ${users.map(u => `<tr><td dir="auto">${esc(u.name)}</td><td>${esc(u.email)}</td><td class="num">${fmtDate(u.created)}</td></tr>`).join("") || `<tr><td colspan="3" class="sub">No members yet.</td></tr>`}
  </tbody></table></div>`;
}

/* ================= player ================= */
const audio = new Audio(); audio.preload = "metadata";
const P = { id: null };
async function play(id) {
  if (P.id === id) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
  const t = await findTrack(id); if (!t || !t.audioPath) return;
  P.id = id; audio.src = mediaUrl(t.audioPath);
  audio.play().catch(() => toast("This recording couldn’t play. If it was just uploaded, try again in a minute."));
  show("#player"); $("#pCover").innerHTML = coverHTML(t);
  $("#pTitle").textContent = t.title; $("#pSub").textContent = pathLabel(t.folder || null);
  $("#pDur").textContent = t.duration ? fmt(t.duration) : "0:00";
  syncPlay();
}
function stopPlayer() { audio.pause(); audio.removeAttribute("src"); P.id = null; show("#player", false); syncPlay(); }
function syncPlay() {
  const playing = !audio.paused;
  $("#pToggle").innerHTML = playing ? I.pause : I.play;
  document.querySelectorAll('[data-act="play"]').forEach(b => {
    const on = b.dataset.id === P.id && playing;
    if (b.classList.contains("playbtn")) { b.classList.toggle("on", on); b.innerHTML = on ? I.pause : I.play; b.closest(".row")?.classList.toggle("current", b.dataset.id === P.id); }
    else b.innerHTML = on ? I.pause + "Pause" : I.play + "Play";
  });
}
["play", "pause", "ended"].forEach(ev => audio.addEventListener(ev, syncPlay));
audio.addEventListener("error", () => { if (P.id) toast("This recording couldn’t load. If it was just uploaded, try again in a minute."); });
let seeking = false;
audio.addEventListener("timeupdate", () => {
  const d = audio.duration || 0;
  if (!seeking && d) $("#pSeek").value = Math.round(audio.currentTime / d * 1000);
  $("#pCur").textContent = fmt(audio.currentTime);
  if (d && isFinite(d)) $("#pDur").textContent = fmt(d);
});
$("#pSeek").addEventListener("input", e => { seeking = true; const d = audio.duration || 0; $("#pCur").textContent = fmt(e.target.value / 1000 * d); });
$("#pSeek").addEventListener("change", e => { const d = audio.duration || 0; if (d) audio.currentTime = e.target.value / 1000 * d; seeking = false; });

/* ================= GitHub media storage (admin only) ================= */
const TOKEN_KEY = "azayat.githubToken";
const ghToken = () => store.get(TOKEN_KEY);
const ghBase = `https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}`;
function ghError(status, body) {
  if (status === 401) return "GitHub didn’t accept the upload key. Open Upload settings and paste a new one.";
  if (status === 403 || status === 404) return "The upload key can’t write to the repository. Check its permissions in Upload settings.";
  if (status === 409) return "GitHub was busy saving another file. Try again.";
  if (status === 413 || status === 422) return (body && body.message) ? "GitHub refused the file: " + body.message : "GitHub refused the file.";
  return "GitHub error " + status + (body && body.message ? ": " + body.message : "");
}
function ghPut(path, base64, message, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", `${ghBase}/contents/${path}`);
    x.setRequestHeader("Authorization", "Bearer " + ghToken());
    x.setRequestHeader("Accept", "application/vnd.github+json");
    x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    x.onload = () => { let b = null; try { b = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(b) : reject(new Error(ghError(x.status, b))); };
    x.onerror = () => reject(new Error("Network error while uploading. Check your connection and try again."));
    x.send(JSON.stringify({ message, content: base64, branch: GITHUB.branch }));
  });
}
async function ghDelete(path) {
  if (!path || /^https?:/i.test(path)) return;
  try {
    const h = { Authorization: "Bearer " + ghToken(), Accept: "application/vnd.github+json" };
    const r = await fetch(`${ghBase}/contents/${path}?ref=${GITHUB.branch}`, { headers: h, cache: "no-store" });
    if (!r.ok) return;
    const { sha } = await r.json();
    await fetch(`${ghBase}/contents/${path}`, { method: "DELETE", headers: h, body: JSON.stringify({ message: "Delete " + path, sha, branch: GITHUB.branch }) });
  } catch (e) { console.warn("Could not delete", path, e); }
}
function toBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function shrinkImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const max = 900, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), "image/jpeg", 0.85));
  } catch { return file; }
}
function durationOf(file) {
  return new Promise(res => {
    const a = new Audio(), u = URL.createObjectURL(file); let done = false;
    const fin = d => { if (done) return; done = true; URL.revokeObjectURL(u); res(isFinite(d) ? Math.round(d) : 0); };
    a.preload = "metadata"; a.onloadedmetadata = () => fin(a.duration); a.onerror = () => fin(0); setTimeout(() => fin(0), 6000); a.src = u;
  });
}
const AUDIO_EXT = ["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "mp4"];
const extOf = f => (f.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* ================= modals ================= */
let working = false;
function openModal(html, onMount) { $("#modal").innerHTML = html; show("#scrim"); onMount && onMount(); setTimeout(() => $("#modal").querySelector("input:not([type=file]),select,textarea,button")?.focus(), 30); }
function closeModal(force) { if (working && !force) return; show("#scrim", false); $("#modal").innerHTML = ""; }
$("#scrim").addEventListener("mousedown", e => { if (e.target.id === "scrim") closeModal(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scrim").hidden) closeModal(); });
addEventListener("beforeunload", e => { if (working) { e.preventDefault(); e.returnValue = ""; } });

function confirmBox(title, body, label, fn) {
  openModal(`<h2>${esc(title)}</h2><p>${body}</p><p class="msg" id="cMsg"></p>
    <div class="foot"><button class="btn" data-act="close">Cancel</button><button class="btn danger-solid" id="cOk">${esc(label)}</button></div>`,
    () => $("#cOk").onclick = async () => {
      working = true; $("#cOk").disabled = true;
      try { await fn(); working = false; closeModal(); }
      catch (err) { console.error(err); $("#cMsg").textContent = err.message || "Something went wrong."; }
      finally { working = false; const b = $("#cOk"); if (b) b.disabled = false; }
    });
}

function storageModal(thenUpload) {
  const has = !!ghToken();
  openModal(`<h2>Upload settings</h2>
    <p>Recordings are saved in your GitHub repository <code>${GITHUB.owner}/${GITHUB.repo}</code>. To upload from this site, paste a GitHub key once. It stays only in this browser.</p>
    <div class="note">Create the key at <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com → Fine-grained tokens</a>:
      <br>• Repository access: <b>Only select repositories</b> → <code>${GITHUB.repo}</code>
      <br>• Permissions → Repository → <b>Contents: Read and write</b>
      <br>• Expiration: pick the longest you’re comfortable with</div>
    <div class="field"><label for="ghTok">GitHub key</label><input class="input" id="ghTok" type="password" autocomplete="off" placeholder="${has ? "Saved — paste a new one to replace it" : "github_pat_…"}"></div>
    <p class="msg" id="ghMsg"></p>
    <div class="foot">${has ? `<button class="btn danger" id="ghForget">Remove key from this browser</button>` : ""}<button class="btn" data-act="close">Close</button><button class="btn primary" id="ghSave">Save and check</button></div>`,
  () => {
    $("#ghForget") && ($("#ghForget").onclick = () => { store.del(TOKEN_KEY); closeModal(); toast("Upload key removed from this browser"); });
    $("#ghSave").onclick = async () => {
      const tok = $("#ghTok").value.trim(), msg = $("#ghMsg"); msg.className = "msg";
      if (!tok) { msg.textContent = "Paste the key first."; return; }
      msg.className = "msg ok"; msg.textContent = "Checking…";
      try {
        const r = await fetch(ghBase, { headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json" } });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) { msg.className = "msg"; msg.textContent = ghError(r.status, b); return; }
        if (b.permissions && !b.permissions.push) { msg.className = "msg"; msg.textContent = "This key can read the repository but can’t write to it. Give it “Contents: Read and write”."; return; }
        store.set(TOKEN_KEY, tok); closeModal(); toast("Upload key saved. You’re ready to upload.");
        if (thenUpload) trackModal(null);
      } catch { msg.className = "msg"; msg.textContent = "Couldn’t reach GitHub. Check your connection."; }
    };
  });
}

function folderModal(f) {
  const editing = !!f;
  openModal(`<h2>${editing ? "Rename or move folder" : "New folder"}</h2>
    <div class="field"><label for="mfName">Folder name</label><input class="input" id="mfName" dir="auto" value="${esc(f?.name || "")}" placeholder="e.g. Muharram 1448"></div>
    <div class="field"><label for="mfParent">Inside</label><select class="input" id="mfParent">${folderOptions(editing ? (f.parent || "") : (S.folder || ""), editing ? descendants(f.id) : [])}</select></div>
    <p class="msg" id="mfMsg"></p>
    <div class="foot"><button class="btn" data-act="close">Cancel</button><button class="btn primary" id="mfOk">${editing ? "Save" : "Create folder"}</button></div>`,
  () => $("#mfOk").onclick = async () => {
    const name = $("#mfName").value.trim(), parent = $("#mfParent").value || null;
    if (!name) { $("#mfMsg").textContent = "Give the folder a name."; return; }
    $("#mfOk").disabled = true;
    try {
      if (editing) await updateDoc(doc(db, "folders", f.id), { name, parent });
      else await addDoc(collection(db, "folders"), { name, parent, count: 0, created: Date.now() });
      closeModal(); await refreshData(); render(); toast(editing ? "Folder saved" : "Folder created");
    } catch (err) { console.error(err); $("#mfMsg").textContent = "Couldn’t save the folder. " + (err.code || ""); $("#mfOk").disabled = false; }
  });
}

function trackModal(t) {
  if (!ghToken()) { storageModal(true); return; }
  const editing = !!t;
  openModal(`<h2>${editing ? "Edit recording" : "Upload a recording"}</h2>
    <div class="field"><label for="mTitle">Title</label><input class="input" id="mTitle" dir="auto" value="${esc(t?.title || "")}" placeholder="Arabic or English"></div>
    <div class="field"><label for="mFolder">Folder</label><select class="input" id="mFolder">${folderOptions(editing ? (t.folder || "") : (S.folder || ""))}</select></div>
    <div class="grid2">
      <label class="drop" id="dAudio">${I.audio}<input type="file" id="mAudio" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac"><span><b id="mAudioName">${editing ? "Current audio kept" : "Choose audio file"}</b><small>${editing ? "Pick a file to replace it" : "MP3 or M4A · from Files or Drive"}</small></span></label>
      <label class="drop" id="dCover">${I.image}<input type="file" id="mCover" accept="image/*"><span><b id="mCoverName">${t?.imagePath ? "Current cover kept" : "Choose cover image"}</b><small>Optional · square works best</small></span></label>
    </div>
    ${t?.imagePath ? `<label class="check"><input type="checkbox" id="mCoverDel"> Remove current cover</label>` : ""}
    <div class="field"><label for="mDesc">Description or full poem</label><textarea class="input" id="mDesc" dir="auto" placeholder="Write the full poem here. Arabic and English both work.">${esc(t?.description || "")}</textarea></div>
    <div class="progress" id="mProg" hidden><i></i></div>
    <p class="msg" id="mMsg"></p>
    <div class="foot"><button class="btn" data-act="close">Cancel</button><button class="btn primary" id="mOk">${editing ? "Save changes" : I.up + "Upload"}</button></div>`,
  () => {
    const wire = (inp, drop, name, kind) => {
      const showName = f => { if (f) $(name).textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB`; };
      $(inp).onchange = e => showName(e.target.files[0]);
      const d = $(drop);
      d.addEventListener("dragover", e => { e.preventDefault(); d.classList.add("over"); });
      d.addEventListener("dragleave", () => d.classList.remove("over"));
      d.addEventListener("drop", e => { e.preventDefault(); d.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f && (f.type.startsWith(kind) || kind === "audio")) { const dt = new DataTransfer(); dt.items.add(f); $(inp).files = dt.files; showName(f); } });
    };
    wire("#mAudio", "#dAudio", "#mAudioName", "audio"); wire("#mCover", "#dCover", "#mCoverName", "image");
    $("#mOk").onclick = () => saveTrack(t);
  });
}

async function saveTrack(t) {
  const title = $("#mTitle").value.trim(), folder = $("#mFolder").value || null, description = $("#mDesc").value;
  const af = $("#mAudio").files[0], cf = $("#mCover").files[0], coverDel = $("#mCoverDel")?.checked;
  const msg = $("#mMsg"), bar = $("#mProg i"); msg.className = "msg"; msg.textContent = "";
  if (!title) { msg.textContent = "Add a title."; return; }
  if (!t && !af) { msg.textContent = "Choose an audio file to upload."; return; }
  if (af && !(af.type.startsWith("audio/") || AUDIO_EXT.includes(extOf(af)))) { msg.textContent = "That file isn’t audio. Use MP3 or M4A."; return; }
  if (af && af.size > 45 * 1048576) { msg.textContent = "Audio files can be up to 45 MB. Export it as MP3 at 64–96 kbps to make it smaller."; return; }
  if (cf && !cf.type.startsWith("image/")) { msg.textContent = "The cover must be an image."; return; }

  working = true; $("#mOk").disabled = true; show("#mProg");
  const id = t?.id || doc(collection(db, "tracks")).id;
  const oldFiles = [], stamp = Date.now().toString(36);
  let { audioPath = "", imagePath = "", duration = 0 } = t || {};
  try {
    if (af) {
      msg.className = "msg ok"; msg.textContent = "Uploading audio… keep this page open.";
      const ext = AUDIO_EXT.includes(extOf(af)) ? extOf(af) : "mp3";
      const path = `media/audio/${id}-${stamp}.${ext}`;
      const [b64, dur] = await Promise.all([toBase64(af), durationOf(af)]);
      await ghPut(path, b64, "Add recording: " + title, p => bar.style.width = Math.round(p * (cf ? 85 : 95)) + "%");
      if (audioPath) oldFiles.push(audioPath);
      audioPath = path; duration = dur || duration;
    }
    if (cf) {
      msg.className = "msg ok"; msg.textContent = "Uploading cover…";
      const small = await shrinkImage(cf);
      const path = `media/covers/${id}-${stamp}.jpg`;
      await ghPut(path, await toBase64(small), "Add cover: " + title, p => bar.style.width = (85 + Math.round(p * 10)) + "%");
      if (imagePath) oldFiles.push(imagePath);
      imagePath = path;
    } else if (coverDel && imagePath) { oldFiles.push(imagePath); imagePath = ""; }

    msg.textContent = "Saving details…";
    const data = { title, description, folder, audioPath, imagePath, duration, updated: Date.now(), created: t?.created || Date.now() };
    await setDoc(doc(db, "tracks", id), data);
    const before = t ? (t.folder || null) : undefined;
    if (!t && folder) await updateDoc(doc(db, "folders", folder), { count: increment(1) }).catch(() => {});
    if (t && before !== folder) {
      if (before) await updateDoc(doc(db, "folders", before), { count: increment(-1) }).catch(() => {});
      if (folder) await updateDoc(doc(db, "folders", folder), { count: increment(1) }).catch(() => {});
    }
    bar.style.width = "100%";
    for (const p of oldFiles) await ghDelete(p);
    if (af && P.id === id) stopPlayer();
    working = false; closeModal();
    if (!t) { S.folder = folder; S.view = "library"; S.q = ""; $("#q").value = ""; }
    await refreshData(); render();
    toast(af ? "Uploaded. It will be playable in about a minute." : "Changes saved", 4500);
  } catch (err) {
    console.error(err);
    msg.className = "msg"; msg.textContent = err.message || "Upload failed. Try again.";
  } finally {
    working = false; const b = $("#mOk"); if (b) b.disabled = false;
  }
}

/* ================= events ================= */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]");
  const menu = $("#menu");
  if (menu && !menu.hidden && !e.target.closest(".user")) menu.hidden = true;
  if (!b) return;
  const d = b.dataset;
  switch (d.act) {
    case "tab": setTab(d.tab); break;
    case "peek": { const i = b.previousElementSibling, s = i.type === "password"; i.type = s ? "text" : "password"; b.textContent = s ? "Hide" : "Show"; break; }
    case "forgot": forgot(); break;
    case "home": Object.assign(S, { view: "library", folder: null, q: "" }); $("#q").value = ""; render(); break;
    case "view": Object.assign(S, { view: d.view, q: "" }); $("#q").value = ""; render(); break;
    case "menu": { const m = $("#menu"); m.hidden = !m.hidden; b.setAttribute("aria-expanded", !m.hidden); break; }
    case "signout": stopPlayer(); await signOut(auth); break;
    case "storage": $("#menu").hidden = true; storageModal(false); break;
    case "folder": Object.assign(S, { view: "library", folder: d.id || null, q: "" }); $("#q").value = ""; render(); scrollTo({ top: 0 }); break;
    case "track": Object.assign(S, { view: "track", track: d.id, q: "" }); $("#q").value = ""; render(); break;
    case "openPlaying": if (P.id) { Object.assign(S, { view: "track", track: P.id, q: "" }); $("#q").value = ""; render(); } break;
    case "play": play(d.id); break;
    case "toggle": audio.paused ? audio.play().catch(() => {}) : audio.pause(); break;
    case "closePlayer": stopPlayer(); break;
    case "copyTitle": { const t = await findTrack(d.id); try { await navigator.clipboard.writeText(t.title); toast("Title copied"); } catch { toast("Copy isn’t available here"); } break; }
    case "close": closeModal(); break;
    case "upload": if (isAdmin()) trackModal(null); break;
    case "edit": if (isAdmin()) trackModal(await findTrack(d.id)); break;
    case "newFolder": if (isAdmin()) folderModal(null); break;
    case "editFolder": if (isAdmin()) folderModal(folderById(d.id)); break;
    case "delFolder": {
      if (!isAdmin()) break;
      const f = folderById(d.id);
      const hasKids = FOLDERS.some(x => x.parent === f.id) || (await tracksIn(f.id)).length;
      if (hasKids) { openModal(`<h2>Folder isn’t empty</h2><p>Move or delete the recordings and folders inside “<span dir="auto">${esc(f.name)}</span>” first.</p><div class="foot"><button class="btn primary" data-act="close">OK</button></div>`); break; }
      confirmBox("Delete folder?", `“<span dir="auto">${esc(f.name)}</span>” will be removed.`, "Delete", async () => {
        await deleteDoc(doc(db, "folders", f.id)); S.folder = f.parent || null; await refreshData(); render(); toast("Folder deleted");
      });
      break;
    }
    case "delTrack": {
      if (!isAdmin()) break;
      const t = await findTrack(d.id); if (!t) break;
      confirmBox("Delete recording?", `“<span dir="auto">${esc(t.title)}</span>” and its audio will be removed for everyone.`, "Delete", async () => {
        if (P.id === t.id) stopPlayer();
        await deleteDoc(doc(db, "tracks", t.id));
        if (t.folder) await updateDoc(doc(db, "folders", t.folder), { count: increment(-1) }).catch(() => {});
        if (ghToken()) { await ghDelete(t.audioPath); await ghDelete(t.imagePath); }
        if (S.track === t.id) S.view = "library";
        await refreshData(); render(); toast("Recording deleted");
      });
      break;
    }
  }
});
let qT;
$("#q").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value.trim(); render(); }, 250); });
