//! Decode a byte stream as UTF-8 chunk by chunk without breaking characters
//! that straddle two chunks.
//!
//! `String::from_utf8_lossy` on each chunk turns a multi-byte character cut
//! by a chunk boundary into `U+FFFD` replacement characters. Agent output is
//! full of them (Vietnamese text, em dashes), and a damaged copy of a message
//! no longer matched the original, so the chat showed it twice.

/// Keeps the incomplete tail of a chunk and prepends it to the next one.
#[derive(Debug, Default)]
pub struct Utf8ChunkDecoder {
    pending: Vec<u8>,
}

impl Utf8ChunkDecoder {
    /// Decode `chunk`, holding back a character cut at its end. Invalid
    /// bytes still become `U+FFFD`, as with `from_utf8_lossy`.
    pub fn decode(&mut self, chunk: &[u8]) -> String {
        let mut bytes = std::mem::take(&mut self.pending);
        bytes.extend_from_slice(chunk);
        let mut out = String::with_capacity(bytes.len());
        let mut rest: &[u8] = &bytes;
        loop {
            match std::str::from_utf8(rest) {
                Ok(s) => {
                    out.push_str(s);
                    break;
                }
                Err(e) => {
                    let (valid, after) = rest.split_at(e.valid_up_to());
                    // SAFETY-free: `valid` is valid UTF-8 by construction.
                    out.push_str(std::str::from_utf8(valid).unwrap_or_default());
                    match e.error_len() {
                        // Incomplete character at the end: wait for more.
                        None => {
                            self.pending = after.to_vec();
                            break;
                        }
                        Some(len) => {
                            out.push('\u{FFFD}');
                            rest = &after[len..];
                        }
                    }
                }
            }
        }
        out
    }

    /// What is left at the end of the stream (an incomplete character).
    pub fn finish(&mut self) -> String {
        let pending = std::mem::take(&mut self.pending);
        String::from_utf8_lossy(&pending).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_character_split_across_chunks_survives() {
        let text = "HIVE-11 — đã ở In Review";
        let bytes = text.as_bytes();
        // Split inside the em dash (3 bytes) and inside "đ" (2 bytes).
        let dash = text.find('—').unwrap();
        let d = text.find('đ').unwrap();
        let mut dec = Utf8ChunkDecoder::default();
        let mut out = String::new();
        out += &dec.decode(&bytes[..dash + 1]);
        out += &dec.decode(&bytes[dash + 1..d + 1]);
        out += &dec.decode(&bytes[d + 1..]);
        out += &dec.finish();
        assert_eq!(out, text);
    }

    #[test]
    fn every_split_point_round_trips() {
        let text = "Cả 3 card vẫn đang chạy — không agent nào chờ duyệt.";
        let bytes = text.as_bytes();
        for cut in 0..=bytes.len() {
            let mut dec = Utf8ChunkDecoder::default();
            let out = dec.decode(&bytes[..cut]) + &dec.decode(&bytes[cut..]) + &dec.finish();
            assert_eq!(out, text, "cut at {cut}");
        }
    }

    #[test]
    fn invalid_bytes_still_become_replacement_chars() {
        let mut dec = Utf8ChunkDecoder::default();
        assert_eq!(dec.decode(b"a\xffb"), "a\u{FFFD}b");
        assert_eq!(dec.finish(), "");
    }
}
