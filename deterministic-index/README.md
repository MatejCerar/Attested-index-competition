# Deterministic index (LLM-labeled features -> pure-code construction)

The non-determinism of an LLM is quarantined to one step (turning descriptive
company text into a fixed label or an integer score). That output is **frozen**
into a versioned, human-reviewed matrix. Everything after that is a **pure
function** of `(matrix, config)` - same inputs, byte-identical index, every time.

```
20 raw features ────────────┬─ NUMERIC ────────────────► pass through
                            └─ descriptive ─► labeler.py (AI, constrained) ─► SCORE / LABEL
                                                          │  (freeze + human review)
                                                          ▼
                              feature_matrix_vN.csv   ← immutable, attestable artifact
                                                          │
                                                          ▼
                              index_builder.build_index(matrix, config)  ← pure, tested
                                                          │
                                                          ▼
                              index_vN.csv  (tickers + weights, reproducible)
```

## Files
| file | role |
|---|---|
| `features.py` | **The 20-feature contract** (value, quality, growth, momentum, low-vol, yield + AI-scored qualitative factors). Marks each as NUMERIC / SCORE / LABEL and carries the rubric/enum the AI uses. |
| `labeler.py` | The **only** AI step, boxed in. Interface + the frozen-matrix boundary. `call_model` is the one spot the Claude structured-output call goes (tomorrow). |
| `index_builder.py` | **The deterministic core.** `build_index(matrix, cfg)` - no I/O, no randomness, no datetime. This is the part to get right; it is. |
| `config.yaml` | Versioned index definition: signed weights, normalization, top-N, per-name & sector caps, eligibility. |
| `build.py` | CLI: load + validate + build + write. All I/O lives here, out of the pure core. |
| `example_data/feature_matrix_v1.csv` | Fake frozen matrix so it runs today. |
| `tests/` | Determinism + caps + filters + direction. `pytest -q`. |

## Where your real features plug in
1. Edit the entries in `features.py` if the feature set changes (same
   `Feature(...)` shape). NUMERIC = a column the data feed provides;
   SCORE/LABEL = a descriptive field the AI converts, with its rubric/enum.
2. Produce a frozen matrix: NUMERIC columns straight from the spreadsheet,
   SCORE/LABEL columns from `labeler.py` (once wired), merged by `freeze_matrix`.
   That CSV - `feature_matrix_vN.csv` - is the thing a human signs off on and you
   hash for attestation.
3. Point `config.yaml` `weights` at whichever features feed the score. LABEL
   features drive eligibility/caps, not the score sum.

## Run
```
pip install -r requirements.txt          # pandas, PyYAML, pytest
python -m pytest -q                       # 14 tests, all green
python build.py --matrix example_data/feature_matrix_v1.csv \
                --config config.yaml --out index_v1.csv
```

## Determinism guarantees (enforced by tests)
- Same `(matrix, config)` -> identical output, **independent of input row order**.
- Weights always sum to 1; per-name and per-sector caps hold.
- Negative config weights penalize high raw values (leverage, risk, controversy).
- Constant columns normalize to 0; duplicate ids and empty universes are rejected.

## Reproducibility / attestation
The index is fully determined by `(feature_matrix_vN.csv, config.yaml@version)`.
Freeze and hash those two, and anyone can re-run `build_index` and get the same
weights - which is exactly the "attested reproducible epoch" shape: the AI output
is a signed, reviewed dataset; the construction is a verifiable pure function.
