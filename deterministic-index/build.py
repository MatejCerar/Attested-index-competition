"""CLI: load a frozen feature matrix + a config, validate, build the index.

    python build.py --matrix example_data/feature_matrix_v1.csv \
                    --config config.yaml --out index_v1.csv

The build itself is pure (see index_builder.build_index). This file only does
I/O and validation - the two things a reproducible core must NOT contain.
"""
from __future__ import annotations

import argparse

import pandas as pd
import yaml

from features import BY_NAME, LABEL, Kind
from index_builder import IndexConfig, build_index


def load_config(path: str) -> IndexConfig:
    with open(path) as fh:
        raw = yaml.safe_load(fh)
    raw["eligible_sectors"] = tuple(raw.get("eligible_sectors", []))
    raw["weights"] = dict(raw["weights"])
    return IndexConfig(**raw)


def validate(matrix: pd.DataFrame, cfg: IndexConfig) -> None:
    """Fail loudly on a bad matrix before we build anything."""
    missing = [c for c in cfg.weights if c not in matrix.columns]
    if missing:
        raise ValueError(f"matrix missing scoring columns: {missing}")
    for col in (cfg.id_col, cfg.sector_col):
        if col not in matrix.columns:
            raise ValueError(f"matrix missing required column: {col!r}")
    # Scoring columns must be numeric.
    for col in cfg.weights:
        if not pd.api.types.is_numeric_dtype(matrix[col]):
            raise ValueError(f"scoring column {col!r} must be numeric")
    # LABEL columns must only contain declared enum values.
    for name in LABEL:
        if name in matrix.columns:
            allowed = set(BY_NAME[name].labels)
            bad = set(matrix[name].dropna()) - allowed
            if bad:
                raise ValueError(f"column {name!r} has values outside its enum: {bad}")
    # SCORE columns must be integers inside their range.
    for name, feat in BY_NAME.items():
        if feat.kind is Kind.SCORE and name in matrix.columns:
            lo, hi = feat.score_range
            s = matrix[name]
            if ((s < lo) | (s > hi)).any():
                raise ValueError(f"score column {name!r} outside range [{lo},{hi}]")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--matrix", required=True)
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--out", default="index.csv")
    args = ap.parse_args()

    cfg = load_config(args.config)
    matrix = pd.read_csv(args.matrix)
    validate(matrix, cfg)

    weights = build_index(matrix, cfg)
    weights.to_csv(args.out, header=["weight"])

    print(f"index v{cfg.version}: {len(weights)} names, sum={weights.sum():.6f}")
    for ticker, w in weights.items():
        print(f"  {ticker:<8} {w*100:6.2f}%")


if __name__ == "__main__":
    main()
