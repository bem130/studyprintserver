#![forbid(unsafe_code)]

use anyhow::{Context, Result};
use axum::extract::{Path as AxumPath, State};
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;

const DEFAULT_INDEX_DIR: &str = r"C:\data\studyprintdata\index";
const DEFAULT_LIBRARY_DIR: &str = r"C:\data\studyprintdata\library";
const DEFAULT_STATIC_DIR: &str = "static";
const DEFAULT_BIND: &str = "127.0.0.1:7878";

#[derive(Clone)]
struct AppState {
    data: Arc<AppData>,
    library_dir: Arc<PathBuf>,
    static_dir: Arc<PathBuf>,
}

#[derive(Debug, Serialize)]
struct AppData {
    items: Vec<StudyPrintItem>,
    print_count: usize,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
struct StudyPrintItem {
    global_content_id: String,
    print_id: String,
    title: String,
    logical_date: String,
    primary_field_path: String,
    tags: Vec<String>,
    image_url: String,
    xml_url: String,
    xml_text: String,
    text: String,
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
    global_content_id: String,
    logical_date: String,
    primary_field_path: String,
    print_id: String,
    tags: Vec<String>,
    title: String,
}

#[derive(Debug, Deserialize)]
struct BodyVariantRecord {
    global_content_id: String,
    preferred_for_index: bool,
    text: String,
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
    let static_dir = env_path("STUDYPRINT_STATIC_DIR", DEFAULT_STATIC_DIR);
    let bind = env::var("STUDYPRINT_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
    let addr: SocketAddr = bind
        .parse()
        .with_context(|| format!("invalid STUDYPRINT_BIND value: {bind}"))?;

    let data =
        Arc::new(load_data(&index_dir, &library_dir).context("failed to load StudyPrint index")?);
    let state = AppState {
        data,
        library_dir: Arc::new(library_dir),
        static_dir: Arc::new(static_dir),
    };

    let app = Router::new()
        .route("/", get(index_html))
        .route("/assets/{*path}", get(static_asset))
        .route("/api/health", get(api_health))
        .route("/api/contents", get(api_contents))
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

async fn index_html(State(state): State<AppState>) -> Result<Response, StaticFileError> {
    static_file_response(&state.static_dir, "index.html", StaticContentKind::Html).await
}

async fn static_asset(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
) -> Result<Response, StaticFileError> {
    validate_static_file_path(&path)?;
    let kind = static_content_kind(&path)?;
    static_file_response(&state.static_dir, &path, kind).await
}

async fn api_health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        ok: true,
        prints: state.data.print_count,
        contents: state.data.items.len(),
    })
}

async fn api_contents(State(state): State<AppState>) -> Json<Vec<StudyPrintItem>> {
    Json(state.data.items.clone())
}

async fn library_file(
    State(state): State<AppState>,
    AxumPath(path): AxumPath<String>,
) -> Result<Response, LibraryFileError> {
    validate_library_file_path(&path)?;
    let kind = library_content_kind(&path)?;

    let file_path = state
        .library_dir
        .join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let bytes = tokio::fs::read(file_path)
        .await
        .map_err(|_| LibraryFileError::NotFound)?;
    let mut response = bytes.into_response();
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(kind.content_type()));
    Ok(response)
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum LibraryFileError {
    InvalidPath,
    UnsupportedExtension,
    NotFound,
}

impl IntoResponse for LibraryFileError {
    fn into_response(self) -> Response {
        match self {
            Self::InvalidPath | Self::UnsupportedExtension => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
        }
        .into_response()
    }
}

fn validate_library_file_path(path: &str) -> Result<(), LibraryFileError> {
    if !is_safe_relative_path(path) {
        return Err(LibraryFileError::InvalidPath);
    }
    library_content_kind(path)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum LibraryContentKind {
    Png,
    Xml,
}

impl LibraryContentKind {
    fn content_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Xml => "application/xml; charset=utf-8",
        }
    }
}

fn library_content_kind(path: &str) -> Result<LibraryContentKind, LibraryFileError> {
    if path.ends_with(".png") {
        return Ok(LibraryContentKind::Png);
    }
    if path.ends_with(".xml") {
        return Ok(LibraryContentKind::Xml);
    }
    Err(LibraryFileError::UnsupportedExtension)
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum StaticFileError {
    InvalidPath,
    UnsupportedExtension,
    NotFound,
}

impl IntoResponse for StaticFileError {
    fn into_response(self) -> Response {
        match self {
            Self::InvalidPath | Self::UnsupportedExtension => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
        }
        .into_response()
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum StaticContentKind {
    Html,
    Css,
    JavaScript,
    Woff2,
    Woff,
    Ttf,
}

impl StaticContentKind {
    fn content_type(self) -> &'static str {
        match self {
            Self::Html => "text/html; charset=utf-8",
            Self::Css => "text/css; charset=utf-8",
            Self::JavaScript => "application/javascript; charset=utf-8",
            Self::Woff2 => "font/woff2",
            Self::Woff => "font/woff",
            Self::Ttf => "font/ttf",
        }
    }
}

async fn static_file_response(
    static_dir: &Path,
    path: &str,
    kind: StaticContentKind,
) -> Result<Response, StaticFileError> {
    let file_path = static_dir.join(path.replace('/', std::path::MAIN_SEPARATOR_STR));
    let bytes = tokio::fs::read(file_path)
        .await
        .map_err(|_| StaticFileError::NotFound)?;
    let mut response = bytes.into_response();
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(kind.content_type()));
    Ok(response)
}

fn validate_static_file_path(path: &str) -> Result<(), StaticFileError> {
    if !is_safe_relative_path(path) {
        return Err(StaticFileError::InvalidPath);
    }
    static_content_kind(path)?;
    Ok(())
}

fn static_content_kind(path: &str) -> Result<StaticContentKind, StaticFileError> {
    if path == "index.html" {
        return Ok(StaticContentKind::Html);
    }
    if path.ends_with(".css") {
        return Ok(StaticContentKind::Css);
    }
    if path.ends_with(".js") || path.ends_with(".mjs") {
        return Ok(StaticContentKind::JavaScript);
    }
    if path.ends_with(".woff2") {
        return Ok(StaticContentKind::Woff2);
    }
    if path.ends_with(".woff") {
        return Ok(StaticContentKind::Woff);
    }
    if path.ends_with(".ttf") {
        return Ok(StaticContentKind::Ttf);
    }
    Err(StaticFileError::UnsupportedExtension)
}

fn load_data(index_dir: &Path, library_dir: &Path) -> Result<AppData> {
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
    for content in contents {
        let print = print_by_id
            .get(content.print_id.as_str())
            .with_context(|| format!("content references missing print: {}", content.print_id))?;
        let body = body_by_content
            .get(content.global_content_id.as_str())
            .with_context(|| {
                format!(
                    "content references missing preferred body: {}",
                    content.global_content_id
                )
            })?;
        let image_url = format!("/library/{}", content_safe_url_path(&print.image_path)?);
        let safe_xml_path = content_safe_url_path(&print.xml_path)?;
        let xml_url = format!("/library/{safe_xml_path}");
        let xml_text = read_library_text(library_dir, &safe_xml_path)?;
        let text = body_list_text_from_xml(&xml_text).unwrap_or_else(|| body.text.clone());

        items.push(StudyPrintItem {
            global_content_id: content.global_content_id.clone(),
            print_id: content.print_id,
            title: content.title,
            logical_date: content.logical_date,
            primary_field_path: content.primary_field_path,
            tags: content.tags,
            image_url,
            xml_url,
            xml_text,
            text,
            formula_count: *formula_counts
                .get(content.global_content_id.as_str())
                .unwrap_or(&0),
        });
    }

    items.sort_by(|a, b| {
        a.logical_date
            .cmp(&b.logical_date)
            .then_with(|| a.print_id.cmp(&b.print_id))
            .then_with(|| a.global_content_id.cmp(&b.global_content_id))
    });

    Ok(AppData {
        items,
        print_count: prints.len(),
    })
}

fn body_list_text_from_xml(xml_text: &str) -> Option<String> {
    let document = roxmltree::Document::parse(xml_text).ok()?;
    let body = document
        .descendants()
        .find(|node| node.is_element() && node.tag_name().name() == "body_original")?;

    let mut parts = Vec::new();
    collect_list_text(body, &mut parts);
    non_empty_normalized(&parts.join(" "))
}

fn collect_list_text(node: roxmltree::Node<'_, '_>, parts: &mut Vec<String>) {
    if node.is_text() {
        push_normalized_part(parts, node.text().unwrap_or_default());
        return;
    }

    if !node.is_element() {
        return;
    }

    match node.tag_name().name() {
        "tex" | "altText" => {}
        "formula" => {
            if push_direct_child_text(node, "altText", parts) {
                return;
            }
            let _ = push_direct_child_text(node, "tex", parts);
        }
        _ => {
            for child in node.children() {
                collect_list_text(child, parts);
            }
        }
    }
}

fn push_direct_child_text(
    node: roxmltree::Node<'_, '_>,
    child_name: &str,
    parts: &mut Vec<String>,
) -> bool {
    let Some(child) = node
        .children()
        .find(|candidate| candidate.is_element() && candidate.tag_name().name() == child_name)
    else {
        return false;
    };
    let text = text_descendants(child);
    let Some(text) = non_empty_normalized(&text) else {
        return false;
    };
    parts.push(text);
    true
}

fn text_descendants(node: roxmltree::Node<'_, '_>) -> String {
    let mut text = String::new();
    for descendant in node.descendants().filter(|candidate| candidate.is_text()) {
        text.push_str(descendant.text().unwrap_or_default());
        text.push(' ');
    }
    text
}

fn push_normalized_part(parts: &mut Vec<String>, text: &str) {
    if let Some(text) = non_empty_normalized(text) {
        parts.push(text);
    }
}

fn non_empty_normalized(text: &str) -> Option<String> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn read_library_text(library_dir: &Path, path: &str) -> Result<String> {
    fs::read_to_string(library_dir.join(path.replace('/', std::path::MAIN_SEPARATOR_STR)))
        .with_context(|| format!("failed to read library text file: {path}"))
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
    fn validates_library_png_paths_with_typed_errors() {
        assert_eq!(
            validate_library_file_path("2026/05/18/x.txt"),
            Err(LibraryFileError::UnsupportedExtension)
        );
        assert_eq!(
            validate_library_file_path("../x.png"),
            Err(LibraryFileError::InvalidPath)
        );
        assert_eq!(validate_library_file_path("2026/05/18/x.png"), Ok(()));
        assert_eq!(validate_library_file_path("2026/05/18/x.xml"), Ok(()));
        assert_eq!(
            library_content_kind("2026/05/18/x.xml"),
            Ok(LibraryContentKind::Xml)
        );
    }

    #[test]
    fn validates_static_asset_paths_with_typed_errors() {
        assert_eq!(
            validate_static_file_path("../app.js"),
            Err(StaticFileError::InvalidPath)
        );
        assert_eq!(
            validate_static_file_path("app.png"),
            Err(StaticFileError::UnsupportedExtension)
        );
        assert_eq!(validate_static_file_path("app.js"), Ok(()));
        assert_eq!(validate_static_file_path("vendor/katex.mjs"), Ok(()));
        assert_eq!(
            validate_static_file_path("vendor/fonts/katex.woff2"),
            Ok(())
        );
        assert_eq!(static_content_kind("app.css"), Ok(StaticContentKind::Css));
    }

    #[test]
    fn list_text_prefers_formula_alt_text_over_tex() {
        let xml = r#"
        <print xmlns="urn:slf:studyprint:0.5">
          <body>
            <contents>
              <content id="c1" ordinal="1">
                <body_versions>
                  <body_original id="c1.bo1">
                    <section>
                      <title>基本</title>
                      <formula display="block">
                        <tex><![CDATA[\frac{a}{b}]]></tex>
                        <altText>a/b</altText>
                      </formula>
                      <p><t>終わり</t></p>
                    </section>
                  </body_original>
                </body_versions>
              </content>
            </contents>
          </body>
        </print>
        "#;

        let text = body_list_text_from_xml(xml).expect("list text");

        assert_eq!(text, "基本 a/b 終わり");
        assert!(!text.contains("\\frac"));
    }

    #[test]
    fn list_text_falls_back_to_tex_when_formula_alt_text_is_missing() {
        let xml = r#"
        <print xmlns="urn:slf:studyprint:0.5">
          <body>
            <contents>
              <content id="c1" ordinal="1">
                <body_versions>
                  <body_original id="c1.bo1">
                    <formula display="inline">
                      <tex><![CDATA[x^2+y^2]]></tex>
                    </formula>
                  </body_original>
                </body_versions>
              </content>
            </contents>
          </body>
        </print>
        "#;

        let text = body_list_text_from_xml(xml).expect("list text");

        assert_eq!(text, "x^2+y^2");
    }

    #[test]
    fn generated_typescript_api_bindings_are_current() -> Result<(), Box<dyn std::error::Error>> {
        let expected = typescript_api_bindings()?;
        let actual = fs::read_to_string(generated_api_types_path())?;
        assert_eq!(actual, expected);
        Ok(())
    }

    #[test]
    #[ignore = "writes generated TypeScript API bindings"]
    fn export_typescript_api_bindings() -> Result<(), Box<dyn std::error::Error>> {
        let output = generated_api_types_path();
        let output_dir = output.parent().ok_or_else(|| {
            std::io::Error::other("generated TypeScript output path has no parent")
        })?;
        fs::create_dir_all(output_dir)?;
        fs::write(output, typescript_api_bindings()?)?;
        Ok(())
    }

    fn generated_api_types_path() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("frontend")
            .join("src")
            .join("generated")
            .join("api-types.ts")
    }

    fn typescript_api_bindings() -> Result<String, ts_rs::ExportError> {
        let cfg = Config::new();
        let mut text = String::from(
            "// This file is generated from Rust API DTOs by `npm run generate:api-types`.\n",
        );
        text.push_str("// Do not edit this file manually.\n\n");
        append_binding::<StudyPrintItem>(&cfg, &mut text)?;
        append_binding::<Health>(&cfg, &mut text)?;
        text.push_str("export type ContentsResponse = StudyPrintItem[];\n");
        text.push_str("export type HealthResponse = Health;\n");
        Ok(text)
    }

    fn append_binding<T: TS + 'static>(
        cfg: &Config,
        output: &mut String,
    ) -> Result<(), ts_rs::ExportError> {
        let binding = T::export_to_string(cfg)?;
        for line in binding.lines() {
            if !line.starts_with("// This file was generated") && !line.trim().is_empty() {
                output.push_str(line);
                output.push('\n');
            }
        }
        output.push('\n');
        Ok(())
    }
}
