use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

/// Payload sent to the video worker to initiate processing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessJob {
    pub video_id: i64,
    pub source_key: String,
    pub callback_url: String,
}

/// Result POSTed back to the app once the worker finishes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ProcessingResult {
    Ready {
        storage_key: String,
        duration_seconds: i64,
        width: i64,
        height: i64,
        bytes: i64,
    },
    Failed {
        error: String,
    },
}

// ---------------------------------------------------------------------------
// HMAC helpers
// ---------------------------------------------------------------------------

/// Returns `hex(HMAC-SHA256(secret, body))` as a lowercase hex string.
pub fn sign(secret: &[u8], body: &[u8]) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(body);
    let bytes = mac.finalize().into_bytes();
    // Build hex without an extra dependency.
    let mut hex = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        write!(hex, "{b:02x}").unwrap();
    }
    hex
}

/// Constant-time comparison of `sig_hex` against the HMAC-SHA256 of `body`.
///
/// Returns `false` whenever the lengths differ (no early-return on content —
/// the length guard is done before the byte-level comparison, but `subtle`
/// ensures the byte comparison itself is constant-time). Unequal lengths
/// trivially cannot match, so returning `false` immediately is safe here.
pub fn verify(secret: &[u8], body: &[u8], sig_hex: &str) -> bool {
    let expected = sign(secret, body);
    // Constant-time byte comparison via subtle.  If lengths differ they cannot
    // be equal; we still return false without leaking content information.
    if expected.len() != sig_hex.len() {
        return false;
    }
    expected.as_bytes().ct_eq(sig_hex.as_bytes()).into()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_verify_roundtrip() {
        let body = br#"{"status":"ready"}"#;
        let sig = sign(b"secret", body);
        assert!(verify(b"secret", body, &sig));
    }

    #[test]
    fn verify_rejects_tampered_body() {
        let sig = sign(b"secret", b"a");
        assert!(!verify(b"secret", b"b", &sig));
    }

    #[test]
    fn verify_rejects_wrong_secret() {
        let sig = sign(b"secret", b"a");
        assert!(!verify(b"other", b"a", &sig));
    }
}
