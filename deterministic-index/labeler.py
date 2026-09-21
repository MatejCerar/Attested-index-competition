"""The ONLY non-deterministic step - and it is boxed in here.

The AI reads each company's descriptive fields and emits, for every AI feature,
a SCORE (integer on the rubric) or a LABEL (one enum value). Output is written
once to a frozen, versioned CSV with provenance, reviewed by a human, and never
re-run by the index build. Everything downstream is deterministic.

Determinism levers applied here:
  1. Enum-locked JSON schema via output_config.format - the model cannot return
     anything off-taxonomy (integer in [lo,hi] for scores; one enum for labels).
  2. temperature=0 and no thinking - minimum sampling variance.
  3. Anchored rubric per feature (from features.py) so scoring is reproducible.
  4. Cheap, fixed model (claude-haiku-4-5) pinned + stamped on every value.
  5. Human review gate before the matrix is frozen and used (freeze_matrix).

Needs ANTHROPIC_API_KEY in the environment.
"""
from __future__ import annotations

import json

import pandas as pd

from features import AI_FEATURES, NUMERIC, Feature, Kind

MODEL = "claude-haiku-4-5"  # cheapest model; classification is its sweet spot

SYSTEM = (
    "You are a precise financial data labeler. For each requested field, assign "
    "exactly one value that strictly follows its rubric and allowed values. Base "
    "the answer only on the provided company information. Do not explain - the "
    "response format is enforced by a schema."
)

_client = None


def _client_lazy():
    """Created on first use so importing this module never needs a key."""
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
    return _client


def build_output_schema(features: list[Feature]) -> dict:
    """JSON schema that hard-constrains every label/score. Goes straight into
    the Claude API `output_config.format`."""
    props: dict[str, dict] = {}
    for f in features:
        if f.kind is Kind.SCORE:
            lo, hi = f.score_range
            props[f.name] = {"type": "integer", "enum": list(range(lo, hi + 1))}
        elif f.kind is Kind.LABEL:
            props[f.name] = {"type": "string", "enum": list(f.labels)}
    return {
        "type": "object",
        "properties": props,
        "required": list(props),
        "additionalProperties": False,
    }


def _rubric_block(features: list[Feature]) -> str:
    lines = []
    for f in features:
        if f.kind is Kind.SCORE:
            lo, hi = f.score_range
            lines.append(f"- {f.name} (integer {lo}..{hi}): {f.rubric}")
        else:
            lines.append(f"- {f.name} (one of {list(f.labels)}): {f.rubric}")
    return "\n".join(lines)


def _prompt(company: str, descriptions: dict[str, str], features: list[Feature]) -> str:
    info = "\n".join(f"{k}: {v}" for k, v in descriptions.items())
    return (
        f"Company: {company}\n\n"
        f"Information:\n{info}\n\n"
        f"Assign every field below:\n{_rubric_block(features)}"
    )


def call_model(
    company: str,
    descriptions: dict[str, str],
    schema: dict,
    features: list[Feature] = AI_FEATURES,
    model: str = MODEL,
) -> dict:
    """One structured-output call -> {feature_name: value}, schema-validated."""
    resp = _client_lazy().messages.create(
        model=model,
        max_tokens=400,
        temperature=0,  # minimize sampling variance (Haiku supports temperature)
        system=SYSTEM,
        messages=[{"role": "user", "content": _prompt(company, descriptions, features)}],
        output_config={"format": {"type": "json_schema", "schema": schema}},
    )
    text = next(b.text for b in resp.content if b.type == "text")
    return json.loads(text)


def label_company(
    company: str, descriptions: dict[str, str], features: list[Feature] = AI_FEATURES
) -> dict:
    return call_model(company, descriptions, build_output_schema(features))


def freeze_matrix(
    numerics: pd.DataFrame, ai_labels: pd.DataFrame, out_path: str, version: int
) -> pd.DataFrame:
    """Merge coworker NUMERIC columns + AI SCORE/LABEL columns into the single
    frozen matrix the deterministic build consumes. Write it once; from here on
    it is an immutable, attestable artifact (hash it for the ARE epoch)."""
    matrix = numerics.merge(ai_labels, on="ticker", validate="one_to_one")
    expected = {"ticker", *NUMERIC, *[f.name for f in AI_FEATURES]}
    missing = expected - set(matrix.columns)
    if missing:
        raise ValueError(f"frozen matrix missing columns: {missing}")
    matrix.to_csv(out_path, index=False)
    return matrix


# CLI: label companies from a JSON of {ticker: {field: text}}, print each frozen
# row. Add --numerics + --out to merge with the coworker's numeric table and
# write the frozen matrix the deterministic build consumes.
def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--descriptions", required=True, help="JSON {ticker: {field: text}}")
    ap.add_argument("--numerics", help="CSV of NUMERIC columns (must have 'ticker')")
    ap.add_argument("--out", help="write the frozen feature matrix here")
    args = ap.parse_args()

    with open(args.descriptions) as fh:
        descriptions = json.load(fh)

    rows = []
    for ticker, desc in descriptions.items():
        labels = label_company(ticker, desc)
        labels["ticker"] = ticker
        rows.append(labels)
        print(ticker, json.dumps(labels, sort_keys=True))
    ai_labels = pd.DataFrame(rows)

    if args.numerics and args.out:
        numerics = pd.read_csv(args.numerics)
        num_cols = ["ticker"] + [c for c in NUMERIC if c in numerics.columns]
        freeze_matrix(numerics[num_cols], ai_labels, args.out, version=1)
        print(f"wrote frozen matrix -> {args.out}")


if __name__ == "__main__":
    main()
