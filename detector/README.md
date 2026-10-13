# Aggression detector (own model)

Small linear classifier (TF-IDF word 1-2 grams + logistic regression, 40,000 terms) replacing the unlicensed model from the Cyber-Aggression repo.

## Data and licence
- **Training data:** [google/civil_comments](https://huggingface.co/datasets/google/civil_comments), validation split (97,320 rows), licence **CC0-1.0**.
- **Evaluation data:** same dataset, test split (97,320 rows), never used for fitting or threshold choice.
- **Label:** aggressive = `toxicity >= 0.5` or `threat >= 0.5` or `insult >= 0.5` (rater-averaged scores). 8.0% positive.
- File SHA-256 (as downloaded 2026-10-14):
  - `validation-00000-of-00001.parquet`: `2e0eb65474e7e1290df8689fc93eea783160c898c09ae15382c0a9662367bd03`
  - `test-00000-of-00001.parquet`: `410f803ff161e7c4ba005db7de5b444cac413f4861bf056b0fd69d670d75aa08`

## Results (test split, threshold 0.68 chosen on a dev split of the training data)
| Metric | Value |
|---|---|
| ROC-AUC | 0.903 |
| PR-AUC | 0.604 |
| Precision / recall / F1 at 0.68 | 0.60 / 0.53 / 0.56 |
| Precision / recall at 0.90 | 0.78 / 0.33 |

## Known limits (report these honestly)
- **Domain shift:** news-site comments, not private chat. Expect different error patterns.
- **Label meaning:** "toxic" is not the same as "aggressive"; mild sarcasm and anger without insults score low, which is arguably desired for a coaching tool.
- **Misses:** about half of aggressive messages at the chosen threshold; obfuscation like "u r a d u m b" is not caught.
- **Bias:** toxicity classifiers over-flag identity terms and dialect. Not audited here.
- Spot check (13 probes): blocks "stupid idiot", "shut up loser", "I will kill you", "go to hell"; passes "I feel frustrated when you interrupt me" and "I'm really angry at you right now".

## Reproduce
```bash
python train.py DATA_DIR OUT_DIR   # DATA_DIR holds the two parquet files above
```
Needs pandas, pyarrow, scikit-learn. `model.json` (1.1 MB) is what the static site will load; `parity_probes.json` holds Python probabilities for checking the JavaScript port.

## JavaScript port (for the static site)
`detector.js` loads `model.json` and scores in the browser or Node; `check(text)` returns `{prob, band}` with band `ok` / `borderline` (0.40 to threshold, for an LLM second opinion) / `block`.

Parity against scikit-learn on 3,000 held-out comments: max probability difference 1.9e-6, 0 decision flips at the 0.68 threshold. The gap comes from `model.json` rounding weights to 5 decimals.

```bash
node parity_test.js model.json parity_probes.json
python train.py DATA_DIR OUT_DIR PARITY_FILE   # regenerate a 3,000-row parity set
node parity_test.js OUT_DIR/model.json PARITY_FILE
```
Speed (Node, laptop): about 0.004 ms per message, 6 ms to load; `model.json` is 1.1 MB, 334 KB gzipped (GitHub Pages serves it compressed).
