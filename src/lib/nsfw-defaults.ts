import type { MediaType, QualityTier, Style } from './types'

/** App is NSFW-only; these are the defaults on first visit and reset targets. */
export const NSFW_DEFAULTS = {
  style: 'hentai' as Style,
  aspectRatio: '9:16',
  qualityTier: 'high' as QualityTier,
  mediaType: 'image' as MediaType,
  prompt: '',
} as const

export const PREFS_STORAGE_KEY = 'runninghub-nsfw-prefs-v1'

export type StoredPrefs = {
  style: Style
  aspectRatio: string
  qualityTier: QualityTier
  mediaType: MediaType
  prompt: string
}

export function loadStoredPrefs(): Partial<StoredPrefs> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<StoredPrefs>
  } catch {
    return null
  }
}

export function saveStoredPrefs(prefs: StoredPrefs): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* quota / private mode */
  }
}

export function mergePrefs(stored: Partial<StoredPrefs> | null): StoredPrefs {
  return {
    style: stored?.style ?? NSFW_DEFAULTS.style,
    aspectRatio: stored?.aspectRatio ?? NSFW_DEFAULTS.aspectRatio,
    qualityTier: stored?.qualityTier ?? NSFW_DEFAULTS.qualityTier,
    mediaType: stored?.mediaType === 'video' ? 'video' : NSFW_DEFAULTS.mediaType,
    prompt: typeof stored?.prompt === 'string' ? stored.prompt : NSFW_DEFAULTS.prompt,
  }
}
