"""Deterministic index construction.

This is the important part: given a FROZEN feature matrix (companies x features,
all numeric/encoded) and a versioned config, it produces the same tickers and
weights every single time. There is no I/O, no randomness, and no datetime in
here - it is a pure function of (matrix, config). All AI/LLM work happens
upstream and is frozen into the matrix before it ever reaches this module.

Pipeline:  eligibility filter -> normalize -> weighted composite score ->
           deterministic top-N selection -> weighting with per-name & sector caps.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class IndexConfig:
    """Everything that defines the index, versioned. Same config + same matrix
    => same index. Signed weights: positive = higher raw value is better,
    negative = lower is better (e.g. leverage, regulatory risk)."""

    version: int
    weights: dict[str, float]           # scoring feature -> signed weight
    normalization: str = "zscore"       # "zscore" | "rank" | "minmax"
    winsor: float = 0.0                 # clip each feature to [q, 1-q] pre-norm
    top_n: int = 20
    max_weight: float = 0.10            # per-name cap
    sector_cap: float = 0.30            # per-sector cap
    weighting: str = "score_tilt"       # "equal" | "score_tilt"
    eligible_sectors: tuple[str, ...] = ()   # empty = all sectors allowed
    min_market_cap_usd: float = 0.0
    id_col: str = "ticker"
    sector_col: str = "sector"
    market_cap_col: str = "market_cap_usd"


# --------------------------------------------------------------------------
# Normalization - each is deterministic and returns 0 for a constant column.
# --------------------------------------------------------------------------
def normalize(series: pd.Series, method: str) -> pd.Series:
    x = series.astype(float)
    if method == "zscore":
        sd = x.std(ddof=0)
        return (x - x.mean()) / sd if sd > 0 else pd.Series(0.0, index=x.index)
    if method == "minmax":
        rng = x.max() - x.min()
        return (x - x.min()) / rng if rng > 0 else pd.Series(0.0, index=x.index)
    if method == "rank":
        r = x.rank(method="average")  # average handles ties deterministically
        rng = r.max() - r.min()
        return (r - r.min()) / rng if rng > 0 else pd.Series(0.0, index=x.index)
    raise ValueError(f"unknown normalization method: {method!r}")


# --------------------------------------------------------------------------
# Stage 1: eligibility (uses the label columns + numeric thresholds).
# --------------------------------------------------------------------------
def eligible(matrix: pd.DataFrame, cfg: IndexConfig) -> pd.DataFrame:
    ok = pd.Series(True, index=matrix.index)
    if cfg.eligible_sectors:
        ok &= matrix[cfg.sector_col].isin(cfg.eligible_sectors)
    if cfg.market_cap_col in matrix.columns and cfg.min_market_cap_usd > 0:
        ok &= matrix[cfg.market_cap_col].astype(float) >= cfg.min_market_cap_usd
    return matrix[ok].copy()


# --------------------------------------------------------------------------
# Stage 2: composite score = sum of signed-weighted, normalized features.
# Each feature is cleaned first (deterministic median-fill for gaps, optional
# winsorize) so a single distorted or missing value can't dominate the z-score.
# --------------------------------------------------------------------------
def _prep(series: pd.Series, cfg: IndexConfig) -> pd.Series:
    x = series.astype(float)
    if x.isna().any():
        x = x.fillna(x.median())              # deterministic gap fill
    if cfg.winsor and cfg.winsor > 0:
        lo, hi = x.quantile(cfg.winsor), x.quantile(1.0 - cfg.winsor)
        x = x.clip(lower=lo, upper=hi)         # tame outliers
    return x


def composite_score(matrix: pd.DataFrame, cfg: IndexConfig) -> pd.Series:
    score = pd.Series(0.0, index=matrix.index)
    for feat, w in cfg.weights.items():
        if feat not in matrix.columns:
            raise KeyError(f"scoring feature {feat!r} missing from feature matrix")
        score = score + w * normalize(_prep(matrix[feat], cfg), cfg.normalization)
    return score


# --------------------------------------------------------------------------
# Stage 3: deterministic top-N. Ties broken by id (alphabetical) so the set
# is stable and reproducible regardless of input row order.
# --------------------------------------------------------------------------
def select(matrix: pd.DataFrame, score: pd.Series, cfg: IndexConfig) -> pd.DataFrame:
    df = matrix.copy()
    df["_score"] = score
    df = df.sort_values(
        ["_score", cfg.id_col], ascending=[False, True], kind="mergesort"
    )
    return df.head(cfg.top_n).copy()


# --------------------------------------------------------------------------
# Stage 4: weighting + caps. Iterative water-filling that respects the
# per-name and per-sector caps and always sums to 1. Deterministic.
# --------------------------------------------------------------------------
def _apply_caps(
    raw: pd.Series, sectors: pd.Series, cfg: IndexConfig, iters: int = 500
) -> pd.Series:
    w = raw / raw.sum()
    for _ in range(iters):
        prev = w.copy()
        w = w.clip(upper=cfg.max_weight)                    # per-name cap
        for sec in sectors.unique():                        # per-sector cap
            idx = sectors[sectors == sec].index
            sw = w[idx].sum()
            if sw > cfg.sector_cap and sw > 0:
                w[idx] = w[idx] * (cfg.sector_cap / sw)
        deficit = 1.0 - w.sum()
        headroom = (cfg.max_weight - w).clip(lower=0.0)
        if deficit > 1e-12 and headroom.sum() > 0:
            w = w + deficit * headroom / headroom.sum()     # redistribute
        elif abs(deficit) > 1e-12:
            w = w / w.sum()
        if (w - prev).abs().max() < 1e-12:
            break
    return w / w.sum()


def assign_weights(selected: pd.DataFrame, cfg: IndexConfig) -> pd.Series:
    if cfg.weighting == "equal":
        raw = pd.Series(1.0, index=selected.index)
    elif cfg.weighting == "score_tilt":
        s = selected["_score"]
        raw = s - s.min() + 1e-9   # shift to positive so higher score -> more weight
    else:
        raise ValueError(f"unknown weighting: {cfg.weighting!r}")
    return _apply_caps(raw, selected[cfg.sector_col], cfg)


# --------------------------------------------------------------------------
# Canonical bps quantizer - the cross-language boundary. Largest-remainder
# (Hamilton): floor every weight*total, then hand the leftover units to the
# largest fractional remainders, ties broken by id ascending. The TS port
# (tee-extension/extension/build-index.ts, weightsToBps) implements the
# identical rule; the golden parity test pins them to each other.
# --------------------------------------------------------------------------
def to_bps(weights: pd.Series, total: int = 10000) -> pd.Series:
    s = float(weights.sum())
    ids = [str(i) for i in weights.index]
    exact = [float(w) / s * total for w in weights]
    floors = [math.floor(e) for e in exact]
    leftover = total - sum(floors)
    order = sorted(
        range(len(ids)), key=lambda i: (-(exact[i] - floors[i]), ids[i])
    )
    for i in order[:leftover]:
        floors[i] += 1
    return pd.Series(floors, index=weights.index, name="weight_bps", dtype=int)


# --------------------------------------------------------------------------
# The public entry point. Pure function: (matrix, cfg) -> {ticker: weight}.
# --------------------------------------------------------------------------
def build_index(matrix: pd.DataFrame, cfg: IndexConfig) -> pd.Series:
    if matrix[cfg.id_col].duplicated().any():
        raise ValueError("duplicate ids in feature matrix")
    elig = eligible(matrix, cfg)
    if len(elig) == 0:
        raise ValueError("no companies pass the eligibility filter")
    score = composite_score(elig, cfg)
    selected = select(elig, score, cfg)
    weights = assign_weights(selected, cfg)
    out = pd.Series(weights.values, index=selected[cfg.id_col].values, name="weight")
    return out.sort_values(ascending=False)
