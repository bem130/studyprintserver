#![forbid(unsafe_code)]

use anyhow::{Context, Result};
use axum::extract::{Path as AxumPath, State};
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;

const DEFAULT_INDEX_DIR: &str = r"C:\data\studyprintdata\index";
const DEFAULT_LIBRARY_DIR: &str = r"C:\data\studyprintdata\library";
const DEFAULT_BIND: &str = "127.0.0.1:7878";

#[derive(Clone)]
struct AppState {
    data: Arc<AppData>,
    library_dir: Arc<PathBuf>,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Serialize)]
struct AppData {
    items: Vec<StudyPrintItem>,
    fields: Vec<FieldSummary>,
    dates: Vec<String>,
    stats: Stats,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
struct StudyPrintItem {
    global_content_id: String,
    print_id: String,
    content_id: String,
    title: String,
    logical_date: String,
    primary_field_ref: String,
    primary_field_path: String,
    tags: Vec<String>,
    image_path: String,
    image_url: String,
    xml_path: String,
    text: String,
    transcription: Option<String>,
    formula_count: usize,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
struct FieldSummary {
    ref_id: String,
    path: String,
    count: usize,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Serialize)]
struct Stats {
    print_count: usize,
    content_count: usize,
    field_count: usize,
    date_count: usize,
    formula_count: usize,
}

#[derive(Debug, Deserialize)]
struct PrintRecord {
    image_path: String,
    print_id: String,
    xml_path: String,
}

#[derive(Debug, Deserialize)]
struct ContentRecord {
    content_id: String,
    global_content_id: String,
    logical_date: String,
    primary_field_path: String,
    primary_field_ref: String,
    print_id: String,
    tags: Vec<String>,
    title: String,
}

#[derive(Debug, Deserialize)]
struct BodyVariantRecord {
    global_content_id: String,
    preferred_for_index: bool,
    text: String,
    transcription: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FormulaRecord {
    global_content_id: String,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Serialize)]
struct Health {
    ok: bool,
    prints: usize,
    contents: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    let index_dir = env_path("STUDYPRINT_INDEX_DIR", DEFAULT_INDEX_DIR);
    let library_dir = env_path("STUDYPRINT_LIBRARY_DIR", DEFAULT_LIBRARY_DIR);
    let bind = env::var("STUDYPRINT_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
    let addr: SocketAddr = bind
        .parse()
        .with_context(|| format!("invalid STUDYPRINT_BIND value: {bind}"))?;

    let data = Arc::new(load_data(&index_dir).context("failed to load StudyPrint index")?);
    let state = AppState {
        data,
        library_dir: Arc::new(library_dir),
    };

    let app = Router::new()
        .route("/", get(index_html))
        .route("/assets/app.css", get(app_css))
        .route("/assets/app.js", get(app_js))
        .route("/assets/viewer-core.js", get(viewer_core_js))
        .route("/assets/ui-state.js", get(ui_state_js))
        .route("/assets/vdom.js", get(vdom_js))
        .route("/api/health", get(api_health))
        .route("/api/contents", get(api_contents))
        .route("/api/fields", get(api_fields))
        .route("/library/{*path}", get(library_file))
        .with_state(state);

    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;
    println!("studyprintserver listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

fn env_path(name: &str, default: &str) -> PathBuf {
    env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default))
}

async fn index_html() -> Html<&'static str> {
    Html(include_str!("../static/index.html"))
}

async fn app_css() -> Response {
    with_content_type(include_str!("../static/app.css"), "text/css; charset=utf-8")
}

async fn app_js() -> Response {
    with_content_type(
        include_str!("../static/app.js"),
        "application/javascript; charset=utf-8",
    )
}

async fn viewer_core_js() -> Response {
    with_content_type(
        include_str!("../static/viewer-core.js"),
        "application/javascript; charset=utf-8",
    )
}

async fn ui_state_js() -> Response {
    with_content_type(
        include_str!("../static/ui-state.js"),
        "application/javascript; charset=utf-8",
    )
}

async fn vdom_js() -> Response {
    with_content_type(
        include_str!("../static/vdom.js"),
        "application/javascript; charset=utf-8",
    )
}

async fn api_health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        ok: true,
        prints: state.data.stats.print_count,
        contents: state.data.stats.content_count,
    })
}

async fn api_contents(State(state): State<AppState>) -> Json<Vec<StudyPrintItem>> {
    Json(state.data.items.clone())
}

async fn api_fields(State(state): State<AppState>) -> Json<Vec<FieldSummary>> {
    Json(state.data.fields.clone())
}

async fn library_file(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
) -> Result<Response, StatusCode> {
    if !is_safe_relative_path(&path) || !path.ends_with(".png") {
        return Err(StatusCode::BAD_REQUEST);
    }

    let file_path = state
        .library_dir
        .join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let bytes = tokio::fs::read(file_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let mut response = bytes.into_response();
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("image/png"));
    Ok(response)
}

fn with_content_type(text: &'static str, content_type: &'static str) -> Response {
    let mut response = text.into_response();
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
}

fn load_data(index_dir: &Path) -> Result<AppData> {
    let prints: Vec<PrintRecord> = read_jsonl(&index_dir.join("prints.jsonl"))?;
    let contents: Vec<ContentRecord> = read_jsonl(&index_dir.join("contents.jsonl"))?;
    let bodies: Vec<BodyVariantRecord> = read_jsonl(&index_dir.join("body_variants.jsonl"))?;
    let formulas: Vec<FormulaRecord> = read_jsonl(&index_dir.join("formulas.jsonl"))?;

    let print_by_id: HashMap<_, _> = prints
        .iter()
        .map(|record| (record.print_id.as_str(), record))
        .collect();
    let body_by_content: HashMap<_, _> = bodies
        .iter()
        .filter(|record| record.preferred_for_index)
        .map(|record| (record.global_content_id.as_str(), record))
        .collect();

    let mut formula_counts: HashMap<&str, usize> = HashMap::new();
    for formula in &formulas {
        *formula_counts
            .entry(formula.global_content_id.as_str())
            .or_default() += 1;
    }

    let mut items = Vec::new();
    let mut field_counts: BTreeMap<(String, String), usize> = BTreeMap::new();
    let mut dates = BTreeSet::new();

    for content in contents {
        let print = print_by_id
            .get(content.print_id.as_str())
            .with_context(|| format!("content references missing print: {}", content.print_id))?;
        let body = body_by_content.get(content.global_content_id.as_str());
        let image_url = format!("/library/{}", content_safe_url_path(&print.image_path)?);

        *field_counts
            .entry((
                content.primary_field_ref.clone(),
                content.primary_field_path.clone(),
            ))
            .or_default() += 1;
        dates.insert(content.logical_date.clone());

        items.push(StudyPrintItem {
            global_content_id: content.global_content_id.clone(),
            print_id: content.print_id,
            content_id: content.content_id,
            title: content.title,
            logical_date: content.logical_date,
            primary_field_ref: content.primary_field_ref,
            primary_field_path: content.primary_field_path,
            tags: content.tags,
            image_path: print.image_path.clone(),
            image_url,
            xml_path: print.xml_path.clone(),
            text: body.map(|record| record.text.clone()).unwrap_or_default(),
            transcription: body.and_then(|record| record.transcription.clone()),
            formula_count: *formula_counts
                .get(content.global_content_id.as_str())
                .unwrap_or(&0),
        });
    }

    items.sort_by(|a, b| {
        a.logical_date
            .cmp(&b.logical_date)
            .then_with(|| a.print_id.cmp(&b.print_id))
            .then_with(|| a.content_id.cmp(&b.content_id))
    });

    let fields = field_counts
        .into_iter()
        .map(|((ref_id, path), count)| FieldSummary {
            ref_id,
            path,
            count,
        })
        .collect::<Vec<_>>();
    let dates = dates.into_iter().collect::<Vec<_>>();
    let stats = Stats {
        print_count: prints.len(),
        content_count: items.len(),
        field_count: fields.len(),
        date_count: dates.len(),
        formula_count: formulas.len(),
    };

    Ok(AppData {
        items,
        fields,
        dates,
        stats,
    })
}

fn read_jsonl<T: DeserializeOwned>(path: &Path) -> Result<Vec<T>> {
    let text =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
    text.lines()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, line)| {
            serde_json::from_str(line)
                .with_context(|| format!("invalid JSONL at {}:{}", path.display(), index + 1))
        })
        .collect()
}

fn content_safe_url_path(path: &str) -> Result<String> {
    if !is_safe_relative_path(path) {
        anyhow::bail!("unsafe relative path in index: {path}");
    }
    Ok(path.replace('\\', "/"))
}

fn is_safe_relative_path(path: &str) -> bool {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.contains(':')
    {
        return false;
    }
    path.split('/')
        .all(|component| !component.is_empty() && component != "." && component != "..")
}

#[cfg(test)]
mod tests {
    use super::*;
    use ts_rs::{Config, TS};

    #[test]
    fn accepts_library_relative_png_path() {
        assert!(is_safe_relative_path(
            "2026/05/18/2026-05-18_scan-05182026_p001.png"
        ));
    }

    #[test]
    fn rejects_unsafe_library_paths() {
        assert!(!is_safe_relative_path("../x.png"));
        assert!(!is_safe_relative_path("C:/data/x.png"));
        assert!(!is_safe_relative_path("2026\\05\\18\\x.png"));
        assert!(!is_safe_relative_path("/2026/05/18/x.png"));
    }

    #[test]
    fn export_typescript_api_bindings() {
        let cfg = Config::new();
        let output = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("frontend")
            .join("src")
            .join("generated")
            .join("api-types.ts");
        fs::create_dir_all(output.parent().expect("generated dir exists")).unwrap();

        let mut text = String::from(
            "// This file is generated from Rust API DTOs by `cargo test export_typescript_api_bindings`.\n",
        );
        text.push_str("// Do not edit this file manually.\n\n");
        append_binding::<StudyPrintItem>(&cfg, &mut text);
        append_binding::<FieldSummary>(&cfg, &mut text);
        append_binding::<Health>(&cfg, &mut text);
        text.push_str("export type ContentsResponse = StudyPrintItem[];\n");
        text.push_str("export type FieldsResponse = FieldSummary[];\n");
        text.push_str("export type HealthResponse = Health;\n");

        fs::write(output, text).unwrap();
    }

    fn append_binding<T: TS + 'static>(cfg: &Config, output: &mut String) {
        let binding = T::export_to_string(cfg).unwrap();
        for line in binding.lines() {
            if !line.starts_with("// This file was generated") && !line.trim().is_empty() {
                output.push_str(line);
                output.push('\n');
            }
        }
        output.push('\n');
    }
}
