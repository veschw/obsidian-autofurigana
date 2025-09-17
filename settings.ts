/**
 * Settings UI and persisted state for the Automatic Furigana plugin.
 *
 * Responsibilities
 *  - Define the persisted settings shape and defaults.
 *  - Render a settings tab in Obsidian’s sidebar.
 *  - Persist updates and notify the plugin so it can reconfigure renderers.
 *
 * Notes
 *  - Manual override notation controls how inline overrides like {漢字|かん|じ}
 *    or [漢字|かん|じ] are interpreted. This does not affect automatic furigana.
 */

import { App, PluginSettingTab, Setting } from 'obsidian'
import type AutoFurigana from './main'

/** Persisted settings (saved under the plugin’s ID). */
export interface PluginSettings {
  /** Render furigana in the editor using widgets. */
  editingMode: boolean;
  /** Render furigana in Reading Mode using a postprocessor. */
  readingMode: boolean;
  /**
   * Notation used for inline manual overrides within the note text.
   *  - 'curly'  → {漢字|かん|じ}
   *  - 'square' → [漢字|かん|じ]
   *  - 'none'   → disable parsing of manual overrides
   */
  notationStyle: 'curly' | 'square' | 'none'
}

/** Defaults applied on first run or when new keys are added. */
export const DEFAULT_SETTINGS: PluginSettings = {
  editingMode: true,
  readingMode: true,
  notationStyle: 'curly'
}

/**
 * Settings tab shown under Settings → Community Plugins → <this plugin>.
 * The tab writes changes immediately and lets the main plugin react.
 */
export class MyPluginSettingTab extends PluginSettingTab {
  constructor (app: App, private readonly plugin: AutoFurigana) {
    super(app, plugin)
  }

  display (): void {
    const { containerEl } = this
    containerEl.empty()

    /* ---------------------- Header ---------------------- */
    containerEl.createEl('h2', { text: 'Automatic Furigana' })
    containerEl.createEl('p', {
      text:
        'Configure where furigana is rendered and how inline overrides are written.'
    })

    /* ----------------- Live Preview (editor) ----------------- */
    new Setting(containerEl)
      .setName('Live Preview (editor)')
      .setDesc(
        'Render furigana while editing. The editor uses non-destructive widgets; ' +
        'the underlying Markdown is not modified.'
      )
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.editingMode)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ editingMode: value })
          })
      )

    /* ------------------- Reading Mode (view) ------------------- */
    new Setting(containerEl)
      .setName('Reading Mode (rendered Markdown)')
      .setDesc(
        'Render furigana in Reading Mode using a Markdown postprocessor. ' +
        'Source text remains unchanged.'
      )
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.readingMode)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ readingMode: value })
          })
      )

    /* ---------------- Manual override notation ---------------- */
    new Setting(containerEl)
      .setName('Manual override notation')
      .setDesc(
        'Choose how inline overrides are written in notes. Examples: ' +
        '{漢字|かん|じ} (curly), [漢字|かん|じ] (square). ' +
        'Set to “Disabled” to ignore overrides and use only automatic furigana.'
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption('curly', 'Curly braces — {漢字|かん|じ}')
          .addOption('square', 'Square brackets — [漢字|かん|じ]')
          .addOption('none', 'Disabled (no manual overrides)')
          .setValue(this.plugin.settings.notationStyle)
          .onChange(async (value) => {
            await this.plugin.saveSettings({
              notationStyle: value as PluginSettings['notationStyle']
            })
          })
      })

    /* ------------------------- Tips ------------------------- */
    const tips = containerEl.createEl('div', { cls: 'setting-item-description' })
    tips.createEl('p', {
      text:
        'For multi-character bases, separate readings with “|”, e.g., {漢字|かん|じ}. ' +
        'For a single reading across the whole base, use one segment, e.g., {今日|きょう}.'
    })
  }
}
