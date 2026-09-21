"""The feature contract - 20 real factor-investing features.

This is the single source of truth for WHAT goes into the index and HOW each
value is produced. Three kinds:

  NUMERIC  provided directly from a fundamentals/market-data feed (no AI).
  SCORE    a descriptive field the AI maps to an integer on a fixed, anchored
           rubric (0..5), then FROZEN + human-reviewed.
  LABEL    a descriptive field the AI maps to exactly one value from a fixed
           enum. Used for eligibility / diversification caps, not the score sum.

Grounding - the NUMERIC set mirrors what the major index providers use:
  - MSCI Quality Indexes: ROE, debt/equity, earnings variability
    (msci.com/eqb/methodology/meth_docs/MSCI_Quality_Indexes_Meth_June2017.pdf)
  - MSCI Enhanced Value: forward P/E, EV/operating cash flow, price/book
    (msci.com/eqb/methodology/meth_docs/MSCI_Enhanced_Value_Indexes_Methodology_Book_May2015.pdf)
  - MSCI Momentum: 12m and 6m risk-adjusted price return, excluding the most
    recent month (msci.com/indexes/documents/methodology/2_MSCI_Momentum_Indexes_Methodology_20250725.pdf)
  - S&P Quality Indices: ROE, accruals ratio, financial leverage
    (spglobal.com/spdji/en/documents/methodologies/methodology-sp-quality-indices.pdf)
  - FTSE Russell style: book/price, 2y forecast EPS growth, 5y sales growth
    (lseg.com russell-us-indexes-construction-and-methodology.pdf)
  - Sector enum = the 11 GICS sectors (msci.com/our-solutions/indexes/gics).
We use EV/EBITDA in place of EV/CFO and net debt/EBITDA in place of D/E: same
factor intent (value, leverage), more commonly quoted by data feeds.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Kind(str, Enum):
    NUMERIC = "numeric"   # data-feed number
    SCORE = "score"       # AI: descriptive text -> integer on a rubric
    LABEL = "label"       # AI: descriptive text -> one enum value


@dataclass(frozen=True)
class Feature:
    name: str
    kind: Kind
    source: str                       # "coworker" | "ai"
    higher_is_better: bool | None = None   # scoring direction (NUMERIC/SCORE)
    score_range: tuple[int, int] = (0, 5)  # SCORE only
    labels: tuple[str, ...] = ()           # LABEL only (the allowed enum)
    rubric: str = ""                       # anchored definition for the AI


# ---------------------------------------------------------------------------
# 20 features: 11 NUMERIC (data feed), 6 SCORE (AI, 0..5), 3 LABEL (AI, enum).
# ---------------------------------------------------------------------------
FEATURES: list[Feature] = [
    # --- NUMERIC: straight from the fundamentals/market-data feed -----------
    # size (eligibility + cap-tier context)
    Feature("market_cap_usd", Kind.NUMERIC, "coworker", higher_is_better=True),
    # value (MSCI Enhanced Value style)
    Feature("pe_forward", Kind.NUMERIC, "coworker", higher_is_better=False),
    Feature("ev_ebitda", Kind.NUMERIC, "coworker", higher_is_better=False),
    Feature("fcf_yield", Kind.NUMERIC, "coworker", higher_is_better=True),
    # yield
    Feature("dividend_yield", Kind.NUMERIC, "coworker", higher_is_better=True),
    # growth (FTSE Russell style)
    Feature("revenue_growth_yoy", Kind.NUMERIC, "coworker", higher_is_better=True),
    # quality / profitability (MSCI + S&P Quality)
    Feature("gross_margin", Kind.NUMERIC, "coworker", higher_is_better=True),
    Feature("return_on_equity", Kind.NUMERIC, "coworker", higher_is_better=True),
    # leverage (quality, inverted)
    Feature("net_debt_to_ebitda", Kind.NUMERIC, "coworker", higher_is_better=False),
    # momentum: trailing 12m price return excluding the most recent month
    Feature("momentum_12m", Kind.NUMERIC, "coworker", higher_is_better=True),
    # low volatility: annualized std dev of daily returns, trailing 90 days
    Feature("volatility_90d", Kind.NUMERIC, "coworker", higher_is_better=False),

    # --- SCORE: AI turns a paragraph into an integer 0..5 -------------------
    Feature(
        "moat_strength", Kind.SCORE, "ai", higher_is_better=True,
        rubric="0=commodity business, no durable advantage; 1=weak edge, easily "
               "copied; 2=modest brand or switching costs; 3=solid moat from "
               "scale, brand, or IP; 4=strong network effects or entrenched "
               "ecosystem; 5=near-monopoly or regulatory-protected franchise.",
    ),
    Feature(
        "management_quality", Kind.SCORE, "ai", higher_is_better=True,
        rubric="0=governance failures or value-destructive allocation; "
               "1=repeated missteps; 2=mixed record; 3=solid, credible track "
               "record; 4=consistently strong execution and allocation; "
               "5=exceptional proven compounder (long tenure, high ROIC deals).",
    ),
    Feature(
        "ai_exposure", Kind.SCORE, "ai", higher_is_better=True,
        rubric="0=no AI relevance; 1=marginal internal use; 2=meaningful "
               "efficiency tailwind; 3=AI features drive part of the offering; "
               "4=core AI product or revenue driver; 5=critical AI "
               "infrastructure (chips, cloud training capacity, foundational "
               "models).",
    ),
    Feature(
        "regulatory_risk", Kind.SCORE, "ai", higher_is_better=False,
        rubric="0=negligible oversight exposure; 1=light-touch regime; "
               "2=normal sector oversight; 3=elevated scrutiny or pricing "
               "pressure; 4=active antitrust/investigations or pending adverse "
               "rules; 5=existential regulatory threat (breakup, ban, license "
               "loss).",
    ),
    Feature(
        "esg_controversy", Kind.SCORE, "ai", higher_is_better=False,
        rubric="0=clean record; 1=isolated minor issues, resolved; 2=minor "
               "historical controversies; 3=recurring criticism (labor, "
               "environment, product safety); 4=recent material controversy "
               "with financial impact; 5=severe ongoing scandal or litigation.",
    ),
    Feature(
        "demand_durability", Kind.SCORE, "ai", higher_is_better=True,
        rubric="0=fad or deeply cyclical, demand can halve; 1=highly cyclical; "
               "2=steady but GDP-like; 3=stable with modest secular support; "
               "4=structurally growing secular demand; 5=mission-critical, "
               "recession-resistant spend.",
    ),

    # --- LABEL: AI picks exactly one value; used for filters/caps -----------
    Feature(
        "sector", Kind.LABEL, "ai",
        labels=("energy", "materials", "industrials", "consumer_discretionary",
                "consumer_staples", "health_care", "financials",
                "information_technology", "communication_services",
                "utilities", "real_estate"),
        rubric="Assign the single best-fit GICS sector (11-sector level) based "
               "on where the company earns the majority of its revenue.",
    ),
    Feature(
        "market_cap_tier", Kind.LABEL, "ai",
        labels=("mega", "large", "mid", "small"),
        rubric="mega=market cap >= $200B; large=$10B to $200B; mid=$2B to "
               "$10B; small=below $2B.",
    ),
    Feature(
        "competitive_position", Kind.LABEL, "ai",
        labels=("leader", "challenger", "follower", "niche"),
        rubric="leader=clear #1 in its core market; challenger=strong #2/#3 "
               "actively contesting share; follower=takes share cues from "
               "leaders; niche=specialist dominating a small segment.",
    ),
]

# Convenience views used by the labeler and by validation.
BY_NAME: dict[str, Feature] = {f.name: f for f in FEATURES}
NUMERIC = [f.name for f in FEATURES if f.kind is Kind.NUMERIC]
SCORE = [f.name for f in FEATURES if f.kind is Kind.SCORE]
LABEL = [f.name for f in FEATURES if f.kind is Kind.LABEL]
AI_FEATURES = [f for f in FEATURES if f.source == "ai"]

assert len(FEATURES) == 20, "expected exactly 20 features"
