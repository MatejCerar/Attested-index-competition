"""Tests for the deterministic core. The headline property: same inputs =>
identical output, regardless of row order."""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from index_builder import IndexConfig, build_index, normalize  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
MATRIX = os.path.join(HERE, "..", "example_data", "feature_matrix_v1.csv")


def cfg(**over) -> IndexConfig:
    base = dict(
        version=1,
        weights={
            "revenue_growth_yoy": 0.2,
            "moat_strength": 0.3,
            "ai_exposure": 0.2,
            "return_on_equity": 0.2,
            "regulatory_risk": -0.1,   # negative: lower is better
        },
        normalization="zscore",
        weighting="score_tilt",
        top_n=8,
        max_weight=0.20,
        sector_cap=0.40,
        eligible_sectors=(
            "information_technology", "health_care", "financials",
            "consumer_discretionary", "consumer_staples",
            "communication_services",
        ),
        min_market_cap_usd=2_000_000_000,
    )
    base.update(over)
    return IndexConfig(**base)


@pytest.fixture
def matrix() -> pd.DataFrame:
    return pd.read_csv(MATRIX)


def test_deterministic_repeat(matrix):
    a = build_index(matrix, cfg())
    b = build_index(matrix, cfg())
    pd.testing.assert_series_equal(a, b)


def test_row_order_independent(matrix):
    a = build_index(matrix, cfg())
    shuffled = matrix.sample(frac=1.0, random_state=7).reset_index(drop=True)
    b = build_index(shuffled, cfg())
    # same names, same weights (order of the Series is by weight desc for both)
    pd.testing.assert_series_equal(a.sort_index(), b.sort_index())


def test_weights_sum_to_one(matrix):
    w = build_index(matrix, cfg())
    assert abs(w.sum() - 1.0) < 1e-9


def test_per_name_cap_respected(matrix):
    c = cfg(max_weight=0.15)
    w = build_index(matrix, c)
    assert (w <= c.max_weight + 1e-9).all()


def test_sector_cap_respected(matrix):
    c = cfg(sector_cap=0.35, top_n=10)
    w = build_index(matrix, c)
    sectors = matrix.set_index("ticker")["sector"]
    by_sector = w.groupby(sectors.reindex(w.index)).sum()
    assert (by_sector <= c.sector_cap + 1e-6).all()


def test_top_n_count(matrix):
    w = build_index(matrix, cfg(top_n=5))
    assert len(w) == 5


def test_eligibility_filters(matrix):
    # energy is excluded and XOM is the only energy name -> never selected
    w = build_index(matrix, cfg(top_n=12, eligible_sectors=("information_technology",)))
    assert "XOM" not in w.index
    # only tech names survive
    tech = set(matrix[matrix.sector == "information_technology"]["ticker"])
    assert set(w.index) <= tech


def test_min_market_cap_filter(matrix):
    w = build_index(matrix, cfg(min_market_cap_usd=1_000_000_000_000, top_n=12))
    caps = matrix.set_index("ticker")["market_cap_usd"]
    assert (caps.reindex(w.index) >= 1_000_000_000_000).all()


def test_negative_weight_direction(matrix):
    """A feature with a negative weight must penalize high raw values. Flip the
    sign of the regulatory_risk weight and the ranking must change accordingly."""
    penalize = build_index(matrix, cfg(weights={"regulatory_risk": -1.0}))
    reward = build_index(matrix, cfg(weights={"regulatory_risk": 1.0}))
    # the top name under "reward high risk" should be a high-risk name; under
    # "penalize" it should not be the same top name.
    assert penalize.index[0] != reward.index[0]


def test_normalize_constant_is_zero():
    s = pd.Series([3.0, 3.0, 3.0])
    for method in ("zscore", "minmax", "rank"):
        out = normalize(s, method)
        assert (out.abs() < 1e-12).all()


def test_winsor_caps_outliers(matrix):
    from index_builder import _prep
    m = matrix.copy()
    m.loc[m["ticker"] == "NVDA", "return_on_equity"] = 100.0  # absurd outlier
    c = cfg(winsor=0.05, weights={"return_on_equity": 1.0})
    prepped = _prep(m["return_on_equity"], c)
    assert prepped.max() < 100.0  # clipped, so the outlier can't dominate


def test_nan_filled_deterministically(matrix):
    from index_builder import _prep
    m = matrix.copy()
    m.loc[m["ticker"] == "V", "gross_margin"] = float("nan")
    out = _prep(m["gross_margin"], cfg())
    assert not out.isna().any()
    w = build_index(m, cfg())  # build still works with a gap present
    assert abs(w.sum() - 1.0) < 1e-9


def test_duplicate_ids_rejected(matrix):
    dup = pd.concat([matrix, matrix.head(1)], ignore_index=True)
    with pytest.raises(ValueError):
        build_index(dup, cfg())


def test_empty_universe_rejected(matrix):
    with pytest.raises(ValueError):
        build_index(matrix, cfg(eligible_sectors=("nonexistent",)))


def test_to_bps_hamilton_properties():
    from index_builder import to_bps
    w = pd.Series([1.0, 1.0, 1.0], index=["b", "a", "c"])
    bps = to_bps(w)
    assert int(bps.sum()) == 10000
    # equal remainders: the single leftover bp goes to the lowest id
    assert bps["a"] == 3334 and bps["b"] == 3333 and bps["c"] == 3333
    exact = to_bps(pd.Series([0.15, 0.25, 0.60], index=["x", "y", "z"]))
    assert list(exact) == [1500, 2500, 6000]


def test_to_bps_matches_committed_golden(matrix):
    """Pin the Python build to the cross-language golden vector. The TS side
    (tee-extension/extension/__tests__/build-index.test.ts) pins the same file,
    so this test passing on both sides = Python == TS at the bps boundary."""
    import json

    from index_builder import to_bps

    golden_path = os.path.join(
        HERE, "..", "..", "tee-extension", "extension", "__tests__",
        "golden_weights.json",
    )
    with open(golden_path) as fh:
        golden = json.load(fh)
    c = IndexConfig(**{**golden["config"],
                       "weights": dict(golden["config"]["weights"]),
                       "eligible_sectors": tuple(golden["config"]["eligible_sectors"])})
    bps = to_bps(build_index(matrix, c))
    items = sorted(bps.items(), key=lambda kv: (-kv[1], kv[0]))
    assert [t for t, _ in items] == golden["tickers"]
    assert [int(b) for _, b in items] == golden["weightsBps"]
