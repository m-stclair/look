# Look

A standalone extraction and expansion of `vandal`'s 'procedural LUT' `Look` effect.

Unlike `vandal` and some of its other children, Look is not for spatial-domain 
processing, quantized / discrete effects, etc. Look is for fast, easy shaping 
of continuous, invertible point transforms.

## Run

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Looks

The top toolbar has a small looks layer over the shader config:

- pick a built-in look from the dropdown
- rename the current look inline
- `Save` stores a user look in `localStorage`
- `Copy` duplicates the current settings into a new saved look
- `Delete` removes only saved user looks; built-ins stay read-only
- `JSON` exports the current look as a portable `.look.json`
- `LUT` exports the current look as a 33-point `.cube` LUT
- `Import` accepts one exported look or a bundle shaped like `{ "looks": [...] }`

The `Edited` badge means the current controls no longer match the selected saved/built-in look. `Reset` returns the controls to the selected look's saved values.

The `.cube` export samples the same OKLab/OKLCH look transform into a display-referred sRGB 3D LUT. Rows are written in Cube order: red index fastest, blue index slowest.

## Hotkeys

- `Shift + R` resets the current look
- `C` toggles compare mode
- `O` opens an image
- `Shift + 1` toggles Tone Map zoom / dock
- `Shift + 2` toggles Chroma Map zoom / dock
- `0` resets image zoom to 100%

Hotkeys are ignored while typing in text fields, selects, textareas, or editable regions.

## Test

```sh
npm run test:all
```
