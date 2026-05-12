// §7.6.1 — platform detection. Single source of truth for "which modifier
// key is the primary one" so every shortcut surface (the shortcut binder,
// the tooltip rendering, the ShortcutsPanel) renders the same label.

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform =
    nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? ''
  return /Mac|iPad|iPhone|iPod/i.test(platform)
}

export const IS_MAC = detectMac()

export const PRIMARY_MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'
