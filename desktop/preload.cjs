const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  bootstrap: () => ipcRenderer.invoke('desktop:bootstrap'),
  signIn: () => ipcRenderer.invoke('desktop:sign-in'),
  signInStatus: () => ipcRenderer.invoke('desktop:sign-in-status'),
  copyText: text => ipcRenderer.invoke('desktop:copy-text', text),
  readText: () => ipcRenderer.invoke('desktop:read-text'),
  chooseFolder: () => ipcRenderer.invoke('desktop:choose-folder'),
  chooseAttachments: kind => ipcRenderer.invoke('desktop:choose-attachments', kind),
  clipboardFiles: () => ipcRenderer.invoke('desktop:clipboard-files'),
  resolveAttachments: paths => ipcRenderer.invoke('desktop:resolve-attachments', paths),
  filePath: file => webUtils.getPathForFile(file),
  openLink: url => ipcRenderer.invoke('desktop:open-link', url),
});
