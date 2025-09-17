// furiganaReadingMode.ts
/**
 * Reading Mode postprocessor for rendering Japanese text with <ruby>.
 *
 * Responsibilities
 *  - Register a Markdown postprocessor that runs on rendered Markdown (Reading Mode).
 *  - Inside common text containers (paragraphs, headings, lists, tables), walk the DOM,
 *    find Text nodes, and replace them with a fragment produced by `convertFurigana`.
 *  - Support inline manual overrides ({漢字|かん|じ} or [漢字|…]) and apply automatic
 *    segmentation to remaining Japanese spans.
 *
 * Design notes
 *  - Only scans a conservative set of elements (TAGS) to avoid touching code blocks,
 *    callouts’ chrome, or other non-content UI. Code/pre are not included.
 *  - Skips nodes already inside a <ruby> to avoid nesting.
 *  - Uses a fresh regex instance inside `convertFurigana`, so `lastIndex` sharing
 *    is not a concern here.
 *  - The postprocessor is cheap when no Japanese text is present; `convertFurigana`
 *    quickly returns the original Text node when nothing matches.
 */

import { MarkdownPostProcessor, MarkdownPostProcessorContext } from 'obsidian'

import type { PluginSettings } from './settings'
import { convertFurigana } from './furiganaUtils'
import { getAutoRegex, getManualRegex } from './regex'

/**
 * Elements to scan inside rendered Markdown.
 * Kept narrow to avoid styling chrome and code blocks:
 *  - paragraphs, headings, lists, and tables (including cell content).
 */
const TAGS = 'p, h1, h2, h3, h4, h5, h6, ol, ul, table'

/** Quick predicate for elements we never traverse into. */
function isSkippableElement (el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  // Skip code/pre/math/script/style and existing ruby.
  return tag === 'code' || tag === 'pre' || tag === 'script' || tag === 'style' || tag === 'ruby'
}

/**
 * Collect direct and nested Text nodes under `root`, excluding skippable subtrees.
 * This avoids touching attributes and keeps traversal simple and predictable.
 */
function collectTextNodes (root: Node, out: Text[]): void {
  const nodeType = root.nodeType
  if (nodeType === Node.TEXT_NODE) {
    // Ignore pure whitespace nodes; they render the same and add churn if replaced.
    if ((root.nodeValue ?? '').trim().length > 0) out.push(root as Text)
    return
  }
  if (nodeType !== Node.ELEMENT_NODE) return

  const el = root as Element
  if (isSkippableElement(el)) return

  // Do not process inside existing <ruby>; nested ruby is invalid.
  if (el.closest('ruby')) return

  for (let i = 0; i < el.childNodes.length; i++) {
    collectTextNodes(el.childNodes[i], out)
  }
}

/**
 * Factory for the Markdown postprocessor used in Reading Mode.
 * Using a getter keeps the latest settings without re-registering the postprocessor.
 */
export function createReadingModePostprocessor (
  getSettings: () => PluginSettings
): MarkdownPostProcessor {
  return async (el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
    const settings = getSettings()
    if (!settings.readingMode) return

    // Query only the content-bearing containers.
    const blocks = el.querySelectorAll<HTMLElement>(TAGS)
    if (blocks.length === 0) return

    // Pre-create the auto regex; a fresh instance will be created inside convertFurigana,
    // but this cheap test lets us short-circuit entire blocks early.
    const autoQuick = getAutoRegex()
    // For quick tests, use a non-global clone to avoid lastIndex effects here.
    const quick = new RegExp(autoQuick.source)

    const manualRe = getManualRegex(settings.notationStyle)
    const autoRe = getAutoRegex()

    const processBlock = async (blk: HTMLElement) => {
      // Early exit if this block has no Japanese code points at all.
      if (!quick.test(blk.textContent ?? '')) return

      const textNodes: Text[] = []
      collectTextNodes(blk, textNodes)
      if (textNodes.length === 0) return

      // Replace each Text node with the converted fragment.
      // Replacement is safe as convertFurigana returns a Node (Text or Fragment).
      await Promise.all(
        textNodes.map(async (tn) => {
          const replacement = await convertFurigana(tn, manualRe, autoRe)
          if (replacement !== tn) tn.replaceWith(replacement)
        })
      )
    }

    // Walk all selected containers.
    for (const blk of Array.from(blocks)) {
      await processBlock(blk)
    }
  }
}
