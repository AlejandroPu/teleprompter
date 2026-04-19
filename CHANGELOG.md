# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.2.0] - 2026-04-19

### Added
- Microphone selector in the setup screen: picks from the system's audio
  input devices, with an "Unlock names" button that requests permission to
  reveal labels when they are hidden by the browser
- Live microphone level meter (RMS) that activates once permission is
  granted and updates when the selected device changes
- Microphone gain control (0 %–500 %) with a slider in the setup screen and
  a matching slider in the prompter panel for live adjustment during a
  reading session
- Accessibility passes: `aria-label` on icon-only buttons (mic, reset,
  exit), `aria-label` on the panel sliders, `aria-hidden` on purely
  decorative elements, `role="toolbar"` on the panel, `role="status"` on
  the mic status dot, `aria-keyshortcuts` on controls with keyboard
  bindings, `<label for>` associations in the setup controls, and a
  `<html lang>` attribute that follows the selected language (BCP 47)

### Changed
- Upgraded transcription model from `Xenova/whisper-tiny` to
  `Xenova/whisper-base` for noticeably better accuracy, especially with
  lower-quality microphones and accented speech (~150 MB download on
  first launch, cached afterwards)
- `#hideHint` is now a `<button>` (keyboard-focusable) instead of a `<div>`
- `startMic` routes audio through a `GainNode` and
  `MediaStreamDestination`, so the stream fed to `MediaRecorder` carries
  the configured gain

---

## [2.1.0] - 2026-04-19

### Added
- Multilingual transcription via the multilingual `Xenova/whisper-tiny` model
- Language selector in the setup screen (12 languages: English, Spanish,
  French, German, Italian, Portuguese, Dutch, Russian, Chinese, Japanese,
  Korean, Arabic)
- 1-second audio overlap between chunks: the tail of the previous chunk is
  prefixed to the next one so Whisper never sees a raw cut at word boundaries

### Changed
- `cleanWord` now normalizes diacritics (NFD) and accepts any Unicode letter,
  so matching works for accented characters (café, niño, etc.)
- `initWorker(language)` and the `transcribe` worker message now carry the
  selected language, which is forwarded to the Whisper pipeline

### Fixed
- Starting a new session (after exit) kept scroll position and `currentIdx`
  from the previous session; `buildPrompter` now resets both
- `exitPrompter` leaked `AudioContext` instances and left `processingAudio`,
  `mediaRecorder`, `audioChunks` in a stale state, which could break the
  next session

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