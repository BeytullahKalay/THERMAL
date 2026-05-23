const { app, BrowserWindow, ipcMain, screen, Menu } = require('electron')
const path = require('path')
const fs   = require('fs')

/* Disable Chromium's autoplay gesture requirement so Web Audio
   contexts can start the moment a screen loads — otherwise UI sfx
   (hover blip, click tok) stay silent until the player first clicks. */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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
    /* CRT UI is laid out for the chosen resolution. Letting the player
       drag the frame breaks the layout, so we lock it. Players change
       size via SETTINGS → DISPLAY RESOLUTION instead. We do NOT use
       useContentSize because that subtracts window chrome from the
       requested size — the design is calibrated against the full
       window box (chrome is hidden via autoHideMenuBar anyway). */
    resizable:        false,
    maximizable:      false,
    fullscreenable:   true,
    webPreferences: {
      nodeIntegration:       true,
      contextIsolation:      false,
      autoplayPolicy:        'no-user-gesture-required'
    }
  })

  /* Expose a debug-mode flag to every page so the in-game F1 panel
     and other dev surfaces can opt-in only in dev runs. Packaged
     builds (production) get __THERMAL_DEBUG__ = false.
     Also expose __DEMO__ for the Steam Demo build (set via
     THERMAL_DEMO env var or package.json extraMetadata.demoBuild). */
  const isDev = !app.isPackaged
  let isDemo = !!process.env.THERMAL_DEMO
  try {
    /* electron-builder writes the package.json INTO the asar — read
       it via require so the demoBuild flag from extraMetadata is
       visible at runtime in production builds. */
    const pkg = require('./package.json')
    if (pkg && pkg.demoBuild) isDemo = true
  } catch (e) {}
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      'window.__THERMAL_DEBUG__ = ' + JSON.stringify(isDev) + ';' +
      'window.__DEMO__ = '          + JSON.stringify(isDemo) + ';',
      true
    ).catch(() => {})
  })

  mainWindow.loadFile('screens/splash.html')
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
    /* Temporarily allow programmatic resize, set, then re-lock so the
       user can't drag the frame after the new size is applied. */
    win.setResizable(true)
    win.setSize(width, height)
    win.center()
    win.setResizable(false)
    saveSettings({ mode: 'windowed', width, height })
  }
})
