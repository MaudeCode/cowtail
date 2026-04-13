import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProvider } from 'convex/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { convex, queryClient } from './lib/convex'
import { appVersion } from './lib/version'
import App from './App'
import './index.css'

document.documentElement.dataset.cowtailVersion = appVersion

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ConvexProvider>
  </StrictMode>,
)
