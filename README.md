# Markdown Furigana Plugin (Obsidian)

Obsidian plugin for displaying Japanese text with [furigana](https://en.wikipedia.org/wiki/Furigana).

This plugin is based on the [Markdown Furigana Plugin by Steven Kraft](https://github.com/steven-kraft/obsidian-markdown-furigana). Unlike the current version of that plugin, this fork is **limited to Japanese**.

The plugin uses [kuromoji.js](https://github.com/takuyaa/kuromoji.js) for morphological analysis and [wanakana](https://github.com/WaniKani/WanaKana) for kana conversion. The required kuromoji dictionaries are downloaded once after installing the plugin.

### Features

* Automatically displays furigana for Japanese text in reading mode.
* Supports manual furigana markup in editing mode using markdown syntax.
* If manual markup is present, it takes precedence over automatically generated furigana.
* Limited to Japanese text (unlike the original plugin which added support for multiple languages).

### Examples

| Markdown    | Processed As                           | Displays As                          |
| ----------- | -------------------------------------- | ------------------------------------ |
| {漢字\|かんじ}   | `<ruby>漢字<rt>かんじ</rt></ruby>`          | <ruby>漢字<rt>かんじ</rt></ruby>          |
| {漢字\|かん\|じ} | `<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>` | <ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby> |

When no manual markup is provided, furigana will be added automatically in reading mode using morphological analysis.

### Notes

* The first section of manual markup should be Kanji or Kana.
* Furigana sections should be written in Hiragana or Katakana.
* If more than one furigana section is specified, the number of sections must match the number of characters in the first section.
* Furigana sections can also be empty.

### Limitations

* Automatic furigana depends on kuromoji’s morphological analysis and may produce incorrect readings in some contexts.
* Complex sentences or rare words may reduce accuracy.
* Very large notes may cause slower processing during initial rendering.
* Only Japanese is supported; other languages that can use ruby notation are not handled.
* Manual markup always overrides automatic furigana.

### Related Plugins

* [Markdown Furigana Plugin (original by Steven Kraft)](https://github.com/steven-kraft/obsidian-markdown-furigana) – the basis for this fork.
* [Obsidian Furigana](https://github.com/uonr/obsidian-furigana) – another plugin using ruby syntax directly in notes.
