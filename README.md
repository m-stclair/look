# Look Minimal

A standalone extraction and expansion of `vandal`'s 'procedural LUT' `Look` effect.

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

## Test

```sh
npm run test:all
```
