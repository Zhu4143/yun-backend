import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BootProvider } from './boot/BootProvider.jsx'
import { getYunBootManager } from './boot/createYunBootManager.js'

const bootManager = getYunBootManager()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BootProvider manager={bootManager}>
      {(bootState) => <App bootData={bootState.data} />}
    </BootProvider>
  </StrictMode>,
)
