// kuromojiDictInstaller.ts
/**
 * One-time installer for the Kuromoji ipadic dictionary files.
 *
 * What this does
 *  - Determines the plugin's `dict/` folder inside the vault (e.g., `.obsidian/plugins/<id>/dict/`).
 *  - Verifies presence and integrity (SHA-256 + byte size) of each required file.
 *  - If missing or corrupted, downloads from a set of upstream URLs (first source to succeed wins).
 *  - Writes files using Obsidian's adapter and shows lightweight progress notices.
 *  - Checking both file size and SHA-256 guards against partial/cached downloads.
 */

import { App, Notice, requestUrl } from 'obsidian'
import type { PluginManifest } from 'obsidian'
import dictManifest from './dict.manifest.json'

/** Map of filename → expected SHA-256 (hex) and byte length. */
type DictManifest = Record<string, { sha256: string; bytes: number }>

/** Repository hosting the packaged dict assets. */
const OWNER = 'veschw'
const REPO = 'obsidian-autofurigana'
/** Tag that contains the `dict/` assets. */
const TAG = 'v0.1.0' // plugin release tag that will host dict assets

/**
 * Candidate sources for downloads. Order matters: the first that responds 200
 * is used. Keep the fastest/CDN option near the top.
 */
const SOURCE_URLS: Array<(name: string) => string> = [
  // GitHub Release assets (preferred canonical source)
  (name) => `https://github.com/${OWNER}/${REPO}/releases/download/${TAG}/dict/${encodeURIComponent(name)}`,
  // jsDelivr (CDN mirror of the repo tag)
  (name) => `https://cdn.jsdelivr.net/gh/${OWNER}/${REPO}@${TAG}/dict/${encodeURIComponent(name)}`
]

/* ------------------------------------------------------------------ *
 *                           Helpers
 * ------------------------------------------------------------------ */

/** Compute SHA-256 of an ArrayBuffer, returned as lowercase hex. */
async function sha256Hex (buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  const bytes = new Uint8Array(hash)
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i].toString(16).padStart(2, '0')
    out += b
  }
  return out
}

/**
 * Try each source URL until one succeeds. Returns the downloaded bytes.
 * Throws if all sources fail.
 */
async function fetchWithFallback (name: string): Promise<ArrayBuffer> {
  let lastErr: unknown = null
  for (const makeUrl of SOURCE_URLS) {
    const url = makeUrl(name)
    try {
      const resp = await requestUrl({ url, method: 'GET', throw: true })
      return resp.arrayBuffer
    } catch (e) {
      lastErr = e
      // Try next source
    }
  }
  throw new Error(`Failed to download ${name} from all sources: ${String((lastErr as any)?.message ?? lastErr)}`)
}

/** Resolve the plugin-relative dict folder (vault-relative path). */
function getDictBaseRel (app: App, manifest: PluginManifest): string {
  const configDir = (app.vault as any).configDir ?? '.obsidian'
  // Normalize separators to forward slashes for adapter paths.
  return `${configDir}/plugins/${manifest.id}/dict`.replace(/\\/g, '/')
}

/** Ensure the dict directory exists. Safe to call repeatedly. */
async function ensureDictDir (app: App, manifest: PluginManifest): Promise<string> {
  const baseRel = getDictBaseRel(app, manifest)
  const adapter: any = app.vault.adapter
  if (!(await adapter.exists(baseRel))) {
    await adapter.mkdir(baseRel)
  }
  return baseRel
}

/**
 * Check if a given file already present on disk matches the expected size/hash.
 * Returns true when both match; false on any mismatch or read error.
 */
async function isFileValid (
  adapter: any,
  relPath: string,
  want: { sha256: string; bytes: number }
): Promise<boolean> {
  try {
    const stat = await adapter.stat(relPath)
    if (!stat || typeof stat.size !== 'number' || stat.size !== want.bytes) return false
    // Size matches; verify hash too.
    const buf: ArrayBuffer = await adapter.readBinary(relPath)
    if (!buf || buf.byteLength !== want.bytes) return false
    const gotSha = await sha256Hex(buf)
    return gotSha === want.sha256
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 *                       Public API (installer)
 * ------------------------------------------------------------------ */

/**
 * Ensure all ipadic dictionary files are present and correct in the vault.
 *
 * This function:
 *  1) Creates the dict folder if missing.
 *  2) For each file listed in dict.manifest.json:
 *      - If an on-disk file matches size+SHA, it is kept.
 *      - Otherwise downloads from the fastest available source,
 *        validates size+SHA, then writes to disk.
 *  3) Shows a brief notice while installing multiple files.
 *
 * Throws on checksum/size mismatches or if all downloads fail.
 */
export async function ensureDictInstalled (app: App, manifest: PluginManifest): Promise<void> {
  const adapter: any = app.vault.adapter
  const baseRel = await ensureDictDir(app, manifest)

  const manifestMap = dictManifest as unknown as DictManifest
  const names = Object.keys(manifestMap)

  let installed = 0
  for (const name of names) {
    const want = manifestMap[name]
    const rel = `${baseRel}/${name}`

    // Already valid? Skip.
    const ok = await isFileValid(adapter, rel, want)

    if (!ok) {
      // Download → validate → write
      const data = await fetchWithFallback(name)
      const gotSha = await sha256Hex(data)
      if (gotSha !== want.sha256) throw new Error(`Checksum mismatch for ${name}`)
      if (data.byteLength !== want.bytes) throw new Error(`Size mismatch for ${name}`)
      await adapter.writeBinary(rel, data)

      installed++
      // Progress toast, short-lived to avoid clutter.
      // eslint-disable-next-line no-new
      new Notice(`Installing Kuromoji dict… ${installed}/${names.length}`, 2000)
    }
  }
}
