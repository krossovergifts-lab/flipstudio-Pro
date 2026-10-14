export interface FlipPresetInfo { label: string; time: number; shadow: number; cover: 'soft' | 'hard'; corners: boolean }
export const FLIP_PRESETS: Record<'smooth' | 'magazine' | 'hardcover' | 'quick', FlipPresetInfo>
export const SOUND_PRESETS: Record<'none' | 'paper' | 'soft' | 'crisp' | 'custom', string>
export function flipSettings(reader?: Record<string, unknown>): { time: number; shadow: number; cover: 'soft' | 'hard'; corners: boolean }
export function themeVariables(reader?: Record<string, unknown>): Record<string, string>
export function themeBaseColor(reader?: Record<string, unknown>): string
export interface FlipSound { readonly enabled: boolean; readonly muted: boolean; setMuted(muted: boolean): void; play(): void; unlock(): void; destroy(): void }
export function createFlipSound(win: Window, kind: string, customUrl?: string): FlipSound
