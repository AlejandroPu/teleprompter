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
- Voice tracking needs to improve beyond raw transcript matching:
  - align speech against the expected script instead of treating ASR output as the source of truth
  - use fuzzy word matching for minor transcription errors, omitted words, and short insertions
  - consider Whisper timestamps once the text tracker is more stable
  - add optional heavier Whisper models such as `small` for better accuracy on capable devices
  - add simple audio preprocessing: normalization, clipping feedback, noise gate, and VAD
  - revisit chunk size and overlap after measuring latency versus accuracy
- The next major testing phase is deeper automated coverage:
  - `cleanWord()`
  - `findBestMatch()`
  - session reset and transition flows
- Offline support still depends on cached remote runtime assets.

## Notes

- `CLAUDE.md` remains in this repo on purpose for your Claude-specific workflow.
- Treat this file as the short operational entrypoint for agents.
- Keep deeper analysis or long-form planning out of this file unless it is directly useful for ongoing implementation.
