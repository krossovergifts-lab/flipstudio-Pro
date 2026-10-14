import { describe, expect, it, vi } from 'vitest'

// In-memory stand-in for the Tauri fs plugin, so the desktop library store's file layout is tested.
const files = new Map<string, Uint8Array | string>()
const dirs = new Set<string>()
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { Document: 6, AppLocalData: 14 },
  mkdir: async (path: string) => { dirs.add(path) },
  exists: async (path: string) => files.has(path) || dirs.has(path),
  readTextFile: async (path: string) => String(files.get(path)),
  writeTextFile: async (path: string, text: string) => { files.set(path, text) },
  readFile: async (path: string) => files.get(path) as Uint8Array,
  writeFile: async (path: string, bytes: Uint8Array) => { files.set(path, bytes) },
  rename: async (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from) },
  remove: async (path: string, options?: { recursive?: boolean }) => {
    files.delete(path)
    if (options?.recursive) for (const key of [...files.keys()]) if (key.startsWith(path + '/')) files.delete(key)
    dirs.delete(path)
  },
  readDir: async (path: string) => [...files.keys()].filter((key) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/')).map((key) => ({ name: key.slice(path.length + 1), isFile: true, isDirectory: false })),
}))
vi.mock('@tauri-apps/api/path', () => ({ documentDir: async () => '/home/user/Documents', appLocalDataDir: async () => '/home/user/.local', join: async (...parts: string[]) => parts.join('/') }))

import { createDesktopStore, Library } from './library'
import { createProject, PROJECT_VERSION } from './project'

describe('desktop library store', () => {
  it('writes page images as binary files beside the project and reads them back', async () => {
    const library = new Library(createDesktopStore())
    await library.load()
    const image = 'data:image/jpeg;base64,' + btoa('\xff\xd8\xff' + 'x'.repeat(4000))
    const book = await library.createBook(createProject({ version: PROJECT_VERSION, title: 'Desk', pages: [{ id: 'p1', width: 595, height: 842, previewUrl: image, overlays: [] }] }))
    const blobFiles = [...files.keys()].filter((key) => key.startsWith(`FlipStudio Pro/Library/${book.id}.files/`))
    expect(blobFiles).toHaveLength(1)
    const bytes = files.get(blobFiles[0]) as Uint8Array
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    expect(String(files.get(`FlipStudio Pro/Library/${book.id}.flipstudio.json`))).not.toContain('data:image')
    expect((await library.openBook(book.id)).pages[0].previewUrl).toBe(image)
    await library.deleteBook(book.id)
    expect([...files.keys()].some((key) => key.includes(book.id))).toBe(false)
  })
})
