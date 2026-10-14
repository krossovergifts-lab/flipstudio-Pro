import { cpSync, createReadStream, mkdirSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

const pdfjsDirectory = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))
const pdfAssetDirectories = ['wasm', 'cmaps', 'standard_fonts']

function servePdfAssets(): Plugin {
  return {
    name: 'serve-pdfjs-assets',
    configureServer(server) {
      for (const directory of pdfAssetDirectories) {
        const assetRoot = resolve(pdfjsDirectory, directory)
        server.middlewares.use(`/pdfjs/${directory}`, (request, response, next) => {
          const requestedPath = decodeURIComponent(request.url?.split('?')[0] ?? '').replace(/^\/+/, '')
          const filePath = resolve(assetRoot, requestedPath)
          if (!requestedPath || !filePath.startsWith(`${assetRoot}${sep}`)) {
            next()
            return
          }
          const stream = createReadStream(filePath)
          stream.on('error', () => {
            if (!response.headersSent) {
              response.statusCode = 404
              response.end('PDF asset not found')
            }
          })
          response.setHeader(
            'Content-Type',
            filePath.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
          )
          stream.pipe(response)
        })
      }
    },
    writeBundle(output) {
      for (const directory of pdfAssetDirectories) {
        const source = resolve(pdfjsDirectory, directory)
        const destination = resolve(output.dir ?? 'dist', 'pdfjs', directory)
        mkdirSync(destination, { recursive: true })
        cpSync(source, destination, { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), servePdfAssets()],
  test: {
    environment: 'jsdom',
    globals: true,
    // CI machines (GitHub's Windows runners) are much slower than a laptop.
    testTimeout: 60000,
    setupFiles: ['./src/test-setup.ts'],
  },
})
