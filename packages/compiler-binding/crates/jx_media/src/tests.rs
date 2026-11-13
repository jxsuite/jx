use std::path::{Path, PathBuf};

use image::{ImageBuffer, Rgb, Rgba};
use moxcms::ColorProfile;
use tempfile::TempDir;

use super::*;

/// A 64x32 PNG whose left half is opaque and whose right half is transparent.
fn write_png(dir: &Path, name: &str, width: u32, height: u32) -> PathBuf {
    let path = dir.join(name);
    ImageBuffer::from_fn(width, height, |x, y| {
        let alpha = if x < width / 2 { 255 } else { 0 };
        Rgba([(x * 255 / width) as u8, (y * 255 / height) as u8, 96, alpha])
    })
    .save(&path)
    .unwrap();
    path
}

/// A JPEG with an optional EXIF orientation and an optional ICC profile.
fn write_jpeg(dir: &Path, name: &str, orientation: Option<u8>, icc: Option<&[u8]>) -> PathBuf {
    let (width, height) = (40u16, 20u16);
    let rgb: Vec<u8> = (0..u32::from(width) * u32::from(height))
        .flat_map(|i| [(i % 251) as u8, 200, 30])
        .collect();
    let path = dir.join(name);
    let mut encoder = jpeg_encoder::Encoder::new_file(&path, 90).unwrap();
    if let Some(value) = orientation {
        // "Exif\0\0", a little-endian TIFF header, and one IFD entry: tag 0x0112 (Orientation).
        let mut exif = b"Exif\0\0II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
        exif.extend([value, 0, 0, 0, 0, 0, 0, 0]);
        encoder.add_app_segment(1, exif).unwrap();
    }
    if let Some(profile) = icc {
        encoder.add_icc_profile(profile).unwrap();
    }
    encoder
        .encode(&rgb, width, height, jpeg_encoder::ColorType::Rgb)
        .unwrap();
    path
}

fn request(source: PathBuf, out: &TempDir, formats: &[Format]) -> Request {
    Request {
        source,
        out_dir: out.path().join("nested/_optimized"),
        stem: "hero".to_owned(),
        hash: "abcd1234".to_owned(),
        widths: vec![16, 32, 128],
        formats: formats.to_vec(),
        quality: Quality::default(),
    }
}

#[test]
fn the_ladder_is_capped_at_the_source_and_offers_a_narrow_source_natively() {
    assert_eq!(ladder(1000, &[320, 640, 1280]), [320, 640, 1000]);
    assert_eq!(ladder(640, &[320, 640, 1280]), [320, 640]);
    assert_eq!(ladder(100, &[320, 640]), [100]);
}

#[test]
fn a_source_wider_than_the_top_rung_stops_at_the_top_rung() {
    assert_eq!(ladder(3840, &[640, 320, 1920]), [320, 640, 1920]);
}

#[test]
fn an_empty_or_zero_ladder_yields_the_native_width() {
    assert_eq!(ladder(500, &[]), [500]);
    assert_eq!(ladder(500, &[0]), [500]);
}

#[test]
fn formats_parse_by_name_and_print_as_their_extension() {
    for (name, format) in [
        ("avif", Format::Avif),
        ("jpeg", Format::Jpeg),
        ("png", Format::Png),
        ("webp", Format::Webp),
    ] {
        assert_eq!(name.parse::<Format>().unwrap(), format);
        assert_eq!(format.to_string(), name);
    }
    assert_eq!("jpg".parse::<Format>().unwrap(), Format::Jpeg);
    let error = "heic".parse::<Format>().unwrap_err();
    assert!(error
        .to_string()
        .contains("unsupported output format \"heic\""));
}

#[test]
fn a_variant_is_named_stem_width_hash_format() {
    assert_eq!(
        variant_file_name("a b", 640, "deadbeef", Format::Avif),
        "a b-640-deadbeef.avif"
    );
}

#[test]
fn every_width_and_format_is_written_and_decodes_at_its_size() {
    let dir = TempDir::new().unwrap();
    let formats = [Format::Avif, Format::Jpeg, Format::Png, Format::Webp];
    let source = dir.path().join("hero.png");
    ImageBuffer::from_fn(64, 32, |x, y| Rgb([(x * 4) as u8, (y * 8) as u8, 96]))
        .save(&source)
        .unwrap();
    let request = request(source, &dir, &formats);
    let manifest = process(&request).unwrap();

    assert_eq!(
        manifest.original,
        Metadata {
            width: 64,
            height: 32,
            format: "png".to_owned()
        }
    );
    let named: Vec<(u32, Format)> = manifest
        .variants
        .iter()
        .map(|v| (v.width, v.format))
        .collect();
    let expected: Vec<(u32, Format)> = [16, 32, 64]
        .iter()
        .flat_map(|w| formats.iter().map(move |f| (*w, *f)))
        .collect();
    assert_eq!(named, expected);

    for variant in &manifest.variants {
        let path = request.out_dir.join(&variant.file_name);
        let bytes = std::fs::read(&path).unwrap();
        if variant.format == Format::Avif {
            assert_eq!(&bytes[4..12], b"ftypavif", "{}", variant.file_name);
            continue;
        }
        let decoded = image::open(&path).unwrap();
        assert_eq!(
            (decoded.width(), decoded.height()),
            (variant.width, variant.width / 2)
        );
    }
    let leftovers = std::fs::read_dir(&request.out_dir).unwrap().count();
    assert_eq!(
        leftovers,
        manifest.variants.len(),
        "no temporary file is left behind"
    );
}

#[test]
fn transparency_survives_png_and_webp_and_jpeg_becomes_png() {
    let dir = TempDir::new().unwrap();
    let mut request = request(
        write_png(dir.path(), "hero.png", 64, 32),
        &dir,
        &[Format::Webp, Format::Jpeg, Format::Png],
    );
    request.widths = vec![64];
    let manifest = process(&request).unwrap();
    let written: Vec<Format> = manifest.variants.iter().map(|v| v.format).collect();
    assert_eq!(
        written,
        [Format::Webp, Format::Png],
        "PNG stands in for JPEG, once"
    );
    assert!(!request.out_dir.join("hero-64-abcd1234.jpeg").exists());
    for variant in &manifest.variants {
        let decoded = image::open(request.out_dir.join(&variant.file_name)).unwrap();
        assert_eq!(
            decoded.to_rgba8().get_pixel(60, 16)[3],
            0,
            "{}",
            variant.file_name
        );
    }
    // A second call finds every file and encodes nothing, and still names PNG.
    assert_eq!(process(&request).unwrap(), manifest);
}

#[test]
fn an_opaque_source_keeps_jpeg() {
    let dir = TempDir::new().unwrap();
    let mut request = request(
        write_jpeg(dir.path(), "photo.jpg", None, None),
        &dir,
        &[Format::Jpeg],
    );
    request.widths = vec![20];
    let manifest = process(&request).unwrap();
    assert_eq!(manifest.variants[0].format, Format::Jpeg);
    assert_eq!(process(&request).unwrap(), manifest);
}

#[test]
fn an_opaque_source_is_written_as_rgb_png() {
    let dir = TempDir::new().unwrap();
    let source = dir.path().join("flat.png");
    ImageBuffer::from_pixel(8, 8, Rgb([1u8, 2, 3]))
        .save(&source)
        .unwrap();
    let mut request = request(source, &dir, &[Format::Png]);
    request.widths = vec![4];
    let manifest = process(&request).unwrap();
    let decoded = image::open(request.out_dir.join(&manifest.variants[0].file_name)).unwrap();
    assert_eq!(decoded.color(), image::ColorType::Rgb8);
}

#[test]
fn an_existing_variant_is_kept_and_a_complete_set_skips_the_decode() {
    let dir = TempDir::new().unwrap();
    let mut request = request(
        write_png(dir.path(), "hero.png", 64, 32),
        &dir,
        &[Format::Png],
    );
    std::fs::create_dir_all(&request.out_dir).unwrap();
    let planted = request.out_dir.join("hero-16-abcd1234.png");
    std::fs::write(&planted, b"planted").unwrap();

    process(&request).unwrap();
    assert_eq!(std::fs::read(&planted).unwrap(), b"planted");
    assert!(request.out_dir.join("hero-32-abcd1234.png").exists());

    // With every variant present only the header is read, so corrupt pixel data goes unnoticed.
    let mut bytes = std::fs::read(&request.source).unwrap();
    let length = bytes.len();
    bytes.truncate(length / 2);
    std::fs::write(&request.source, bytes).unwrap();
    assert_eq!(process(&request).unwrap().variants.len(), 3);
    request.hash = "ffff0000".to_owned();
    assert!(matches!(process(&request), Err(Error::Decode { .. })));
}

#[test]
fn an_exif_orientation_turns_the_reported_size_and_the_pixels() {
    let dir = TempDir::new().unwrap();
    let upright = probe(&write_jpeg(dir.path(), "upright.jpg", Some(1), None)).unwrap();
    assert_eq!(
        (upright.width, upright.height, upright.format.as_str()),
        (40, 20, "jpeg")
    );

    for orientation in [5, 6, 7, 8] {
        let source = write_jpeg(dir.path(), "turned.jpg", Some(orientation), None);
        let turned = probe(&source).unwrap();
        assert_eq!(
            (turned.width, turned.height),
            (20, 40),
            "orientation {orientation}"
        );
    }

    let mut request = request(
        write_jpeg(dir.path(), "turned.jpg", Some(6), None),
        &dir,
        &[Format::Jpeg],
    );
    request.widths = vec![10];
    let manifest = process(&request).unwrap();
    let decoded = image::open(request.out_dir.join(&manifest.variants[0].file_name)).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (10, 20));
}

#[test]
fn an_embedded_profile_is_converted_and_an_unusable_one_is_ignored() {
    let dir = TempDir::new().unwrap();
    let p3 = ColorProfile::new_display_p3().encode().unwrap();
    let centre = |name: &str, icc: Option<&[u8]>| {
        let mut request = request(
            write_jpeg(dir.path(), name, None, icc),
            &dir,
            &[Format::Png],
        );
        request.stem = name.to_owned();
        request.widths = vec![40];
        let manifest = process(&request).unwrap();
        let path = request.out_dir.join(&manifest.variants[0].file_name);
        *image::open(path).unwrap().to_rgb8().get_pixel(20, 10)
    };
    let untagged = centre("untagged.jpg", None);
    let converted = centre("p3.jpg", Some(&p3));
    assert_ne!(
        untagged, converted,
        "Display P3 pixels move when mapped into sRGB"
    );
    assert_eq!(centre("garbage.jpg", Some(b"not an icc profile")), untagged);
}

#[test]
fn a_file_that_is_not_an_image_or_does_not_exist_is_an_error_naming_it() {
    let dir = TempDir::new().unwrap();
    let text = dir.path().join("notes.png");
    std::fs::write(&text, "plain text").unwrap();
    let error = probe(&text).unwrap_err();
    assert!(matches!(error, Error::Decode { .. }), "{error}");
    assert!(error.to_string().contains("notes.png"));

    let missing = probe(&dir.path().join("absent.png")).unwrap_err();
    assert!(matches!(missing, Error::Io { .. }), "{missing}");
}

#[test]
fn an_unwritable_output_directory_and_an_oversized_jpeg_are_errors() {
    let dir = TempDir::new().unwrap();
    let source = write_png(dir.path(), "hero.png", 64, 32);
    let mut blocked = request(source, &dir, &[Format::Png]);
    std::fs::write(dir.path().join("file"), "").unwrap();
    blocked.out_dir = dir.path().join("file/inside");
    assert!(matches!(process(&blocked), Err(Error::Io { .. })));

    let wide = Pixels {
        width: 70_000,
        height: 1,
        rgba: vec![255; 70_000 * 4],
    };
    let error = encode::encode(&wide, Format::Jpeg, Quality::default()).unwrap_err();
    assert_eq!(
        error.to_string(),
        "cannot encode jpeg at 70000px: wider than 65535 pixels"
    );
}

#[test]
fn a_one_pixel_tall_result_never_rounds_to_zero() {
    assert_eq!(resize::scaled_height(1000, 1, 10), 1);
    assert_eq!(resize::scaled_height(64, 32, 16), 8);
}
