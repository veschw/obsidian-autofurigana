/**
 * Regex helpers shared by both Reading Mode and Live Preview.
 * *
 * Manual notation (two supported styles):
 *   - Curly:  {漢字|かん|じ}
 *   - Square: [漢字|かん|じ]
 *
 * Capture groups for manual overrides (kept stable for downstream code):
 *   1. base       → the base text (kanji/kana string between the brackets, up to the first '|')
 *   2. readings   → the entire tail including the leading pipe, e.g. "|かん|じ"
 */

export type NotationStyle = 'curly' | 'square' | 'none'

/**
 * Broad Japanese span detector (Hiragana, Katakana, CJK Unified Ideographs,
 * and the prolonged sound mark 'ー').
 */
const REGEX_AUTOMATIC = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFFー]+/g

/**
 * Build a global regex for curly-brace manual overrides:
 *   {<base><|reading>+}
 *
 * Captures:
 *   (1) <base>
 *   (2) <|reading>+
 *
 * The base excludes '{', '}', '|', and raw newlines to avoid runaway matches.
 * Each reading segment excludes bracket chars, pipes, and newlines.
 */
function makeCurlyManualRegex (): RegExp {
  // { base (no {|} or newline)  (  |reading (no {|} or newline) )+ }
  return /\{([^{}\|\r\n]+)((?:\|[^{}\|\r\n]+)+)\}/g
}

/**
 * Build a global regex for square-bracket manual overrides:
 *   [<base><|reading>+]
 *
 * Same capture semantics as curly.
 */
function makeSquareManualRegex (): RegExp {
  // [ base (no [|] or newline)  (  |reading (no [|] or newline) )+ ]
  return /\[([^\[\]\|\r\n]+)((?:\|[^\[\]\|\r\n]+)+)\]/g
}

/**
 * Return the manual-override regex for the selected notation style.
 * For 'none', return a regex that never matches (keeps calling code simple).
 *
 * The returned regex MUST:
 *  - be global (g)
 *  - expose capture group 1 = base, group 2 = entire '|reading' tail
 */
export function getManualRegex (style: NotationStyle): RegExp {
  switch (style) {
    case 'curly':
      return makeCurlyManualRegex()
    case 'square':
      return makeSquareManualRegex()
    case 'none':
    default:
      // Use an always-false pattern to express "disabled"
      return /a^/
  }
}

/**
 * Return the broad automatic-coverage regex for Japanese spans.
 * Provided as a function to match the shape of the manual getter.
 */
export function getAutoRegex (): RegExp {
  return REGEX_AUTOMATIC
}
