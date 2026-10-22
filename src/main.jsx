import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/MusicApp.jsx'
import { BootProvider } from './boot/BootProvider.jsx'
import { getYunBootManager } from './boot/createYunBootManager.js'
import { getMusicAppearanceStore } from './app/appearance.js'

getMusicAppearanceStore()
const bootManager = getYunBootManager({ preloadPlaylistTracks: false })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BootProvider manager={bootManager}>
      {(bootState) => <App bootData={bootState.data} bootState={bootState} />}
    </BootProvider>
  </StrictMode>,
)
