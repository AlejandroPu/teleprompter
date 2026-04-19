# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.1] - 2026-04-19

### Fixed
- README incorrectly listed multilingual support; corrected to reflect that
  the app uses `Xenova/whisper-tiny.en` (English only)

---

## [2.0.0] - 2026-03-18

### Changed
- CSS refactored from inline `<style>` block into three external stylesheets:
  `base.css` (variables & reset), `setup.css`, and `prompter.css`
- JavaScript refactored from inline `<script>` into ES modules:
  `prompter.js` (engine & state) and `main.js` (UI event listeners)
- State mutations in `prompter.js` encapsulated behind a clean public API,
  preventing direct variable reassignment from `main.js`

### Fixed
- Word array was being cleared before highlight reset in `resetPrompter`,
  causing `updateHighlight` to iterate over an empty array silently

### Internal
- Inline comments translated to English throughout
- JSDoc added to `buildPrompter` and `findBestMatch`
- `toggleMic` added to encapsulate microphone toggle logic in `prompter.js`

---

## [1.0.0] - 2026-03-10

### Added
- Initial release: voice-driven teleprompter with real-time Whisper transcription
- Auto-scroll synchronized to spoken words
- Adjustable font size, text width, and scroll speed
- Multilingual support
- Works offline after first model download