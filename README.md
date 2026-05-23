# Look Minimal

A deliberately small standalone extraction of Vandal's `Look` effect.

Phase 2 adds the planned minimal control surface around the Phase 1 renderer:

- one image picker
- one canvas
- one reset-all button
- one PNG export button
- grouped Tone / Chroma / Tint controls
- exact numeric entry beside every slider
- per-group reset buttons
- inline OKLab / OKLCh shader helpers, palette-synth style

This is still intentionally not a full Vandal workbench. No animation, no presets, no history, no effect graph, no shader manifest.

## Run

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Test

```sh
npm run test:all
```
