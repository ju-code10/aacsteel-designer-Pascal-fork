// §6.6 — download trigger shared by every exporter.
//
// The setTimeout-revoke quirk: Safari cancels the download if the object
// URL is revoked synchronously after the click. A 1-second delay is the
// established workaround and is enough for every browser we target.
export function triggerDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') {
    throw new Error('triggerDownload requires a DOM (browser/SSR boundary)')
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
