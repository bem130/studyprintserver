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

## Checks

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```
