//! Dump statistics() output as a stable fingerprint, for before/after comparison.
//!
//! Used to prove a refactor of the aggregation returns byte-identical results on
//! a real archive, not just on the synthetic test fixture.
use minechronicle_lib::database::{
    activity::{StatisticsFilter, StatisticsPage},
    Repository,
};
use std::time::Instant;

fn fingerprint(page: &StatisticsPage) -> String {
    let mut out = String::new();
    for (key, value) in &page.counters {
        out.push_str(&format!("counter {key}={value}\n"));
    }
    for category in &page.categories {
        out.push_str(&format!(
            "category {}|{}|{}\n",
            category.id, category.label, category.count
        ));
    }
    out.push_str(&format!(
        "meta total={} sources={} unavailable={} page_size={}\n",
        page.total, page.sources, page.unavailable, page.page_size
    ));
    for row in &page.rows {
        out.push_str(&format!(
            "row {}|{}|{}|{}|{}|{}|{}|{}|{}\n",
            row.category,
            row.key,
            row.category_label,
            row.label.as_deref().unwrap_or("-"),
            row.unit,
            row.value.as_deref().unwrap_or("-"),
            row.sources,
            row.source_packs.join("+"),
            row.samples.join("~")
        ));
        for resource in &row.resources {
            out.push_str(&format!(
                "  res {}|{}|{}|{}|{}\n",
                resource.packs.join("+"),
                resource.label.as_deref().unwrap_or("-"),
                resource.english.as_deref().unwrap_or("-"),
                resource.origin,
                resource.translation_source.as_deref().unwrap_or("-")
            ));
        }
    }
    out
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: dump_statistics <db>")?;
    let repo = Repository::open(std::path::Path::new(&path))?;

    let mut all = String::new();
    let mut calls = 0u32;
    let started = Instant::now();
    // Cover every combination that could be affected by reordering.
    for mode in ["current", "initial"] {
        for sort in ["default", "value_desc", "value_asc"] {
            for group in ["all", "mined", "crafted", "custom", "other", "killed"] {
                for offset in [0u32, 100, 5000] {
                    let filter = StatisticsFilter {
                        mode: mode.into(),
                        sort: sort.into(),
                        group: group.into(),
                        offset,
                        ..Default::default()
                    };
                    let page = repo.statistics(&filter)?;
                    all.push_str(&format!("=== {mode}/{sort}/{group}/{offset}\n"));
                    all.push_str(&fingerprint(&page));
                    calls += 1;
                }
            }
        }
    }
    // And a search, which takes the enrich-before-filter path.
    for query in ["stone", "钻石", "play_time", "zzz-no-match"] {
        let filter = StatisticsFilter {
            mode: "current".into(),
            query: query.into(),
            ..Default::default()
        };
        let page = repo.statistics(&filter)?;
        all.push_str(&format!("=== search:{query}\n"));
        all.push_str(&fingerprint(&page));
        calls += 1;
    }

    println!(
        "calls: {calls} in {:.1} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
    println!("bytes: {}", all.len());
    println!("SHA256: {}", sha256_hex(all.as_bytes()));
    Ok(())
}

/// Minimal SHA-256 so this example needs no extra dependency.
fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut message = data.to_vec();
    let bit_len = (data.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in message.chunks(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut v = h;
        for i in 0..64 {
            let s1 = v[4].rotate_right(6) ^ v[4].rotate_right(11) ^ v[4].rotate_right(25);
            let ch = (v[4] & v[5]) ^ (!v[4] & v[6]);
            let t1 = v[7]
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = v[0].rotate_right(2) ^ v[0].rotate_right(13) ^ v[0].rotate_right(22);
            let maj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]);
            let t2 = s0.wrapping_add(maj);
            v = [
                t1.wrapping_add(t2),
                v[0],
                v[1],
                v[2],
                v[3].wrapping_add(t1),
                v[4],
                v[5],
                v[6],
            ];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(v[i]);
        }
    }
    h.iter().map(|word| format!("{word:08x}")).collect()
}
