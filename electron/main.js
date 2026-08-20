import { app, BrowserWindow, session, shell } from 'electron'
import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

let mainWindow = null
let stopBackend = null

async function seedUserData(dataDir) {
  await mkdir(dataDir, { recursive: true })
  const seedDir = path.join(process.resourcesPath, 'default-data')
  const files = ['manualMusicTags.json', 'musicLibrary.json', 'yunMemory.json', 'yunSettings.json']

  await Promise.all(files.map(async (file) => {
    const source = path.join(seedDir, file)
    const destination = path.join(dataDir, file)
    if (!existsSync(source) || existsSync(destination)) return
    await copyFile(source, destination)
  }))
}

async function startBackend() {
  const dataDir = path.join(app.getPath('userData'), 'data')
  await seedUserData(dataDir)

  process.env.YUN_PUBLIC_DIR = path.join(app.getAppPath(), 'dist')
  process.env.YUN_DATA_DIR = dataDir

  const backend = await import('../server.js')
  const address = await backend.startServer(0)
  stopBackend = backend.stopServer
  return typeof address === 'object' && address ? address.port : 3030
}

function configurePermissions() {
  const allowedMediaPermissions = new Set([
    'media',
    'microphone',
    'camera',
    'audioCapture',
    'videoCapture',
    'display-capture',
  ])
  const isLocalAppUrl = (url = '') => url.startsWith('http://127.0.0.1:')

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const isLocalApp = isLocalAppUrl(requestingOrigin) || isLocalAppUrl(webContents?.getURL?.())
    return isLocalApp && allowedMediaPermissions.has(permission)
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isLocalApp = isLocalAppUrl(webContents.getURL())
    callback(isLocalApp && allowedMediaPermissions.has(permission))
  })

  session.defaultSession.setDevicePermissionHandler?.((details) => {
    const isLocalApp = isLocalAppUrl(details.origin) || isLocalAppUrl(details.frameOrigin)
    return isLocalApp && ['audioinput', 'videoinput'].includes(details.deviceType)
  })
}

async function createWindow() {
  const port = await startBackend()
  configurePermissions()

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#020608',
    autoHideMenuBar: true,
    title: '昀',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  await mainWindow.loadURL(`http://127.0.0.1:${port}?quality=high&release=1`)
}

app.setName('昀')

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return undefined
  return createWindow()
}).catch((error) => {
  console.error('桌面程序启动失败：', error)
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopBackend?.()
})
