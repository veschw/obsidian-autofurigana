/// <reference lib="webworker" />

/**
 * Web Worker that hosts a Kuromoji tokenizer.
 *
 *
 * How dictionary files are loaded:
 *  - Kuromoji expects to fetch files from `dicPath`.
 *  - In Obsidian, the dictionary files live inside the vault (plugin folder)
 *    and are not on a regular server path.
 *  - This worker temporarily patches `XMLHttpRequest.prototype.open` to rewrite
 *    any request that starts with the sentinel prefix to the real vault URL
 *    provided by the main thread (`urlMap`). After the tokenizer is built,
 *    the patch is removed.
 *
 * Message protocol:
 *  - From main → worker:
 *      { type: 'init', urlMap, sentinel }
 *        → Build tokenizer using kuromoji.builder({ dicPath: sentinel }).
 *           The XHR patch replaces `${sentinel}/<filename>` with urlMap[filename].
 *
 *      { type: 'tokenize', id, text }
 *        → Tokenize immediately (if ready) and respond with same id.
 *
 *  - From worker → main:
 *      { type: 'init:ready' }
 *      { type: 'init:error', error }
 *      { type: 'tokenize:result', id, tokens }
 *      { type: 'tokenize:error', id, error }
 */

type UrlMap = Record<string, string>;
type InitMsg = { type: 'init'; urlMap: UrlMap; sentinel: string };
type TokenizeMsg = { type: 'tokenize'; id: number; text: string };

type ReadyMsg = { type: 'init:ready' };
type InitErrorMsg = { type: 'init:error'; error: string };
type TokResult = { type: 'tokenize:result'; id: number; tokens: any[] };
type TokError = { type: 'tokenize:error'; id: number; error: string };

let tokenizer: any = null

/**
 * Patch XMLHttpRequest.open to rewrite kuromoji dictionary requests.
 *
 * Requests are of the form: `${sentinel}/${file}` where `file` is one of the
 * ipadic data files (e.g., 'char.bin', 'matrix.bin', ...). If a matching file
 * exists in `urlMap`, the request is redirected to that URL (vault path served
 * by Obsidian). Non-matching requests pass through unchanged.
 *
 * Returns an `unpatch()` function that restores the original method.
 */
function patchXHR (urlMap: UrlMap, sentinel: string) {
  const origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string,
    async?: boolean,
    user?: string | null,
    password?: string | null
  ) {
    try {
      if (typeof url === 'string' && url.startsWith(sentinel + '/')) {
        const filename = url.slice(sentinel.length + 1)
        const mapped = urlMap[filename]
        if (mapped) url = mapped
      }
    } catch {
      /* noop */
    }
    // @ts-ignore
    return origOpen.call(this, method, url, async as any, user as any, password as any)
  }
  return () => {
    XMLHttpRequest.prototype.open = origOpen
  }
}

self.onmessage = async (ev: MessageEvent<InitMsg | TokenizeMsg>) => {
  const msg = ev.data

  if (msg.type === 'init') {
    try {
      (self as any).window = self

      // Dynamic import AFTER setting window; some bundlers evaluate env checks at import time.
      const kuromoji: any = await import(/* @vite-ignore */ 'kuromoji')

      const unpatch = patchXHR(msg.urlMap, msg.sentinel)
      kuromoji.builder({ dicPath: msg.sentinel }).build((err: any, built: any) => {
        unpatch()
        if (err) {
          (self as any).postMessage({ type: 'init:error', error: String(err?.message ?? err) } as InitErrorMsg)
          return
        }
        tokenizer = built;
        (self as any).postMessage({ type: 'init:ready' } as ReadyMsg)
      })
    } catch (e: any) {
      (self as any).postMessage({ type: 'init:error', error: String(e?.message ?? e) } as InitErrorMsg)
    }
    return
  }

  if (msg.type === 'tokenize') {
    const id = msg.id
    try {
      if (!tokenizer) throw new Error('Tokenizer not ready')
      const tokens = tokenizer.tokenize(msg.text);
      (self as any).postMessage({ type: 'tokenize:result', id, tokens } as TokResult)
    } catch (e: any) {
      (self as any).postMessage({ type: 'tokenize:error', id, error: String(e?.message ?? e) } as TokError)
    }
  }
}
