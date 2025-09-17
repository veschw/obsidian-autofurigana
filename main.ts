/**
 * Automatic Furigana Generator for Obsidian.
 *
 * Entry point that wires together:
 *  - Settings (UI + persistence)
 *  - Kuromoji dictionary installation (one-time, cached in the vault)
 *  - Kuromoji tokenizer initialization (patched XHR → reads dict from vault)
 *  - Reading Mode postprocessor (DOM-based ruby rendering)
 *  - Live Preview extension (CodeMirror 6 widget-based ruby rendering)
 *
 * Design notes
 *  - Reading Mode and Live Preview can be toggled independently in settings.
 *  - Manual override notation style is forwarded to both renderers.
 *  - Live Preview uses a CodeMirror Compartment so the extension can be
 *    reconfigured instantly (e.g., style changes) without reopening the file.
 */

import { Plugin } from 'obsidian'

import { Compartment, Extension } from '@codemirror/state'

import { DEFAULT_SETTINGS, type PluginSettings, MyPluginSettingTab } from './settings'
import { ensureDictInstalled } from './kuromojiDictInstaller'
import { initializeTokenizer } from './kuromojiInit'
import { viewPlugin } from './furiganaLivePreviewMode'
import { createReadingModePostprocessor } from './furiganaReadingMode'

/* ------------------------------------------------------------------ *
 * The main plugin class
 * ------------------------------------------------------------------ */

export default class AutoFurigana extends Plugin {
  settings: PluginSettings

  // Compartment to allow live reconfiguration of the Live Preview extension
  private lpCompartment = new Compartment()
  public postprocessor = createReadingModePostprocessor(() => this.settings)
  async loadSettings () {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  // Apply a partial patch, persist, then react exactly once
  async saveSettings (patch: Partial<PluginSettings>) {
    const prev = this.settings
    const next = this.settings = { ...this.settings, ...patch }
    await this.saveData(this.settings)
    this.applySettingsChange(prev, next)
  }

  // React to a settings change by reconfiguring affected features
  private applySettingsChange (prev: PluginSettings, next: PluginSettings) {
    // Live Preview: reconfigure CM6 extension (enable/disable and/or change style)
    const ext: Extension = next.editingMode ? viewPlugin(next.notationStyle) : []
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = (leaf as any).view
      const cm = view?.editor?.cm
      if (cm?.dispatch) {
        cm.dispatch({ effects: this.lpCompartment.reconfigure(ext) })
      }
    })

    // Reading Mode: refresh if toggle or style changed
    if (prev.readingMode !== next.readingMode || prev.notationStyle !== next.notationStyle) {
      this.refreshAllReadingViews()
    }
  }

  // Refresh all Reading Mode views by forcing a re-render
  private refreshAllReadingViews () {
    this.app.workspace.getLeavesOfType('markdown').forEach((leaf: any) => {
      if (leaf.view?.getMode?.() === 'preview') {
        if (leaf.view.previewMode?.rerender) {
          leaf.view.previewMode.rerender(true)
        } else if (leaf.rebuildView) {
          leaf.rebuildView()
        }
      }
    })
  }

  private reconfigureLivePreview (next: PluginSettings) {
    const ext: Extension = next.editingMode
      ? viewPlugin(next.notationStyle)
      : []

    // Walk every open markdown editor and dispatch the reconfigure effect.
    this.app.workspace.iterateAllLeaves(leaf => {
    // @ts-ignore - Obsidian's MarkdownView type
      const mdView = leaf.view && leaf.view.getViewType && leaf.view.getViewType() === 'markdown' ? leaf.view : null
      // @ts-ignore - editor.cm is CodeMirror6 EditorView
      const cm = mdView?.editor?.cm
      if (cm) cm.dispatch({ effects: this.lpCompartment.reconfigure(ext) })
    })
  }

  async onload () {
  // Load persisted settings
    await this.loadSettings()

    // Ensure resources needed for auto-furigana are ready
    await ensureDictInstalled(this.app, this.manifest)
    // spins up the worker and waits for 'ready', without long tasks on main thread.
    await initializeTokenizer(this.app, this.manifest)

    // Settings UI registered in the sidebar.
    // Exposes toggles for Reading Mode, Live Preview, and the override notation style.
    this.addSettingTab(new MyPluginSettingTab(this.app, this))

    // Reading Mode processor registration.
    // The postprocessor is constructed with a getter so it always sees the latest settings.
    this.registerMarkdownPostProcessor(this.postprocessor)

    // Install a Compartment so notation style or enable/disable switches can
    // reconfigure the extension on the fly without reopening the editor.
    const initialExt: Extension = this.settings.editingMode
      ? viewPlugin(this.settings.notationStyle)
      : []
    this.registerEditorExtension(this.lpCompartment.of(initialExt))
  }

  onunload () {}
}
