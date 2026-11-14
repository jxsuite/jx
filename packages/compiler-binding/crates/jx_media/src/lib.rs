//! Jx media pipeline: responsive raster variants, encoded in process (specs/compiler.md §7).
//!
//! One source image becomes a ladder of widths, each encoded to every configured format. The
//! crate owns decoding, EXIF orientation, colour conversion to sRGB, resizing and encoding; the
//! caller owns naming (a stem and one hash per format) and where the files go.
//!
//! Every codec here is Rust. That is a constraint, not an accident: a native addon that links no
//! C library has nothing to `dlopen`, which is the failure the previous sharp-based pipeline had on
//! every system without an FHS `libstdc++`.

mod decode;
mod encode;
mod resize;

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::str::FromStr;

use rayon::prelude::*;

pub use decode::{probe, Metadata};

/// Everything that can go wrong while producing variants.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The file could not be read or written.
    #[error("{path}: {source}")]
    Io {
        /// The file the operation was on.
        path: PathBuf,
        /// The operating-system error.
        source: std::io::Error,
    },
    /// The bytes are not an image this pipeline decodes.
    #[error("{path}: cannot decode image: {message}")]
    Decode {
        /// The source image.
        path: PathBuf,
        /// The decoder's own message.
        message: String,
    },
    /// A format name the pipeline does not encode.
    #[error("unsupported output format \"{0}\" (supported: avif, jpeg, png, webp)")]
    UnsupportedFormat(String),
    /// A format was asked for and the request names no hash for its files.
    #[error("no file-name hash was given for format \"{0}\"")]
    MissingHash(Format),
    /// An encoder refused the pixels.
    #[error("cannot encode {format} at {width}px: {message}")]
    Encode {
        /// The output format being written.
        format: Format,
        /// The variant width.
        width: u32,
        /// The encoder's own message.
        message: String,
    },
}

/// A specialised result for this crate.
pub type Result<T> = std::result::Result<T, Error>;

/// An output format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Format {
    /// AV1 Image File Format, lossy.
    Avif,
    /// JPEG, lossy, progressive. A source with transparency is written as PNG instead.
    Jpeg,
    /// PNG, lossless.
    Png,
    /// WebP, **lossless only**: no permissively licensed Rust encoder writes lossy WebP.
    Webp,
}

impl Format {
    /// The name used in configuration and as the file extension.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Avif => "avif",
            Self::Jpeg => "jpeg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }
}

impl fmt::Display for Format {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

impl FromStr for Format {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "avif" => Ok(Self::Avif),
            "jpeg" | "jpg" => Ok(Self::Jpeg),
            "png" => Ok(Self::Png),
            "webp" => Ok(Self::Webp),
            other => Err(Error::UnsupportedFormat(other.to_owned())),
        }
    }
}

/// Per-format quality, 1 to 100. Lossless formats ignore theirs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quality {
    /// AVIF quality.
    pub avif: u8,
    /// JPEG quality.
    pub jpeg: u8,
}

impl Default for Quality {
    fn default() -> Self {
        Self { avif: 65, jpeg: 80 }
    }
}

/// One source image and what to make of it.
#[derive(Debug, Clone)]
pub struct Request {
    /// The source image.
    pub source: PathBuf,
    /// The directory variants are written into. Created if missing.
    pub out_dir: PathBuf,
    /// The file-name stem every variant starts with.
    pub stem: String,
    /// The hash in each variant's name, by the format that was asked for. One per format, because
    /// it covers what the caller encoded with (the format and its quality) as well as the source,
    /// so a changed setting is a changed name and never an existing file kept by mistake.
    pub hashes: HashMap<Format, String>,
    /// The configured width ladder.
    pub widths: Vec<u32>,
    /// The formats to encode, in configuration order.
    pub formats: Vec<Format>,
    /// Per-format quality.
    pub quality: Quality,
}

/// One written variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Variant {
    /// Pixel width.
    pub width: u32,
    /// Encoded format.
    pub format: Format,
    /// File name inside the request's `out_dir`.
    pub file_name: String,
}

/// The result of processing one source image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    /// The source's oriented dimensions and format.
    pub original: Metadata,
    /// Every variant, ordered by width and then by configured format.
    pub variants: Vec<Variant>,
}

/// The widths to produce for a source of `source_width` pixels.
///
/// The configured ladder, capped at the source's own width, because upscaling only wastes bytes. A
/// source narrower than the top rung is also offered at its native width, so it is never served
/// only as a downscale. A source wider than the top rung is not: the largest configured width is
/// the ceiling the project chose.
#[must_use]
pub fn ladder(source_width: u32, configured: &[u32]) -> Vec<u32> {
    let ceiling = configured.iter().copied().max().unwrap_or(source_width);
    let mut widths: Vec<u32> = configured
        .iter()
        .copied()
        .filter(|w| *w > 0 && *w <= source_width)
        .collect();
    if source_width < ceiling || widths.is_empty() {
        widths.push(source_width);
    }
    widths.sort_unstable();
    widths.dedup();
    widths
}

/// The file name of one variant: `<stem>-<width>-<hash>.<format>`.
#[must_use]
pub fn variant_file_name(stem: &str, width: u32, hash: &str, format: Format) -> String {
    format!("{stem}-{width}-{hash}.{format}")
}

/// A format to write, and the requested format whose hash names its files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Output {
    written: Format,
    asked: Format,
}

/// The formats a source is actually written in.
///
/// JPEG has no alpha channel. Where JPEG was asked for and the source has transparency, PNG is
/// written in its place, so the universally decodable fallback of a logo or a screenshot with
/// rounded corners is not a white rectangle. That PNG takes the hash JPEG was given. PNG is not
/// written twice when both were asked for, and then it keeps the hash PNG was given.
fn effective_formats(requested: &[Format], opaque: bool) -> Vec<Output> {
    let mut outputs: Vec<Output> = Vec::with_capacity(requested.len());
    for &asked in requested {
        let written = if asked == Format::Jpeg && !opaque {
            Format::Png
        } else {
            asked
        };
        match outputs.iter_mut().find(|output| output.written == written) {
            Some(existing) => {
                if asked == written {
                    existing.asked = asked;
                }
            }
            None => outputs.push(Output { written, asked }),
        }
    }
    outputs
}

fn plan(request: &Request, widths: &[u32], outputs: &[Output]) -> Result<Vec<Variant>> {
    let mut variants = Vec::with_capacity(widths.len() * outputs.len());
    for &width in widths {
        for output in outputs {
            let hash = request
                .hashes
                .get(&output.asked)
                .ok_or(Error::MissingHash(output.asked))?;
            variants.push(Variant {
                width,
                format: output.written,
                file_name: variant_file_name(&request.stem, width, hash, output.written),
            });
        }
    }
    Ok(variants)
}

/// Produce every variant of one source image.
///
/// A variant whose file already exists is not encoded again: its name carries a hash of the source
/// and of the settings it was encoded with, so an existing file is the same bytes this call would
/// write. When every variant exists the
/// source is not even decoded. Files are written under a temporary name and renamed, so a build
/// killed mid-encode never leaves a truncated variant for the next one to reuse.
///
/// A source with transparency is written as PNG wherever JPEG was asked for, and the manifest
/// names the format that was written.
///
/// # Errors
///
/// Returns an [`Error`] when the source cannot be read or decoded, when a requested format has no
/// hash, when the output directory cannot be written, or when an encoder refuses a variant.
pub fn process(request: &Request) -> Result<Manifest> {
    let original = probe(&request.source)?;
    let widths = ladder(original.width, &request.widths);
    let exists = |variant: &Variant| request.out_dir.join(&variant.file_name).exists();

    let requested = plan(request, &widths, &effective_formats(&request.formats, true))?;
    if requested.iter().all(exists) {
        return Ok(Manifest {
            original,
            variants: requested,
        });
    }

    let pixels = decode::decode(&request.source)?;
    let formats = effective_formats(&request.formats, pixels.is_opaque());
    let variants = plan(request, &widths, &formats)?;
    std::fs::create_dir_all(&request.out_dir).map_err(|source| Error::Io {
        path: request.out_dir.clone(),
        source,
    })?;

    let mut by_width: Vec<(u32, Vec<&Variant>)> = Vec::new();
    for variant in variants.iter().filter(|variant| !exists(variant)) {
        match by_width.last_mut() {
            Some((width, group)) if *width == variant.width => group.push(variant),
            _ => by_width.push((variant.width, vec![variant])),
        }
    }

    by_width
        .par_iter()
        .try_for_each(|(width, group)| -> Result<()> {
            let resized = resize::to_width(&pixels, *width);
            group.par_iter().try_for_each(|variant| -> Result<()> {
                let bytes = encode::encode(&resized, variant.format, request.quality)?;
                write_atomically(&request.out_dir.join(&variant.file_name), &bytes)
            })
        })?;

    Ok(Manifest { original, variants })
}

/// Write `bytes` to `path` so that the path only ever names a complete file.
fn write_atomically(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(format!(".{}.tmp", std::process::id()));
    let temporary = PathBuf::from(temporary);
    std::fs::write(&temporary, bytes)
        .and_then(|()| std::fs::rename(&temporary, path))
        .map_err(|source| {
            let _ = std::fs::remove_file(&temporary);
            Error::Io {
                path: path.to_owned(),
                source,
            }
        })
}

/// Decoded pixels: straight (non-premultiplied) sRGB RGBA, 8 bits per channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Pixels {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl Pixels {
    /// Whether every pixel is fully opaque.
    pub fn is_opaque(&self) -> bool {
        self.rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|pixel| pixel[3] == u8::MAX)
    }
}

#[cfg(test)]
mod tests;
