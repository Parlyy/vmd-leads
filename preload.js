const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vmd", {
  open: (url) => ipcRenderer.invoke("open-external", url),
  copy: (text) => ipcRenderer.invoke("copy", text),
  saveJson: (name, data) => ipcRenderer.invoke("save-json", { name, data }),
  openJson: () => ipcRenderer.invoke("open-json"),
  platform: process.platform,
  onUpdateReady: (cb) => ipcRenderer.on("update-ready", (_e, v) => cb(v)),
  applyUpdate: () => ipcRenderer.invoke("apply-update"),
  uiVersion: () => ipcRenderer.invoke("ui-version"),
});
