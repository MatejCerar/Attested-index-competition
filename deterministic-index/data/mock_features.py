"""MOCK of the real feature database - 40 real large-cap companies with
plausible fundamentals (approximate values as of ~early 2026 from general
knowledge), so the index and its benchmarks are meaningful.

Each row carries the 11 NUMERIC features, stand-in values for the 6 AI SCORE
features and 3 AI LABEL features, plus a short profile paragraph: the
descriptive text the AI labeler would actually read.

Run this to (re)generate the frozen matrix, the labeler input, and a Postgres
schema/seed:
    python data/mock_features.py
"""
from __future__ import annotations

import csv
import json
import os

COLS = [
    "ticker", "name", "market_cap_usd", "pe_forward", "ev_ebitda", "fcf_yield",
    "dividend_yield", "revenue_growth_yoy", "gross_margin", "return_on_equity",
    "net_debt_to_ebitda", "momentum_12m", "volatility_90d",
    "moat_strength", "management_quality", "ai_exposure", "regulatory_risk",
    "esg_controversy", "demand_durability",
    "sector", "market_cap_tier", "competitive_position",
]
SCORE_COLS = ("moat_strength", "management_quality", "ai_exposure",
              "regulatory_risk", "esg_controversy", "demand_durability")

# ticker, name, mcap($), fwd P/E, EV/EBITDA, fcf_yield, div_yield, rev_growth,
# gross_margin, roe, nd/ebitda, 12m momentum, 90d vol,
# moat, mgmt, ai, reg, esg, demand, sector, tier, position, profile
ROWS = [
    ("NVDA","NVIDIA",3400e9,32,45,0.020,0.000,0.55,0.75,0.95,-0.40,0.35,0.45,5,5,5,3,1,5,"information_technology","mega","leader",
     "Dominant designer of GPUs for AI training and inference; the CUDA software ecosystem creates deep switching costs. Founder-led with exceptional execution. Export controls and antitrust scrutiny are live risks. Demand is structurally tied to the AI build-out."),
    ("MSFT","Microsoft",3100e9,30,22,0.030,0.007,0.16,0.69,0.38,0.10,0.18,0.22,5,5,5,3,1,5,"information_technology","mega","leader",
     "Enterprise software and cloud giant; Azure plus the OpenAI partnership make it core AI infrastructure. Entrenched Office/Windows franchises, disciplined management, recurring mission-critical revenue. Ongoing antitrust attention in the US and EU."),
    ("AAPL","Apple",3000e9,28,22,0.038,0.005,0.05,0.46,0.60,0.30,0.10,0.24,4,4,3,2,1,4,"information_technology","mega","leader",
     "Premium device ecosystem with unmatched brand loyalty and services attach. Mature growth; AI features ship on-device but are not yet a revenue driver. App Store faces regulatory pressure in the EU. Superb capital returns."),
    ("GOOGL","Alphabet",2100e9,22,16,0.033,0.004,0.14,0.58,0.30,-0.20,0.28,0.28,4,4,5,4,2,4,"communication_services","mega","leader",
     "Search and YouTube advertising monopoly-scale franchises plus a top-three cloud and frontier AI models (Gemini). Active antitrust cases on both sides of the Atlantic. Net cash balance sheet."),
    ("AMZN","Amazon",1950e9,33,18,0.020,0.000,0.12,0.48,0.20,0.40,0.15,0.30,4,4,4,3,2,4,"consumer_discretionary","mega","leader",
     "E-commerce and logistics leader; AWS is the largest cloud and a primary AI compute supplier. Relentless reinvestment culture. Labor-practice and antitrust scrutiny recur. Retail demand is resilient but margin-thin."),
    ("META","Meta Platforms",1400e9,24,15,0.045,0.003,0.20,0.81,0.34,-0.30,0.30,0.35,4,4,5,4,3,4,"communication_services","mega","leader",
     "Owns the dominant social graph (Facebook, Instagram, WhatsApp); AI-driven ad targeting and open-weight Llama models. Heavy capex on AI infrastructure. Persistent privacy, teen-safety, and antitrust controversies."),
    ("AVGO","Broadcom",1050e9,35,28,0.028,0.011,0.35,0.66,0.22,2.00,0.60,0.42,4,4,4,2,1,4,"information_technology","mega","challenger",
     "Custom AI accelerators (XPUs) and networking silicon for hyperscalers plus the VMware software franchise. Serial acquirer with aggressive but effective management; leverage from the VMware deal is being paid down fast."),
    ("TSLA","Tesla",1100e9,90,70,0.010,0.000,0.05,0.18,0.10,-0.10,0.40,0.55,3,3,4,3,3,3,"consumer_discretionary","mega","challenger",
     "EV pioneer betting the valuation on autonomy and robotics. Volatile execution, key-man risk, and thin auto margins amid Chinese competition. Brand controversies have dented demand in Europe."),
    ("LLY","Eli Lilly",760e9,35,30,0.014,0.008,0.30,0.81,0.55,0.80,-0.10,0.32,4,4,2,2,1,5,"health_care","mega","leader",
     "Leader in GLP-1 obesity and diabetes drugs (Mounjaro, Zepbound) with a deep pipeline. Patent-protected franchises and pricing power; drug-price politics is the main overhang. Demand is secular and durable."),
    ("JPM","JPMorgan Chase",680e9,14,11,0.070,0.022,0.06,0.55,0.16,1.40,0.25,0.20,3,4,2,4,2,3,"financials","mega","leader",
     "Largest US bank with a fortress balance sheet and best-in-class management. Scale moat in payments and markets; heavily regulated with capital-rule exposure. Earnings track the credit cycle."),
    ("V","Visa",620e9,27,22,0.040,0.008,0.10,0.80,0.45,0.30,0.12,0.18,5,4,3,3,1,4,"financials","mega","leader",
     "Global payments network with an extreme two-sided network moat and 80%+ gross margins. Interchange regulation and stablecoin disintermediation are watch items. Volumes grow with global consumption."),
    ("MA","Mastercard",480e9,30,25,0.038,0.006,0.12,0.76,0.55,0.60,0.14,0.19,5,4,3,3,1,4,"financials","mega","leader",
     "Second global payments network; same network-effect moat and secular cash-to-card tailwind as Visa, slightly faster growth from services and cross-border mix."),
    ("UNH","UnitedHealth",300e9,13,10,0.060,0.030,0.08,0.24,0.22,1.10,-0.35,0.38,3,3,2,5,4,4,"health_care","mega","leader",
     "Largest US health insurer plus the Optum care and PBM platform. DOJ investigations, Medicare Advantage rate pressure, and public backlash after 2024-25 controversies. Scale advantages remain intact."),
    ("XOM","Exxon Mobil",520e9,13,6.5,0.055,0.035,-0.02,0.33,0.18,0.40,0.05,0.22,2,3,1,3,4,2,"energy","mega","leader",
     "Largest western oil major; low-cost Permian and Guyana barrels. Commodity price taker, disciplined capital returns. Climate litigation and energy-transition policy are structural ESG overhangs."),
    ("CVX","Chevron",290e9,14,6.0,0.050,0.045,-0.03,0.35,0.14,0.30,0.02,0.21,2,3,1,3,4,2,"energy","mega","challenger",
     "Second US oil major with a strong dividend record and the Hess/Guyana position. Same cyclical commodity exposure and transition risk as peers; conservative balance sheet."),
    ("COST","Costco",410e9,48,30,0.025,0.005,0.08,0.13,0.28,0.10,0.12,0.18,3,5,1,1,1,5,"consumer_staples","mega","leader",
     "Membership warehouse retailer with cult-level renewal rates and a deliberate low-margin model. Exceptional, conservative management. Minimal AI or regulatory exposure. Recession-resistant demand."),
    ("WMT","Walmart",760e9,35,20,0.030,0.009,0.05,0.25,0.21,0.80,0.30,0.19,4,4,2,1,2,5,"consumer_staples","mega","leader",
     "Largest global retailer; scale and logistics moat, growing ad and marketplace businesses. Using AI for supply-chain efficiency. Staple demand, modest but steady growth."),
    ("HD","Home Depot",400e9,24,16,0.045,0.024,0.03,0.34,0.90,1.30,0.05,0.22,3,4,1,1,1,3,"consumer_discretionary","mega","leader",
     "Dominant home-improvement retailer; pro-customer ecosystem and supply chain are the edge. Earnings track housing turnover and rates. Little AI or regulatory exposure."),
    ("MCD","McDonald's",210e9,24,18,0.040,0.023,0.03,0.57,0.45,3.00,0.02,0.16,4,4,1,1,2,4,"consumer_discretionary","mega","leader",
     "Global QSR franchise royalty model with an iconic brand and real-estate backbone. Franchise leverage is high but cash flows are annuity-like. Health and labor criticisms recur but rarely bite."),
    ("PG","Procter & Gamble",390e9,24,18,0.040,0.024,0.03,0.51,0.32,0.60,0.00,0.15,4,4,1,1,2,5,"consumer_staples","mega","leader",
     "Branded staples portfolio (Tide, Pampers, Gillette) with pricing power and distribution scale. Steady management, low volatility, recession-resistant demand, negligible AI relevance."),
    ("KO","Coca-Cola",300e9,22,20,0.035,0.028,0.04,0.60,0.40,1.80,0.08,0.14,4,4,1,1,2,5,"consumer_staples","mega","leader",
     "Iconic beverage brand with a vast bottler distribution moat. Conservative management, dependable dividend. Occasional sugar/health and plastics controversies. Staple demand."),
    ("PEP","PepsiCo",210e9,18,14,0.035,0.036,0.03,0.55,0.48,1.90,-0.05,0.16,4,4,1,1,2,5,"consumer_staples","mega","leader",
     "Snacks (Frito-Lay) plus beverages; brand and shelf-space moat. GLP-1 driven snacking worries pressured the stock. Reliable dividend grower with staple demand."),
    ("JNJ","Johnson & Johnson",380e9,16,13,0.045,0.031,0.05,0.69,0.24,0.30,0.10,0.15,4,4,2,3,3,5,"health_care","mega","leader",
     "Diversified pharma and medtech with AAA-grade finances. Talc litigation remains a material ESG overhang. Health-care demand is as durable as it gets."),
    ("MRK","Merck",250e9,11,9,0.045,0.032,0.06,0.75,0.35,0.60,-0.15,0.24,4,3,2,3,2,4,"health_care","mega","leader",
     "Keytruda is the world's top-selling drug; the 2028 patent cliff dominates the story. Cheap on forward earnings, solid pipeline-replenishment record, standard pharma pricing risk."),
    ("ABBV","AbbVie",340e9,15,12,0.055,0.033,0.04,0.70,0.90,2.60,0.15,0.22,4,3,2,3,2,4,"health_care","mega","leader",
     "Post-Humira portfolio led by Skyrizi and Rinvoq executing above plan. Elevated leverage from the Allergan deal is amortizing. Immunology demand is durable; pricing politics is the risk."),
    ("TMO","Thermo Fisher",210e9,23,17,0.040,0.003,0.03,0.42,0.14,2.10,-0.05,0.25,4,4,3,1,1,4,"health_care","mega","leader",
     "Life-science tools and services one-stop shop; razor/razorblade consumables moat. Biopharma R&D spending drives demand. Well-run serial acquirer, low controversy."),
    ("ORCL","Oracle",380e9,27,20,0.012,0.011,0.09,0.71,0.90,3.20,0.45,0.40,3,4,4,2,1,4,"information_technology","mega","challenger",
     "Legacy database franchise pivoting hard into AI cloud infrastructure with huge contracted backlog (RPO). Leverage is high and capex is enormous; execution so far is strong."),
    ("CRM","Salesforce",280e9,25,18,0.045,0.006,0.10,0.77,0.11,-0.10,-0.10,0.32,3,3,4,2,2,4,"information_technology","mega","challenger",
     "CRM category leader pushing Agentforce AI agents; activist pressure improved margins. Growth has decelerated to single digits; AI monetization is promising but unproven."),
    ("ADBE","Adobe",210e9,18,15,0.050,0.000,0.10,0.89,0.35,0.20,-0.20,0.30,4,4,4,2,1,4,"information_technology","mega","leader",
     "Creative-software standard (Photoshop, Acrobat) with 89% gross margins. Firefly embeds generative AI, but investors fear AI-native disruption, compressing the multiple."),
    ("AMD","AMD",240e9,28,32,0.015,0.000,0.25,0.50,0.06,-0.10,0.10,0.50,3,4,4,2,1,4,"information_technology","mega","challenger",
     "The credible #2 in AI accelerators (MI series) and server CPUs vs Intel. Excellent CEO track record. Wins hyperscaler deals but trails NVIDIA's software ecosystem."),
    ("NFLX","Netflix",420e9,35,25,0.030,0.000,0.15,0.46,0.35,0.90,0.25,0.30,3,4,3,2,2,4,"communication_services","mega","leader",
     "Streaming leader with scale-driven content moat, ads tier ramping. Uses AI for recommendations and production efficiency. Competition is rational now; demand is sticky."),
    ("BAC","Bank of America",300e9,12,9,0.060,0.024,0.04,0.50,0.11,1.60,0.18,0.22,2,3,2,4,2,3,"financials","mega","challenger",
     "Second-largest US bank; huge low-cost deposit base. Rate-sensitive earnings, heavily regulated, held-to-maturity bond marks were the recent scar. Solid but unspectacular execution."),
    ("GS","Goldman Sachs",160e9,13,10,0.050,0.019,0.10,0.55,0.13,1.80,0.35,0.26,3,4,2,4,2,3,"financials","large","challenger",
     "Premier investment bank and trading franchise; earnings swing with capital-markets activity. Consumer misadventure (Marcus) is behind it. Strong brand, cyclical demand."),
    ("CAT","Caterpillar",180e9,18,12,0.045,0.015,0.02,0.34,0.55,1.20,0.20,0.26,4,4,2,1,3,3,"industrials","large","leader",
     "Heavy-machinery leader with an unmatched dealer network; data-center power generation is a new growth leg. Deeply cyclical end markets; emissions profile draws ESG criticism."),
    ("GE","GE Aerospace",210e9,32,22,0.030,0.005,0.10,0.35,0.30,0.80,0.55,0.30,4,4,2,2,3,4,"industrials","mega","leader",
     "Duopoly jet-engine franchise (with Safran via CFM) and decades of locked-in service revenue. Post-breakup management is excellent. Aerospace demand outstrips supply."),
    ("HON","Honeywell",150e9,20,14,0.045,0.019,0.04,0.38,0.30,1.70,0.00,0.20,4,4,3,1,2,4,"industrials","large","leader",
     "Diversified industrial (aerospace, automation, energy tech) splitting into three companies to unlock value. Solid execution, industrial-software angle, moderate cyclicality."),
    ("BA","Boeing",130e9,45,25,-0.020,0.000,0.10,0.10,-0.50,6.00,0.05,0.35,4,2,2,3,4,4,"industrials","large","challenger",
     "One half of the commercial-aircraft duopoly, still recovering from the 737 MAX and quality crises: negative equity, heavy debt, FAA oversight. The backlog is enormous if execution stabilizes."),
    ("LIN","Linde",230e9,30,20,0.035,0.012,0.04,0.47,0.16,1.40,0.00,0.17,5,4,2,1,2,4,"materials","mega","leader",
     "World's largest industrial-gas company; density economics make local markets near-monopolies. Pricing power, clean-hydrogen optionality, defensive demand, superb management."),
    ("NEE","NextEra Energy",150e9,19,14,-0.010,0.032,0.05,0.60,0.11,5.50,-0.05,0.24,3,3,2,3,2,5,"utilities","large","leader",
     "Largest US utility and top renewables developer; data-center electricity demand is a tailwind. Capital-intensive with utility-typical leverage and rate regulation. Demand could not be more durable."),
    ("AMT","American Tower",100e9,20,20,0.045,0.031,0.02,0.70,0.10,5.20,-0.12,0.22,4,3,2,2,1,4,"real_estate","large","leader",
     "Global cell-tower REIT; towers are near-irreplaceable infrastructure with long escalator-linked leases. REIT-typical leverage and rate sensitivity; mobile-data demand grows relentlessly."),
]


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    rows = [r[:-1] for r in ROWS]
    profiles = {r[0]: {"profile": r[-1]} for r in ROWS}

    # 1) frozen matrix CSV (the immutable snapshot the builder consumes)
    with open(os.path.join(here, "companies.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(COLS)
        w.writerows(rows)

    # 2) labeler input: {ticker: {field: text}} the AI reads
    with open(os.path.join(here, "descriptions_example.json"), "w") as fh:
        json.dump(profiles, fh, indent=2)
        fh.write("\n")

    # 3) Postgres schema + seed (the mutable source-of-truth store)
    coltypes = {
        "ticker": "text primary key", "name": "text", "sector": "text",
        "market_cap_tier": "text", "competitive_position": "text",
    }
    lines = ["-- Source-of-truth features store. Data feed updates rows here;",
             "-- a frozen snapshot (companies.csv) is exported per index version.",
             "create table if not exists company_features ("]
    defs = []
    for c in COLS:
        if c in coltypes:
            defs.append(f"    {c} {coltypes[c]}")
        elif c in SCORE_COLS:
            defs.append(f"    {c} smallint check ({c} between 0 and 5)")
        else:
            defs.append(f"    {c} double precision")
    defs += ["    labeled_by text default 'ai'",
             "    labeled_at timestamptz default now()",
             "    model_id text", "    reviewed_by text"]
    lines.append(",\n".join(defs))
    lines.append(");")
    with open(os.path.join(here, "schema.sql"), "w") as fh:
        fh.write("\n".join(lines) + "\n")
    with open(os.path.join(here, "seed.sql"), "w") as fh:
        fh.write("-- generated by mock_features.py\n")
        for r in rows:
            vals = [f"'{v}'" if isinstance(v, str) else repr(v) for v in r]
            fh.write(
                f"insert into company_features ({','.join(COLS)}) "
                f"values ({','.join(vals)}) on conflict (ticker) do nothing;\n"
            )
    print(f"wrote {len(rows)} companies -> companies.csv, "
          f"descriptions_example.json, schema.sql, seed.sql")


if __name__ == "__main__":
    main()
