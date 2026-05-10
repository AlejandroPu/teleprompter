# AGENTS.md

Operational guide for coding agents working in this repository.

## Project

Teleprompter is a small voice-driven web app:

- static frontend under `public/`
- minimal Express server in `server.js`
- Whisper inference in `public/whisper-worker.js`

## Key Files

- `public/js/main.js`
  UI wiring, setup controls, and panel events.
- `public/js/prompter.js`
  Core runtime: session state, audio pipeline, matching, and auto-scroll.
- `public/whisper-worker.js`
  Browser worker that loads the ASR pipeline.

## Commands

- `npm start`
  Start the local server on port `3000`.
- `npm test`
  Run the current portable smoke test used by CI.

## Git Workflow

- Work from short-lived branches.
- Prefer small PRs with one clear scope.
- Keep `main` clean and merge through PRs.
- Use `squash and merge` unless there is a strong reason not to.

## Current Priorities

- CI is now in place with a minimal smoke check.
- Offline support still depends on cached remote runtime assets.

## Voice Improvement Plan

The current voice tracker already uses fuzzy script-window matching. Future
work should improve reliability in small, testable steps.

### Good Tasks For GPT-5.4

- Add focused unit tests for `cleanWord()`, `wordSimilarity()`,
  `scoreScriptWindow()`, and `findBestMatch()`.
- Add clipping feedback when microphone gain saturates the input.
- Add a simple RMS-based noise gate so silent chunks are not sent to Whisper.
- Add light per-chunk normalization before transcription.
- Make `CHUNK_MS` and `OVERLAP_MS` easier to tune from named constants or setup
  controls.
- Add a model selector for `base` and `small`, keeping `base` as the default.
- Persist user preferences in `localStorage`: language, mic, gain, font size,
  text width, and selected model.
- Improve README/manual test notes for voice tracking behavior.

### Medium Tasks For GPT-5.4 If The Scope Is Kept Small

- Move matching helpers from `public/js/prompter.js` into a dedicated
  `public/js/matching.js` module.
- Add manual debug output behind a flag for transcript text, chosen match,
  score, and confidence.
- Tune fuzzy matching thresholds only when there are concrete manual examples
  showing false positives or missed matches.

### Ask The User To Switch Back To GPT-5.5 Before These

- Redesign the tracker around accumulated position confidence instead of a
  single match per transcript chunk.
- Combine Whisper timestamps with script position tracking.
- Replace `MediaRecorder` chunking with a continuous audio buffer.
- Add a real VAD with pre-roll/post-roll buffering instead of a simple noise
  gate.
- Integrate Whisper contextual prompting or timestamp options after verifying
  what Transformers.js supports in-browser.
- Make broad architecture changes touching worker lifecycle, audio capture,
  matching, scrolling, and UI state together.

### Recommended Order

1. Add tests around the current fuzzy matcher.
2. Add clipping feedback and a simple noise gate.
3. Add light normalization.
4. Add the `base`/`small` model selector.
5. Stop and ask the user to return to GPT-5.5 for the confidence-based tracker.

### Handoff Rule

If a task requires changing how position confidence is represented, how audio
is buffered over time, or how Whisper timestamps are interpreted, stop after
writing a short implementation note and ask the user to continue with GPT-5.5.

## Notes

- `CLAUDE.md` remains in this repo on purpose for your Claude-specific workflow.
- Treat this file as the short operational entrypoint for agents.
- Keep deeper analysis or long-form planning out of this file unless it is directly useful for ongoing implementation.
