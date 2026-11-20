//! Picks output resolution and bitrate so a video lands under a size limit.
//! Mirrors `plan()` in the page so the table preview matches what is encoded.

use serde::Deserialize;

/// Output heights tried from best to worst, with the minimum and maximum
/// H.265 video bitrate (kbps) that makes sense at each height.
const TIER_HEIGHT: [u32; 5] = [1080, 720, 480, 360, 240];
const TIER_MIN_KBPS: [u32; 5] = [2500, 700, 250, 90, 25];
const TIER_CAP_KBPS: [u32; 5] = [6000, 2000, 900, 400, 150];
/// H.264 needs roughly this much more bitrate for the same quality.
const X264_MULTIPLIER: f64 = 1.7;
/// Keep 5% headroom for container overhead and rate-control drift.
const SIZE_SAFETY: f64 = 0.95;
const KBITS_PER_MB: f64 = 8000.0;
/// MP4 indexing/packet overhead (~4.5 kbps measured at 12 fps + mono AAC).
/// Negligible at normal rates but decisive for very long videos at low limits.
pub const MUX_OVERHEAD_KBPS: i64 = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Codec {
    X265,
    X264,
}

impl Codec {
    pub fn encoder(self) -> &'static str {
        match self {
            Codec::X265 => "libx265",
            Codec::X264 => "libx264",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Codec::X265 => "x265",
            Codec::X264 => "x264",
        }
    }

    fn multiplier(self) -> f64 {
        match self {
            Codec::X265 => 1.0,
            Codec::X264 => X264_MULTIPLIER,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    /// Target length of the short side, in pixels.
    pub height: u32,
    pub video_kbps: u32,
}

/// Returns `None` when even the lowest tier cannot fit the duration into the limit.
pub fn make_plan(duration_s: f64, target_mb: u32, audio_kbps: u32, codec: Codec) -> Option<Plan> {
    let duration = duration_s.max(1.0);
    let total_kbps = (f64::from(target_mb) * SIZE_SAFETY * KBITS_PER_MB / duration).floor() as i64;
    let video_kbps = total_kbps - i64::from(audio_kbps) - MUX_OVERHEAD_KBPS;
    let mult = codec.multiplier();

    (0..TIER_HEIGHT.len()).find_map(|i| {
        if (video_kbps as f64) < f64::from(TIER_MIN_KBPS[i]) * mult {
            return None;
        }
        let cap = (f64::from(TIER_CAP_KBPS[i]) * mult).floor() as i64;
        Some(Plan { height: TIER_HEIGHT[i], video_kbps: video_kbps.min(cap) as u32 })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_video_gets_1080p_capped_bitrate() {
        let p = make_plan(60.0, 250, 28, Codec::X265).unwrap();
        assert_eq!(p, Plan { height: 1080, video_kbps: 6000 });
    }

    #[test]
    fn one_hour_at_250mb_drops_to_480p() {
        // 250 * 0.95 * 8000 / 3600 = 527 kbps total, 527 - 28 - 6 = 493 video -> 480p tier.
        let p = make_plan(3600.0, 250, 28, Codec::X265).unwrap();
        assert_eq!(p, Plan { height: 480, video_kbps: 493 });
    }

    #[test]
    fn x264_needs_more_bitrate_per_tier() {
        // 25 min at 250 MB: 1266 kbps total, 1232 video; x264 needs 700*1.7 = 1190 for 720p.
        let p = make_plan(1500.0, 250, 28, Codec::X264).unwrap();
        assert_eq!(p, Plan { height: 720, video_kbps: 1232 });
        // 30 min: 1055 total, 1021 video: enough for x265 720p (700) but not x264 720p (1190).
        assert_eq!(make_plan(1800.0, 250, 28, Codec::X265).unwrap().height, 720);
        assert_eq!(make_plan(1800.0, 250, 28, Codec::X264).unwrap().height, 480);
    }

    #[test]
    fn far_too_long_video_has_no_plan() {
        assert_eq!(make_plan(10.0 * 3600.0, 50, 28, Codec::X265), None);
    }

    #[test]
    fn zero_duration_is_treated_as_one_second() {
        assert!(make_plan(0.0, 50, 28, Codec::X265).is_some());
    }
}
