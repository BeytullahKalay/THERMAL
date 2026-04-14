const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron')
const path = require('path')
const fs   = require('fs')

let mainWindow
let settingsPath

/* ── Persistent settings ─────────────────────────────────────────── */
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch {
    return { mode: 'fullscreen', width: 1920, height: 1080 }
  }
}

function saveSettings(data) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(data), 'utf8')
  } catch (e) {
    console.error('[settings] write failed:', e)
  }
}

/* ── Window creation ─────────────────────────────────────────────── */
function createWindow() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json')
  const saved  = loadSettings()

  // Remove the native menu bar entirely (File / Edit / View / …)
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width:            saved.width  || 1920,
    height:           saved.height || 1080,
    fullscreen:       saved.mode === 'fullscreen',
    autoHideMenuBar:  true,
    backgroundColor:  '#080a04',
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false
    }
  })

  mainWindow.loadFile('screens/boot.html')
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ── IPC: get primary display native size + current window state ── */
ipcMain.handle('get-display-info', () => {
  const primary = screen.getPrimaryDisplay()
  const win     = BrowserWindow.getFocusedWindow()
  const bounds  = win ? win.getBounds() : { width: 1920, height: 1080 }
  return {
    native:       { width: primary.bounds.width, height: primary.bounds.height },
    current:      { width: bounds.width,         height: bounds.height },
    isFullscreen: win ? win.isFullScreen() : false
  }
})

/* ── IPC: apply resolution / window-mode settings + persist ──────── */
ipcMain.handle('apply-settings', (event, { mode, width, height }) => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return

  if (mode === 'fullscreen') {
    win.setFullScreen(true)
    saveSettings({ mode: 'fullscreen', width, height })
  } else {
    win.setFullScreen(false)
    win.setSize(width, height)
    win.center()
    saveSettings({ mode: 'windowed', width, height })
  }
})
