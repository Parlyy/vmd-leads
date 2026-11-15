const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, Menu, net } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

/* ---------- UI auto-update ----------
   The installed app is a shell. The UI (index.html, app.js, style.css) is downloaded from
   UPDATE_BASE when a newer version.json is published, verified by SHA-256, and kept in
   userData/ui so it also works offline. */
const UPDATE_BASE = "https://parlyy.github.io/vmd-leads/";
const BUNDLED_DIR = path.join(__dirname, "renderer");
const UI_DIR = () => path.join(app.getPath("userData"), "ui");
const readVer = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, "version.json"), "utf8")).version || 0; } catch (e) { return 0; } };
function activeDir() { return readVer(UI_DIR()) > readVer(BUNDLED_DIR) ? UI_DIR() : BUNDLED_DIR; }
let loadedVersion = 0, pendingVersion = 0, mainWin = null;

async function fetchBuf(url) {
  const res = await net.fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error(url + " " + res.status);
  return Buffer.from(await res.arrayBuffer());
}
async function checkForUpdate() {
  if (/REPLACE_OWNER/.test(UPDATE_BASE)) return;
  try {
    const remote = JSON.parse((await fetchBuf(UPDATE_BASE + "version.json")).toString("utf8"));
    const have = Math.max(loadedVersion, pendingVersion);
    if (!remote.version || remote.version <= have || !remote.files) return;
    const tmp = path.join(app.getPath("userData"), "ui-download");
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    for (const [name, sha] of Object.entries(remote.files)) {
      if (!/^[a-z0-9_.-]+$/i.test(name)) throw new Error("bad file name " + name);
      const buf = await fetchBuf(UPDATE_BASE + name);
      const got = crypto.createHash("sha256").update(buf).digest("hex");
      if (got !== sha) throw new Error("checksum mismatch for " + name);
      fs.writeFileSync(path.join(tmp, name), buf);
    }
    fs.writeFileSync(path.join(tmp, "version.json"), JSON.stringify(remote));
    fs.rmSync(UI_DIR(), { recursive: true, force: true });
    fs.renameSync(tmp, UI_DIR());
    pendingVersion = remote.version;
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("update-ready", remote.version);
  } catch (e) {
    console.error("update check failed:", e.message);
  }
}
function loadUi(win) {
  const dir = activeDir();
  loadedVersion = readVer(dir);
  win.loadFile(path.join(dir, "index.html"));
}

const ALLOWED = /^(mailto:|sms:|tel:|https:\/\/)/i;

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: "VMD Leads",
    backgroundColor: "#F3F5F8",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWin = win;
  loadUi(win);
  win.webContents.once("did-finish-load", () => setTimeout(checkForUpdate, 3000));

  // Never navigate the app window away; send links to the OS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ALLOWED.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      if (ALLOWED.test(url)) shell.openExternal(url);
    }
  });
}

ipcMain.handle("apply-update", (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) loadUi(w); return true; });
ipcMain.handle("ui-version", () => loadedVersion);
ipcMain.handle("open-external", (_e, url) => {
  if (typeof url === "string" && ALLOWED.test(url)) return shell.openExternal(url);
  return false;
});
ipcMain.handle("copy", (_e, text) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});
ipcMain.handle("save-json", async (e, { name, data }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    defaultPath: name,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, data, "utf8");
  return r.filePath;
});
ipcMain.handle("open-json", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], "utf8");
});

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ])
    );
  } else {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: "editMenu" }, { role: "viewMenu" }])
    );
  }
  createWindow();
  setInterval(checkForUpdate, 2 * 60 * 60 * 1000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
