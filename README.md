# StudyPrint Server

Rust web viewer for a StudyPrint index.

## Run

```powershell
cargo run
```

Default paths:

- `STUDYPRINT_INDEX_DIR`: `C:\data\studyprintdata\index`
- `STUDYPRINT_LIBRARY_DIR`: `C:\data\studyprintdata\library`
- `STUDYPRINT_BIND`: `127.0.0.1:7878`

Open `http://127.0.0.1:7878`.

## Viewer

- Theme toggle switches the UI between light and dark.
- Image tone mode cycles `Auto`, `Invert`, and `Paper`.
- Inverted image mode uses OKLab lightness inversion: paper white becomes dark, black ink becomes light, and pen hue direction is preserved as much as display gamut allows.
- Image tools support rotate, zoom, fit reset, fullscreen, and opening the original PNG.

## Checks

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
