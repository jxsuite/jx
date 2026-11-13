//! Encoding resized pixels to one output format.

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};
use ravif::{Img, RGBA8};

use crate::{Error, Format, Pixels, Quality, Result};

/// rav1e's speed preset, 1 (slowest) to 10. At 6 the docs corpus encodes about three times faster
/// than libaom at its default effort for the same bytes; below it the size gain is under 15% for
/// roughly half again the time.
const AVIF_SPEED: u8 = 6;

/// Encode `pixels` to `format`.
pub(crate) fn encode(pixels: &Pixels, format: Format, quality: Quality) -> Result<Vec<u8>> {
    let fail = |message: String| Error::Encode {
        format,
        width: pixels.width,
        message,
    };
    match format {
        Format::Avif => avif(pixels, quality.avif).map_err(fail),
        Format::Jpeg => jpeg(pixels, quality.jpeg).map_err(fail),
        Format::Png => png(pixels).map_err(fail),
        Format::Webp => webp(pixels).map_err(fail),
    }
}

fn avif(pixels: &Pixels, quality: u8) -> std::result::Result<Vec<u8>, String> {
    let quality = f32::from(quality.clamp(1, 100));
    let rgba: Vec<RGBA8> = pixels
        .rgba
        .as_chunks::<4>()
        .0
        .iter()
        .map(|p| RGBA8::new(p[0], p[1], p[2], p[3]))
        .collect();
    ravif::Encoder::new()
        .with_quality(quality)
        .with_alpha_quality(quality)
        .with_speed(AVIF_SPEED)
        .encode_rgba(Img::new(
            &rgba[..],
            pixels.width as usize,
            pixels.height as usize,
        ))
        .map(|encoded| encoded.avif_file)
        .map_err(|error| error.to_string())
}

/// Straight RGBA flattened onto white, as RGB. JPEG has no alpha channel, and white is the page
/// colour a transparent image was most likely drawn for.
fn flatten_onto_white(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for pixel in rgba.as_chunks::<4>().0 {
        let alpha = u32::from(pixel[3]);
        for &channel in &pixel[..3] {
            let blended = (u32::from(channel) * alpha + 255 * (255 - alpha) + 127) / 255;
            rgb.push(blended as u8);
        }
    }
    rgb
}

fn jpeg(pixels: &Pixels, quality: u8) -> std::result::Result<Vec<u8>, String> {
    let width = u16::try_from(pixels.width).map_err(|_| "wider than 65535 pixels".to_owned())?;
    let height = u16::try_from(pixels.height).map_err(|_| "taller than 65535 pixels".to_owned())?;
    let mut out = Vec::new();
    let mut encoder = jpeg_encoder::Encoder::new(&mut out, quality.clamp(1, 100));
    encoder.set_progressive(true);
    encoder.set_optimized_huffman_tables(true);
    encoder
        .encode(
            &flatten_onto_white(&pixels.rgba),
            width,
            height,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|error| error.to_string())?;
    Ok(out)
}

fn png(pixels: &Pixels) -> std::result::Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let encoder =
        PngEncoder::new_with_quality(&mut out, CompressionType::Best, FilterType::Adaptive);
    let written = if pixels.is_opaque() {
        let rgb: Vec<u8> = pixels
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
            .collect();
        encoder.write_image(&rgb, pixels.width, pixels.height, ExtendedColorType::Rgb8)
    } else {
        encoder.write_image(
            &pixels.rgba,
            pixels.width,
            pixels.height,
            ExtendedColorType::Rgba8,
        )
    };
    written.map_err(|error| error.to_string())?;
    Ok(out)
}

fn webp(pixels: &Pixels) -> std::result::Result<Vec<u8>, String> {
    let mut out = Vec::new();
    image_webp::WebPEncoder::new(&mut out)
        .encode(
            &pixels.rgba,
            pixels.width,
            pixels.height,
            image_webp::ColorType::Rgba8,
        )
        .map_err(|error| error.to_string())?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::flatten_onto_white;

    #[test]
    fn flattening_keeps_opaque_colour_and_turns_transparent_white() {
        assert_eq!(flatten_onto_white(&[10, 20, 30, 255]), [10, 20, 30]);
        assert_eq!(flatten_onto_white(&[10, 20, 30, 0]), [255, 255, 255]);
        assert_eq!(flatten_onto_white(&[0, 0, 0, 128]), [127, 127, 127]);
    }
}
