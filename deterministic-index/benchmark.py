"""Benchmark the deterministic index against the actual market.

Compares three portfolios over the same eligible universe:
  - MODEL   : our deterministic index (build_index)
  - MARKET  : top-N by market cap, cap-weighted (a mini large-cap index proxy)
  - EQUAL   : top-N by our score, equal-weighted (isolates the weighting effect)

Reports concentration, sector exposure, and factor tilts, so you can see exactly
HOW the model bets differ from just owning the market.

    python benchmark.py --matrix data/companies.csv --config config.yaml
"""
from __future__ import annotations

import argparse

import pandas as pd

from build import load_config, validate
from index_builder import IndexConfig, build_index, composite_score, eligible, select

FACTORS = [
    "pe_forward", "fcf_yield", "revenue_growth_yoy", "return_on_equity",
    "net_debt_to_ebitda", "momentum_12m", "volatility_90d",
    "moat_strength", "ai_exposure", "regulatory_risk",
]


def market_capweight(matrix: pd.DataFrame, cfg: IndexConfig) -> pd.Series:
    elig = eligible(matrix, cfg)
    top = elig.sort_values(cfg.market_cap_col, ascending=False).head(cfg.top_n)
    w = top[cfg.market_cap_col] / top[cfg.market_cap_col].sum()
    return pd.Series(w.values, index=top[cfg.id_col].values).sort_values(ascending=False)


def score_equalweight(matrix: pd.DataFrame, cfg: IndexConfig) -> pd.Series:
    elig = eligible(matrix, cfg)
    sel = select(elig, composite_score(elig, cfg), cfg)
    w = pd.Series(1.0 / len(sel), index=sel[cfg.id_col].values)
    return w


def concentration(w: pd.Series) -> dict:
    return {"names": len(w), "top5_%": w.sort_values(ascending=False).head(5).sum() * 100,
            "hhi": (w ** 2).sum()}


def sector_weights(w: pd.Series, matrix: pd.DataFrame, cfg: IndexConfig) -> pd.Series:
    sec = matrix.set_index(cfg.id_col)[cfg.sector_col].reindex(w.index)
    return w.groupby(sec).sum().sort_values(ascending=False)


def factor_exposure(w: pd.Series, matrix: pd.DataFrame, cfg: IndexConfig) -> pd.Series:
    m = matrix.set_index(cfg.id_col).reindex(w.index)
    return pd.Series({f: float((w * m[f]).sum()) for f in FACTORS})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--matrix", required=True)
    ap.add_argument("--config", default="config.yaml")
    args = ap.parse_args()

    cfg = load_config(args.config)
    matrix = pd.read_csv(args.matrix)
    validate(matrix, cfg)

    ports = {
        "MODEL": build_index(matrix, cfg),
        "MARKET": market_capweight(matrix, cfg),
        "EQUAL": score_equalweight(matrix, cfg),
    }

    print(f"Universe: {len(eligible(matrix, cfg))} eligible / {len(matrix)} total\n")

    print("Concentration")
    print(f"  {'':8} {'names':>6} {'top5%':>7} {'HHI':>7}")
    for name, w in ports.items():
        c = concentration(w)
        print(f"  {name:8} {c['names']:6d} {c['top5_%']:6.1f}% {c['hhi']:7.3f}")

    print("\nSector weights (%)")
    secs = sorted(set().union(*[sector_weights(w, matrix, cfg).index for w in ports.values()]))
    print(f"  {'sector':13} " + "".join(f"{n:>9}" for n in ports))
    for s in secs:
        row = f"  {s:13} "
        for w in ports.values():
            sw = sector_weights(w, matrix, cfg)
            row += f"{sw.get(s, 0.0) * 100:8.1f} "
        print(row)

    print("\nFactor exposure (weighted average held)")
    fe = {name: factor_exposure(w, matrix, cfg) for name, w in ports.items()}
    print(f"  {'factor':20} " + "".join(f"{n:>9}" for n in ports) + f"{'MODEL-MKT':>11}")
    for f in FACTORS:
        row = f"  {f:20} "
        for name in ports:
            row += f"{fe[name][f]:8.3f} "
        row += f"{fe['MODEL'][f] - fe['MARKET'][f]:+10.3f}"
        print(row)

    shared = set(ports["MODEL"].index) & set(ports["MARKET"].index)
    print(f"\nOverlap MODEL vs MARKET: {len(shared)}/{cfg.top_n} names shared")
    only = sorted(set(ports["MODEL"].index) - set(ports["MARKET"].index))
    print(f"In MODEL but not MARKET (the active bets): {', '.join(only)}")


if __name__ == "__main__":
    main()
