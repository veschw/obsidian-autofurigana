/**
 * Kuromoji Tokenizer Initialization for Obsidian.
 *
 * Purpose
 *  - Load Kuromoji dictionary files from the plugin's `dict/` folder inside the vault.
 *  - Temporarily patch `XMLHttpRequest.open` so Kuromoji's BrowserDictionaryLoader
 *    can fetch each dictionary file via Obsidian's `app://` resource URLs.
 *  - Expose a safe getter for the built tokenizer and a promise-based initializer.
 *
 * Exports
 *  - getTokenizer(): Tokenizer | null      // safe getter for current tokenizer (nullable)
 *  - tokenizer: Tokenizer | null           // direct reference (nullable)
 *  - initializeTokenizer(app, manifest): Promise<void>
 *
 * Usage
 *  - Call `await initializeTokenizer(app, manifest)` once (e.g., on plugin load)
 *    before calling `getTokenizer()` from other modules.
 */

import * as kuromoji from 'kuromoji'
import { Tokenizer, IpadicFeatures } from 'kuromoji'
import type { App, PluginManifest } from 'obsidian'

// Tokenizer instance is null until initialization completes.
export let tokenizer: Tokenizer<IpadicFeatures> | null = null

// Prevent concurrent builds (idempotent initializer).
let building = false

/** Safe getter for downstream code; returns null if not initialized yet. */
export function getTokenizer (): Tokenizer<IpadicFeatures> | null {
  return tokenizer
}

/**
 * The set of ipadic files the BrowserDictionaryLoader expects. These must
 * exist under the plugin's `dict/` directory, shipped with the plugin.
 */
const DICT_FILES = [
  'base.dat.gz',
  'cc.dat.gz',
  'check.dat.gz',
  'tid.dat.gz',
  'tid_map.dat.gz',
  'tid_pos.dat.gz',
  'unk.dat.gz',
  'unk_char.dat.gz',
  'unk_compat.dat.gz',
  'unk_invoke.dat.gz',
  'unk_map.dat.gz',
  'unk_pos.dat.gz'
] as const

/**
 * Kuromoji is configured with a `dicPath`. The loader requests files like
 * `${dicPath}/base.dat.gz`. We point `dicPath` to this sentinel string and
 * patch XHR so that any URL starting with `${SENTINEL}/...` is rewritten to
 * an Obsidian `app://` URL for the corresponding file.
 */
const SENTINEL = '__KUROMOJI_DICT__'

/**
 * Build a mapping from dictionary filenames to Obsidian resource URLs.
 * Example:
 *   'base.dat.gz' → 'app://obsidian.md/.../plugins/<id>/dict/base.dat.gz'
 *
 * Throws if a file cannot be resolved, since kuromoji will fail later anyway.
 */
function buildUrlMap (app: App, manifest: PluginManifest): Record<string, string> {
  // Resolve the plugin's dict folder relative to the vault root.
  const configDir = (app.vault as any).configDir ?? '.obsidian'
  const baseRel = `${configDir}/plugins/${manifest.id}/dict/`.replace(/\\/g, '/')
  const adapter: any = app.vault.adapter

  const map: Record<string, string> = {}
  for (const name of DICT_FILES) {
    const rel = baseRel + name
    const url = adapter.getResourcePath(rel) // Obsidian-provided app:// URL
    if (!url) throw new Error(`Cannot resolve dictionary file: ${rel}`)
    map[name] = url
  }
  return map
}

/**
 * Initialize the global `tokenizer`.
 *
 * Properties:
 *  - Idempotent: returns immediately if already initialized; queues if a build
 *    is in progress, with a small poll loop and a safety timeout.
 *  - Restores the original XHR.open after build completes or on error.
 */
export const initializeTokenizer = (app: App, manifest: PluginManifest): Promise<void> =>
  new Promise((resolve, reject) => {
    // Already built → nothing to do.
    if (tokenizer) { resolve(); return }

    // A build is in progress → wait for completion (or timeout).
    if (building) {
      const iv = setInterval(() => {
        if (tokenizer) { clearInterval(iv); resolve() }
      }, 25)
      setTimeout(() => {
        if (!tokenizer) { clearInterval(iv); reject(new Error('Tokenizer init timeout')) }
      }, 10000)
      return
    }

    building = true
    let unpatch: (() => void) | null = null

    try {
      const urlMap = buildUrlMap(app, manifest)

      /**
       * Patch XHR.open so Kuromoji can fetch `${SENTINEL}/<file>` and actually
       * read from the correct `app://` URL for `<file>`.
       *
       * Notes:
       *  - Only rewrites URLs when they start with the sentinel.
       *  - Other requests pass through unchanged.
       *  - The patch is reverted immediately after the builder callback fires.
       */
      const origOpen = XMLHttpRequest.prototype.open
      XMLHttpRequest.prototype.open = function (
        method: string,
        url: string,
        async?: boolean,
        user?: string | null,
        password?: string | null
      ) {
        try {
          if (typeof url === 'string' && url.startsWith(SENTINEL)) {
            // Extract "<file>" from "<SENTINEL>/<file>"
            const file = url.slice(SENTINEL.length + 1)
            const mapped = urlMap[file]
            if (mapped) {
              // Rewrite to the vault resource URL.
              url = mapped
            }
          }
        } catch {
          // If anything goes wrong, fall back to the original URL.
        }
        // Call through with preserved `this`.
        // @ts-ignore
        return origOpen.call(this, method, url, async as any, user as any, password as any)
      }
      unpatch = () => { XMLHttpRequest.prototype.open = origOpen }

      // Build the tokenizer. Kuromoji will XHR the dict files using the patched URLs.
      kuromoji.builder({ dicPath: SENTINEL }).build((err, built) => {
        unpatch?.()
        building = false
        if (err) {
          console.error('Error initializing tokenizer:', err)
          reject(err)
          return
        }
        tokenizer = built!
        resolve()
      })
    } catch (e) {
      // Clean up state and restore XHR on synchronous failures too.
      unpatch?.()
      building = false
      reject(e)
    }
  })
