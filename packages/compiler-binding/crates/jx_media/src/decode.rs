//! Reading a source image: its metadata, and its pixels as oriented sRGB RGBA.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use moxcms::{ColorProfile, Layout, TransformOptions};

use crate::{Error, Pixels, Result};

/// A source image's dimensions and format.
///
/// The dimensions are the ones a viewer sees: an EXIF orientation that turns the image on its side
/// has already swapped them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Metadata {
    /// Width in pixels, after orientation.
    pub width: u32,
    /// Height in pixels, after orientation.
    pub height: u32,
    /// The container format's name: `jpeg`, `png`, `webp`, `tiff`, `bmp`.
    pub format: String,
}

type Reader = ImageReader<BufReader<File>>;

fn open(path: &Path) -> Result<(Reader, ImageFormat)> {
    let io = |source| Error::Io {
        path: path.to_owned(),
        source,
    };
    let reader = ImageReader::open(path)
        .map_err(io)?
        .with_guessed_format()
        .map_err(io)?;
    let format = reader.format().ok_or_else(|| Error::Decode {
        path: path.to_owned(),
        message: "not a JPEG, PNG, WebP, TIFF or BMP image".to_owned(),
    })?;
    Ok((reader, format))
}

fn decode_error(path: &Path, error: &image::ImageError) -> Error {
    Error::Decode {
        path: path.to_owned(),
        message: error.to_string(),
    }
}

fn format_name(format: ImageFormat) -> String {
    match format {
        ImageFormat::Jpeg => "jpeg".to_owned(),
        other => other
            .extensions_str()
            .first()
            .copied()
            .unwrap_or("unknown")
            .to_owned(),
    }
}

/// Whether an orientation exchanges width and height.
const fn turns_sideways(orientation: Orientation) -> bool {
    matches!(
        orientation,
        Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH
    )
}

/// Read a source image's oriented dimensions and format without decoding its pixels.
///
/// # Errors
///
/// Returns an [`Error`] when the file cannot be read or is not a decodable image.
pub fn probe(path: &Path) -> Result<Metadata> {
    let (reader, format) = open(path)?;
    let mut decoder = reader.into_decoder().map_err(|e| decode_error(path, &e))?;
    let (mut width, mut height) = decoder.dimensions();
    // A file whose orientation cannot be read is shown as stored, which is what a browser does.
    if turns_sideways(decoder.orientation().unwrap_or(Orientation::NoTransforms)) {
        std::mem::swap(&mut width, &mut height);
    }
    Ok(Metadata {
        width,
        height,
        format: format_name(format),
    })
}

/// Decode a source image to oriented sRGB RGBA.
pub(crate) fn decode(path: &Path) -> Result<Pixels> {
    let (reader, _) = open(path)?;
    let mut decoder = reader.into_decoder().map_err(|e| decode_error(path, &e))?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let profile = decoder.icc_profile().ok().flatten();
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| decode_error(path, &e))?;
    image.apply_orientation(orientation);
    let has_colour = image.color().has_color();
    let buffer = image.into_rgba8();
    let (width, height) = buffer.dimensions();
    let mut rgba = buffer.into_raw();
    if has_colour {
        if let Some(converted) = profile.as_deref().and_then(|icc| to_srgb(&rgba, icc)) {
            rgba = converted;
        }
    }
    Ok(Pixels {
        width,
        height,
        rgba,
    })
}

/// Convert RGBA pixels from an embedded ICC profile to sRGB.
///
/// Returns `None` when the profile is unusable (not an RGB profile, or malformed), in which case
/// the pixels are kept as they are: that is what every browser does with a profile it rejects.
fn to_srgb(rgba: &[u8], icc: &[u8]) -> Option<Vec<u8>> {
    let source = ColorProfile::new_from_slice(icc).ok()?;
    let transform = source
        .create_transform_8bit(
            Layout::Rgba,
            &ColorProfile::new_srgb(),
            Layout::Rgba,
            TransformOptions::default(),
        )
        .ok()?;
    let mut converted = vec![0; rgba.len()];
    transform.transform(rgba, &mut converted).ok()?;
    Some(converted)
}
