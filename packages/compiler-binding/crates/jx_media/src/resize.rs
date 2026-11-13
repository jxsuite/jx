//! Downscaling decoded pixels to a variant width.

use fast_image_resize::images::{Image, ImageRef};
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};

use crate::Pixels;

/// The height a `width`-pixel variant of a `source_width` by `source_height` image has.
pub(crate) fn scaled_height(source_width: u32, source_height: u32, width: u32) -> u32 {
    let exact = f64::from(source_height) * f64::from(width) / f64::from(source_width);
    (exact.round() as u32).max(1)
}

/// Resize to `width` pixels wide, keeping the aspect ratio. A request for the source's own width
/// copies the pixels untouched.
///
/// Lanczos3, with colour premultiplied by alpha for the convolution so a transparent pixel's
/// colour cannot bleed into its opaque neighbours.
pub(crate) fn to_width(source: &Pixels, width: u32) -> Pixels {
    if width == source.width {
        return source.clone();
    }
    let height = scaled_height(source.width, source.height, width);
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3));
    let mut destination = Image::new(width, height, PixelType::U8x4);
    // Both constructors and the resize itself fail only on a buffer whose length disagrees with
    // its dimensions or on mismatched pixel types, and `Pixels` upholds both by construction.
    let view = ImageRef::new(source.width, source.height, &source.rgba, PixelType::U8x4)
        .expect("Pixels holds width * height RGBA pixels");
    Resizer::new()
        .resize(&view, &mut destination, &options)
        .expect("source and destination are both U8x4");
    Pixels {
        width,
        height,
        rgba: destination.into_vec(),
    }
}
