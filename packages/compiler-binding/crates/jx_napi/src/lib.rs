//! The Node-API face of the Jx compiler core (specs/compiler.md §14).
//!
//! Every function here is a thin, typed door onto a crate that does the work. Long-running calls
//! return a promise and run on the libuv thread pool, so the JavaScript thread that drives a build
//! is never blocked on an encoder; inside a call, work fans out across rayon's pool, whose size is
//! the machine's parallelism and is the pipeline's one concurrency limit.

use std::collections::HashMap;
use std::path::PathBuf;

use napi::bindgen_prelude::{AsyncTask, Error, Result, Status};
use napi::{Env, Task};
use napi_derive::napi;

/// Per-format quality, 1 to 100. A missing value takes the pipeline's default.
#[napi(object)]
pub struct ImageQuality {
    /// AVIF quality. Default 65.
    pub avif: Option<u32>,
    /// JPEG quality. Default 80.
    pub jpeg: Option<u32>,
}

/// One source image and the variants to make of it.
#[napi(object)]
pub struct ImageRequest {
    /// Absolute path of the source image.
    pub source: String,
    /// Absolute path of the directory variants are written into.
    pub out_dir: String,
    /// The file-name stem of every variant.
    pub stem: String,
    /// The hash in each variant's name, keyed by the format name it was asked for under.
    pub hashes: HashMap<String, String>,
    /// The configured width ladder.
    pub widths: Vec<u32>,
    /// Output format names: `avif`, `jpeg`, `png`, `webp`.
    pub formats: Vec<String>,
    /// Per-format quality.
    pub quality: Option<ImageQuality>,
}

/// A source image's oriented dimensions and container format.
#[napi(object)]
pub struct ImageMetadata {
    /// Width in pixels, after EXIF orientation.
    pub width: u32,
    /// Height in pixels, after EXIF orientation.
    pub height: u32,
    /// `jpeg`, `png`, `webp`, `tiff` or `bmp`.
    pub format: String,
}

/// One written variant.
#[napi(object)]
pub struct ImageVariant {
    /// Pixel width.
    pub width: u32,
    /// Encoded format name.
    pub format: String,
    /// File name inside the request's `outDir`.
    pub file_name: String,
}

/// The result of processing one source image.
#[napi(object)]
pub struct ImageManifest {
    /// The source's metadata.
    pub original: ImageMetadata,
    /// Every variant, ordered by width and then by configured format.
    pub variants: Vec<ImageVariant>,
}

fn failure(error: &jx_media::Error) -> Error {
    Error::new(Status::GenericFailure, error.to_string())
}

fn metadata(original: jx_media::Metadata) -> ImageMetadata {
    ImageMetadata {
        width: original.width,
        height: original.height,
        format: original.format,
    }
}

fn quality(value: Option<u32>, default: u8) -> u8 {
    value.map_or(default, |q| {
        u8::try_from(q.clamp(1, 100)).unwrap_or(default)
    })
}

/// The background half of [`process_image`].
pub struct ProcessImage(jx_media::Request);

impl Task for ProcessImage {
    type Output = jx_media::Manifest;
    type JsValue = ImageManifest;

    fn compute(&mut self) -> Result<Self::Output> {
        jx_media::process(&self.0).map_err(|error| failure(&error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(ImageManifest {
            original: metadata(output.original),
            variants: output
                .variants
                .into_iter()
                .map(|variant| ImageVariant {
                    width: variant.width,
                    format: variant.format.name().to_owned(),
                    file_name: variant.file_name,
                })
                .collect(),
        })
    }
}

/// Produce every missing variant of one source image, and describe the whole set.
///
/// # Errors
///
/// Rejects when a format name is unknown or has no hash, the source cannot be decoded, or a file
/// cannot be written.
#[napi]
pub fn process_image(request: ImageRequest) -> Result<AsyncTask<ProcessImage>> {
    let defaults = jx_media::Quality::default();
    let formats = request
        .formats
        .iter()
        .map(|name| name.parse::<jx_media::Format>())
        .collect::<jx_media::Result<Vec<_>>>()
        .map_err(|error| failure(&error))?;
    let hashes = request
        .hashes
        .into_iter()
        .map(|(name, hash)| Ok((name.parse::<jx_media::Format>()?, hash)))
        .collect::<jx_media::Result<HashMap<_, _>>>()
        .map_err(|error| failure(&error))?;
    let chosen = request.quality.as_ref();
    Ok(AsyncTask::new(ProcessImage(jx_media::Request {
        source: PathBuf::from(request.source),
        out_dir: PathBuf::from(request.out_dir),
        stem: request.stem,
        hashes,
        widths: request.widths,
        formats,
        quality: jx_media::Quality {
            avif: quality(chosen.and_then(|q| q.avif), defaults.avif),
            jpeg: quality(chosen.and_then(|q| q.jpeg), defaults.jpeg),
        },
    })))
}

/// The background half of [`image_metadata`].
pub struct ProbeImage(PathBuf);

impl Task for ProbeImage {
    type Output = jx_media::Metadata;
    type JsValue = ImageMetadata;

    fn compute(&mut self) -> Result<Self::Output> {
        jx_media::probe(&self.0).map_err(|error| failure(&error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(metadata(output))
    }
}

/// Read a source image's oriented dimensions and format without decoding its pixels.
#[napi]
pub fn image_metadata(source: String) -> AsyncTask<ProbeImage> {
    AsyncTask::new(ProbeImage(PathBuf::from(source)))
}

/// The version of `@jxsuite/compiler-binding` this addon was built for.
///
/// The build script passes the npm package's version as `JX_ADDON_VERSION`; a bare `cargo build`
/// has none and reports the crates' own placeholder.
#[napi]
pub fn core_version() -> &'static str {
    option_env!("JX_ADDON_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}
