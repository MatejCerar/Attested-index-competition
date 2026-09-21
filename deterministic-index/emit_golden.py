"""Emit the golden cross-language parity vector.

Runs the Python builder on example_data/feature_matrix_v1.csv + config.yaml,
quantizes with to_bps (largest-remainder), and writes the canonical result
(bps desc, ticker asc) plus the exact config used to
tee-extension/extension/__tests__/golden_weights.json. The TS parity test
re-runs build-index.ts on the same csv + this config and must match exactly.

    python emit_golden.py
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict

import pandas as pd
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from index_builder import IndexConfig, build_index, to_bps  # noqa: E402

MATRIX = os.path.join(HERE, "example_data", "feature_matrix_v1.csv")
CONFIG = os.path.join(HERE, "config.yaml")
GOLDEN = os.path.join(
    HERE, "..", "tee-extension", "extension", "__tests__", "golden_weights.json"
)

# Scoring-sensitive variants: loose caps + small top_n so the normalization
# pipeline (not the caps) determines the output. Covers all three norms.
VARIANTS = [
    {"top_n": 6, "max_weight": 0.5, "sector_cap": 1.0},
    {"top_n": 6, "max_weight": 0.5, "sector_cap": 1.0, "normalization": "rank"},
    {"top_n": 6, "max_weight": 0.5, "sector_cap": 1.0, "normalization": "minmax"},
    {"top_n": 6, "max_weight": 0.5, "sector_cap": 1.0, "winsor": 0.0},
    {"top_n": 8, "max_weight": 0.2, "sector_cap": 0.35, "weighting": "equal"},
]


def canonical(bps) -> tuple[list[str], list[int]]:
    items = sorted(bps.items(), key=lambda kv: (-kv[1], kv[0]))
    return [t for t, _ in items], [int(b) for _, b in items]


def main() -> None:
    with open(CONFIG) as fh:
        raw = yaml.safe_load(fh)
    raw["eligible_sectors"] = tuple(raw.get("eligible_sectors", []))
    cfg = IndexConfig(**raw)

    matrix = pd.read_csv(MATRIX)
    bps = to_bps(build_index(matrix, cfg))
    assert int(bps.sum()) == 10000, f"bps sum {bps.sum()} != 10000"
    tickers, weights_bps = canonical(bps)

    variants = []
    for over in VARIANTS:
        vcfg = IndexConfig(**{**asdict(cfg), **over})
        vt, vb = canonical(to_bps(build_index(matrix, vcfg)))
        assert sum(vb) == 10000
        variants.append({"overrides": over, "tickers": vt, "weightsBps": vb})

    cfg_dict = asdict(cfg)
    cfg_dict["eligible_sectors"] = list(cfg_dict["eligible_sectors"])
    golden = {
        "matrix": "deterministic-index/example_data/feature_matrix_v1.csv",
        "config": cfg_dict,
        "tickers": tickers,
        "weightsBps": weights_bps,
        "variants": variants,
    }
    with open(GOLDEN, "w") as fh:
        json.dump(golden, fh, indent=2)
        fh.write("\n")

    print(f"wrote {os.path.normpath(GOLDEN)}")
    for t, b in zip(tickers, weights_bps):
        print(f"  {t:<8} {b:>5} bps")
    for v in variants:
        print(f"  variant {v['overrides']}: {dict(zip(v['tickers'], v['weightsBps']))}")


if __name__ == "__main__":
    main()
