// Thin DOM/Clipboard helpers used by the ExportPopover. Kept out of
// `lib/api.ts` because they touch globals (navigator, document) and are
// easier to stub from component tests when they live in their own file.

/**
 * Copy text to the system clipboard. Prefers the modern async Clipboard
 * API; falls back to a hidden textarea + execCommand('copy') for older
 * browsers and contexts where navigator.clipboard is unavailable (e.g.
 * non-secure-origin local-network setups).
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to the legacy path. Some browsers reject
      // clipboard.writeText when the document is not focused; the
      // execCommand fallback usually still works under a user gesture.
    }
  }
  legacyCopyViaTextarea(text)
}

function legacyCopyViaTextarea(text: string): void {
  if (typeof document === 'undefined') {
    throw new Error('clipboard: no document available')
  }
  const ta = document.createElement('textarea')
  ta.value = text
  // Keep it off-screen but not display:none — execCommand requires the
  // element to be part of the layout to read its selection.
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '-9999px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    ta.remove()
  }
  if (!ok) throw new Error('clipboard: execCommand(copy) failed')
}

/**
 * Trigger a browser download of the given text under `filename`. Uses an
 * in-memory Blob so nothing hits the network and there's no server
 * round-trip. Revokes the object URL on the next microtask.
 */
export function downloadTextFile(filename: string, mime: string, text: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('download: no document/URL available')
  }
  const blob = new Blob([text], { type: mime })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  // Some browsers (Safari) require the anchor to be in the document for
  // the synthetic click to dispatch the download.
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a tick to start the download before we revoke.
  setTimeout(() => URL.revokeObjectURL(href), 0)
}
