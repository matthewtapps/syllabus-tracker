use once_cell::sync::Lazy;
use regex::Regex;

use crate::models::VideoKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedEmbed {
    pub kind: VideoKind,
    pub host: String,
    pub video_id: Option<String>,
    pub canonical_url: String,
}

static YOUTUBE_LONG: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?:youtube\.com/(?:watch\?[^#]*v=|embed/|v/|shorts/))([A-Za-z0-9_-]{6,})")
        .expect("youtube long regex")
});
static YOUTUBE_SHORT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"youtu\.be/([A-Za-z0-9_-]{6,})").expect("youtube short regex"));
static VIMEO: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"vimeo\.com/(?:video/)?(\d{5,})").expect("vimeo regex"));
static DRIVE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"drive\.google\.com/file/d/([A-Za-z0-9_-]+)").expect("drive regex"));

pub fn parse(url: &str) -> ParsedEmbed {
    let trimmed = url.trim();

    if let Some(c) = YOUTUBE_LONG
        .captures(trimmed)
        .or_else(|| YOUTUBE_SHORT.captures(trimmed))
    {
        let id = c.get(1).map(|m| m.as_str().to_string());
        return ParsedEmbed {
            kind: VideoKind::Youtube,
            host: "youtube".to_string(),
            video_id: id,
            canonical_url: trimmed.to_string(),
        };
    }

    if let Some(c) = VIMEO.captures(trimmed) {
        let id = c.get(1).map(|m| m.as_str().to_string());
        return ParsedEmbed {
            kind: VideoKind::Vimeo,
            host: "vimeo".to_string(),
            video_id: id,
            canonical_url: trimmed.to_string(),
        };
    }

    if let Some(c) = DRIVE.captures(trimmed) {
        let id = c.get(1).map(|m| m.as_str().to_string());
        return ParsedEmbed {
            kind: VideoKind::Drive,
            host: "drive".to_string(),
            video_id: id,
            canonical_url: trimmed.to_string(),
        };
    }

    ParsedEmbed {
        kind: VideoKind::Link,
        host: "other".to_string(),
        video_id: None,
        canonical_url: trimmed.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_youtube_long() {
        let p = parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
        assert_eq!(p.kind, VideoKind::Youtube);
        assert_eq!(p.video_id.as_deref(), Some("dQw4w9WgXcQ"));
    }

    #[test]
    fn parses_youtube_short() {
        let p = parse("https://youtu.be/dQw4w9WgXcQ");
        assert_eq!(p.kind, VideoKind::Youtube);
        assert_eq!(p.video_id.as_deref(), Some("dQw4w9WgXcQ"));
    }

    #[test]
    fn parses_vimeo() {
        let p = parse("https://vimeo.com/123456789");
        assert_eq!(p.kind, VideoKind::Vimeo);
        assert_eq!(p.video_id.as_deref(), Some("123456789"));
    }

    #[test]
    fn parses_drive() {
        let p = parse("https://drive.google.com/file/d/abc_123/view?usp=sharing");
        assert_eq!(p.kind, VideoKind::Drive);
        assert_eq!(p.video_id.as_deref(), Some("abc_123"));
    }

    #[test]
    fn falls_back_to_link() {
        let p = parse("https://example.com/some/video");
        assert_eq!(p.kind, VideoKind::Link);
        assert!(p.video_id.is_none());
    }
}
