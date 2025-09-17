/**
 * Live Preview layer that renders Japanese text with per-chunk <ruby>.
 *
 * Responsibilities
 *  - Provide a CodeMirror ViewPlugin that scans visible ranges and replaces matched
 *    text with a widget that renders <rb>/<rt> pairs.
 *  - Honor inline manual overrides like {漢字|かん|じ} or [漢字|かん|じ].
 *  - Apply automatic segmentation everywhere else (outside code blocks/backticks).
 *  - Avoid interfering with active edits (skip decorations intersecting selections).
 *
 * Notes
 *  - Decorations use Decoration.replace with a Widget, not addMark, so the underlying
 *    source stays clean while the user edits in Live Preview.
 *  - Sorting of decorations is required before building the RangeSet; order is by
 *    ascending `from`, then `to`.
 */

import { RangeSetBuilder } from '@codemirror/state'
import { ViewPlugin, WidgetType, EditorView, ViewUpdate, Decoration, DecorationSet } from '@codemirror/view'
import { getFuriganaSegmentsSync } from './furiganaUtils'
import { NotationStyle, getAutoRegex, getManualRegex } from './regex'

/** Broad kanji detector; sufficient for deciding whether to attach an <rt>. */
const HAS_KANJI = /[一-鿿豈-﫿]/

/**
 * Widget that renders a sequence of base chunks and their readings.
 * Each pair aligns index-wise across `kanji[]` and `furi[]`.
 */
class RubyWidget extends WidgetType {
  constructor (readonly kanji: string[], readonly furi: string[]) {
    super()
  }

  toDOM (_view: EditorView): HTMLElement {
    // Return a container so we can interleave plain text and per-core <ruby>.
    const container = document.createElement('span')

    // Matches hiragana/katakana/prolonged sound mark
    const KANA_LEAD = /^[぀-ゟ゠-ヿー]+/
    const KANA_TAIL = /[぀-ゟ゠-ヿー]+$/

    for (let i = 0; i < this.kanji.length; i++) {
      const base = this.kanji[i] ?? ''
      const reading = this.furi[i] ?? ''

      if (!base) continue

      // If there is no kanji at all, just emit the text.
      if (!HAS_KANJI.test(base)) {
        container.appendChild(document.createTextNode(base))
        continue
      }

      // Split off leading/trailing kana (e.g., honorific お-/ご- or okurigana)
      const leadMatch = base.match(KANA_LEAD)
      const tailMatch = base.match(KANA_TAIL)
      const lead = leadMatch ? leadMatch[0] : ''
      const tail = tailMatch ? tailMatch[0] : ''

      const core = base.slice(lead.length, base.length - tail.length)

      // Emit the leading kana as plain text (no ruby)
      if (lead) container.appendChild(document.createTextNode(lead))

      if (core) {
        // Trim matching prefix/suffix from the reading so the <rt> covers only the kanji core.
        // (Heuristic: only strip when it literally matches, which is correct for normal okurigana/honorifics.)
        let rtText = reading
        if (lead && rtText.startsWith(lead)) rtText = rtText.slice(lead.length)
        if (tail && rtText.endsWith(tail)) rtText = rtText.slice(0, rtText.length - tail.length)
        if (!rtText) rtText = reading // fallback if upstream readings are atypical

        const ruby = document.createElement('ruby')
        ruby.classList.add('furi')

        ruby.appendChild(document.createTextNode(core))

        const rt = document.createElement('rt')
        rt.textContent = rtText
        ruby.appendChild(rt)

        container.appendChild(ruby)
      }

      // Emit trailing kana as plain text
      if (tail) container.appendChild(document.createTextNode(tail))
    }

    return container
  }

  // Events should bubble into the editor normally (cursor movement, etc.)
  ignoreEvent (): boolean {
    return false
  }
}

/** Simple half-open interval overlap check used to skip decorations in selections. */
function rangesOverlap (aFrom: number, aTo: number, bFrom: number, bTo: number) {
  return aFrom < bTo && bFrom < aTo
}

/**
 * Find inline backtick code spans on a single line.
 * Returns [from, to) offsets relative to the line start.
 */
function inlineBacktickRanges (lineText: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let i = 0; let open: number | null = null
  while (i < lineText.length) {
    if (lineText[i] === '`') {
      if (open === null) open = i
      else { ranges.push([open, i + 1]); open = null }
    }
    i++
  }
  return ranges
}

/**
 * Factory: create a ViewPlugin bound to the chosen manual-notation style.
 *
 * Triggers for rebuild:
 *  - Document changes
 *  - Viewport changes (scrolling)
 *  - Selection changes (to avoid covering actively edited regions)
 */
export const viewPlugin = (style: NotationStyle) => {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor (view: EditorView) {
        this.decorations = this.buildDecorations(view)
      }

      update (update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.buildDecorations(update.view)
        }
      }

      buildDecorations (view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>()
        const selections = view.state.selection.ranges

        // Track fenced code blocks using a simple "```" line toggle.
        // This intentionally avoids scanning inside code fences.
        let insideFence = false

        for (const vr of view.visibleRanges) {
          const first = view.state.doc.lineAt(vr.from).number
          const last = view.state.doc.lineAt(vr.to).number

          for (let n = first; n <= last; n++) {
            const line = view.state.doc.line(n)
            const text = line.text

            const trimmed = text.trim()
            if (trimmed.startsWith('```')) {
              insideFence = !insideFence
            }
            if (insideFence) continue

            // Collect all decorations for this line here:
            const toAdd: Array<{from:number; to:number; dec:Decoration}> = []

            /* --------- Manual overrides --------- */
            const manualMatches = Array.from(text.matchAll(getManualRegex(style)))
            const manualRanges: Array<[number, number]> = []

            for (const m of manualMatches) {
              const from = (m.index ?? 0) + line.from
              const to = from + m[0].length

              manualRanges.push([from, to])

              // Skip if user is editing this span
              if (selections.some(r => rangesOverlap(r.from, r.to, from, to))) continue

              // Group 1 = base, Group 2 = entire '|reading' tail (e.g., "|かん|じ")
              const parts = (m[2] ?? '').split('|').slice(1)
              const kanji = parts.length === 1 ? [m[1]] : m[1].split('')
              const furi = parts

              toAdd.push({
                from,
                to,
                dec: Decoration.replace({ widget: new RubyWidget(kanji, furi), inclusive: false })
              })
            }

            /* --------- Automatic furigana --------- */
            const auto = getAutoRegex()
            for (const a of text.matchAll(auto)) {
              const localFrom = a.index ?? 0
              const localTo = localFrom + a[0].length
              const from = localFrom + line.from
              const to = localTo + line.from
              const span = a[0]

              // Skip if editing
              if (selections.some(r => rangesOverlap(r.from, r.to, from, to))) continue
              // Skip if already covered by a manual override
              if (manualRanges.some(([f, t]) => rangesOverlap(f, t, from, to))) continue
              // Skip if inside inline backtick code
              if (inlineBacktickRanges(text).some(([f, t]) =>
                rangesOverlap(f + line.from, t + line.from, from, to))) continue

              const segs = getFuriganaSegmentsSync(span)
              if (!segs?.length) continue
              const { kanji, furi } = segs[0]
              if (!kanji.length) continue

              toAdd.push({
                from,
                to,
                dec: Decoration.replace({ widget: new RubyWidget(kanji, furi), inclusive: false })
              })
            }

            // IMPORTANT: add in ascending order by `from`, then by `to`
            toAdd.sort((a, b) => (a.from - b.from) || (a.to - b.to))
            for (const { from, to, dec } of toAdd) builder.add(from, to, dec)
          }
        }

        return builder.finish()
      }
    },
    { decorations: (v) => v.decorations }
  )
}
