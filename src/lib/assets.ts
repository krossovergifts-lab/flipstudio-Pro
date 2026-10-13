import { createAsset, type ProjectAsset } from './project'

/** Image formats the editor imports. SVG is shown through <img>, which never runs its scripts. */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif', 'image/bmp']
export const IMAGE_ACCEPT = SUPPORTED_IMAGE_TYPES.join(',') + ',.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.bmp'
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
}

/** Some Windows pickers report an empty MIME type; fall back to the file extension. */
export function imageTypeOf(file: Pick<File, 'name' | 'type'>): string {
  if (file.type) return file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TYPES[extension] ?? ''
}

export function fileToDataUrl(file: Blob, name = 'file'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error(`Unable to read ${name}.`))
    reader.readAsDataURL(file)
  })
}

/**
 * Decodes the image to confirm it is valid and to learn its size.
 * Resolves with undefined dimensions when the environment cannot decode images
 * (for example the jsdom test environment), rejects when decoding fails.
 */
export function measureImage(dataUrl: string, timeoutMs = 4000): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      resolve({})
      return
    }
    const image = new Image()
    const timer = window.setTimeout(() => resolve({}), timeoutMs)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve({ width: image.naturalWidth || undefined, height: image.naturalHeight || undefined })
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('The file could not be decoded as an image.'))
    }
    image.src = dataUrl
  })
}

/** Reads a local image file into a managed asset. The File is fully read before this resolves. */
export async function readImageAsset(file: File): Promise<ProjectAsset> {
  const type = imageTypeOf(file)
  if (!SUPPORTED_IMAGE_TYPES.includes(type)) {
    throw new Error(`${file.name} is not a supported image (PNG, JPEG, WebP, GIF, SVG, AVIF or BMP).`)
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${file.name} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
  }
  let dataUrl = await fileToDataUrl(file, file.name)
  if (!file.type && dataUrl.startsWith('data:application/octet-stream')) {
    dataUrl = dataUrl.replace('data:application/octet-stream', `data:${type}`)
  }
  let size: { width?: number; height?: number }
  try {
    size = await measureImage(dataUrl)
  } catch (error) {
    throw new Error(`${file.name}: ${error instanceof Error ? error.message : 'invalid image.'}`)
  }
  return createAsset({ name: file.name, dataUrl, width: size.width, height: size.height })
}

/** Reads several files; one bad file does not prevent the others from importing. */
export async function readImageAssets(files: File[]): Promise<{ assets: ProjectAsset[]; errors: string[] }> {
  const results = await Promise.allSettled(files.map((file) => readImageAsset(file)))
  const assets: ProjectAsset[] = []
  const errors: string[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') assets.push(result.value)
    else errors.push(result.reason instanceof Error ? result.reason.message : `${files[index]?.name ?? 'File'} could not be imported.`)
  })
  return { assets, errors }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
