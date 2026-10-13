import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import App from './App'

// Desktop code paths with the Tauri APIs mocked. This exercises the app's own
// dialog → write → verify logic; it does not replace testing the real Windows app.
const files = new Map<string, Uint8Array | string>()
const dialog = { savePath: 'C:\\Exports\\catalogue.zip' as string | null, openPath: '' as string | null }
const denyBinary = { value: false }

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: vi.fn(async () => dialog.savePath),
  open: vi.fn(async () => dialog.openPath),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async (path: string, data: string) => { files.set(path, data) }),
  writeFile: vi.fn(async (path: string, data: Uint8Array) => {
    if (denyBinary.value) throw new Error('fs.write_file not allowed. Permissions associated with this command: fs:allow-write-file')
    files.set(path, data)
  }),
  readTextFile: vi.fn(async (path: string) => String(files.get(path) ?? '')),
  stat: vi.fn(async (path: string) => {
    const content = files.get(path)
    return { size: typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content?.byteLength ?? 0 }
  }),
}))
vi.mock('page-flip', () => {
  class PageFlip { loadFromHTML() {} destroy() {} on() { return this } update() {} }
  return { PageFlip, default: { PageFlip } }
})
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: vi.fn() }))

beforeEach(() => {
  files.clear()
  denyBinary.value = false
  dialog.savePath = 'C:\\Exports\\catalogue.zip'
})
afterEach(() => cleanup())

describe('desktop (Tauri) file operations', () => {
  it('exports a ZIP to the chosen path and verifies the written size', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export ZIP' }))
    await waitFor(() => expect(screen.getByText(/ZIP publication exported to C:\\Exports\\catalogue\.zip/)).toBeTruthy())
    const zip = await JSZip.loadAsync(files.get('C:\\Exports\\catalogue.zip') as Uint8Array)
    expect(zip.file('publication/index.html')).toBeTruthy()
  })

  it('explains the missing capability when the binary write is not permitted', async () => {
    denyBinary.value = true
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Export ZIP' }))
    await waitFor(() => expect(screen.getByText(/Add "fs:allow-write-file"/)).toBeTruthy())
    expect(screen.getByText('ZIP export failed')).toBeTruthy()
  })

  it('treats a cancelled native dialog as a no-op', async () => {
    dialog.savePath = null
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Export HTML' }))
    await waitFor(() => expect(screen.getByText('HTML publication export cancelled')).toBeTruthy())
    expect(files.size).toBe(0)
  })

  it('saves with Save As, then reopens the same file through the native Open dialog', async () => {
    dialog.savePath = 'C:\\Projects\\spring.flipstudio.json'
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Saved natively' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }))
    await waitFor(() => expect(screen.getByText('Project saved to C:\\Projects\\spring.flipstudio.json')).toBeTruthy())

    cleanup()
    dialog.openPath = 'C:\\Projects\\spring.flipstudio.json'
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect((screen.getByLabelText('Label') as HTMLInputElement).value).toBe('Saved natively'))
  })
})
