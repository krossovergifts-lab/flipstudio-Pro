import { isTauri } from '@tauri-apps/api/core'
import { save as saveFileDialog } from '@tauri-apps/plugin-dialog'
import { stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { formatBytes } from './assets'
import { buildExportZip, buildSelfContainedExportHtml, type ProjectState } from './project'

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Saves an export. Desktop: native Save dialog, write, then verify the written size.
 * Browser: download. Returns a status message, or null when the user cancelled.
 */
export async function saveExport(content: string | Uint8Array, fileName: string, label: string, mime: string): Promise<string | null> {
  if (isTauri()) {
    const extension = fileName.split('.').pop() ?? ''
    const path = await saveFileDialog({ title: `Export ${label}`, defaultPath: fileName, filters: [{ name: label, extensions: [extension] }] })
    if (!path) return null
    try {
      if (typeof content === 'string') await writeTextFile(path, content)
      else await writeFile(path, content)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const permission = typeof content === 'string' ? 'fs:allow-write-text-file' : 'fs:allow-write-file'
      throw new Error(
        /not allowed|denied|forbidden|scope|permission/i.test(message)
          ? `The desktop app is not permitted to write this file (${message}). Add "${permission}" (with a scope covering the chosen folder) to src-tauri/capabilities/default.json.`
          : message,
      )
    }
    const expected = typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength
    const written = await stat(path)
    if (written.size !== expected) throw new Error(`The exported file size (${written.size} bytes) does not match the publication (${expected} bytes).`)
    return `${label} exported to ${path} (${formatBytes(expected)})`
  }
  downloadBlob(new Blob([content as BlobPart], { type: mime }), fileName)
  return `${label} download requested (${formatBytes(typeof content === 'string' ? content.length : content.byteLength)}); the browser chooses the destination`
}

export function exportFileBase(title: string): string {
  return (title.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'flipstudio') + '-publication'
}

/** Builds and saves an HTML or ZIP publication. Returns { message, warnings } or null if cancelled. */
export async function exportPublication(project: ProjectState, kind: 'html' | 'zip'): Promise<{ message: string; warnings: string[] } | null> {
  const warnings: string[] = []
  const options = { onWarning: (message: string) => warnings.push(message) }
  const base = exportFileBase(project.title)
  let message: string | null
  if (kind === 'html') {
    const html = await buildSelfContainedExportHtml(project, options)
    message = await saveExport(html, `${base}.html`, 'HTML publication', 'text/html;charset=utf-8')
  } else {
    const blob = await buildExportZip(project, options)
    message = await saveExport(new Uint8Array(await blob.arrayBuffer()), `${base}.zip`, 'ZIP publication', 'application/zip')
  }
  return message === null ? null : { message, warnings }
}
