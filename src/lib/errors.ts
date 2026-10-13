/** Readable message for any thrown value. Tauri commands reject with plain strings, not Error objects. */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') return (error as { message: string }).message
  return fallback
}
