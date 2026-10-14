import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'
import { routeExternalLinks } from './lib/external'
import { applyAppTheme } from './lib/appTheme'

routeExternalLinks()
applyAppTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
