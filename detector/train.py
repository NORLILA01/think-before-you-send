"""Train a small aggression classifier on Civil Comments (CC0).
Usage: train.py DATA_DIR OUT_DIR [PARITY_FILE]  (PARITY_FILE: dump 3000 test rows + sklearn probs for the JS port)"""
import json
import re
import sys

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, precision_recall_fscore_support, roc_auc_score
from sklearn.model_selection import train_test_split

data_dir, out_dir = sys.argv[1], sys.argv[2]

LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "$": "s", "@": "a"})


def normalize(t):
    # Mirrored 1:1 in the JS port. Keep regexes simple.
    t = str(t).lower()
    t = re.sub(r"https?://\S+", " ", t)
    t = t.translate(LEET)
    t = re.sub(r"[^a-z\s]", " ", t)
    t = re.sub(r"(.)\1{2,}", r"\1\1", t)  # sooo -> soo
    # join runs of 3+ single letters: "d u m b" -> "dumb"
    t = re.sub(r"\b(?:[a-z] ){2,}[a-z]\b", lambda m: m.group(0).replace(" ", ""), t)
    return re.sub(r"\s+", " ", t).strip()


def label(df):
    return ((df.toxicity >= 0.5) | (df.threat >= 0.5) | (df.insult >= 0.5)).astype(int)


tr = pd.read_parquet(f"{data_dir}/validation-00000-of-00001.parquet")
te = pd.read_parquet(f"{data_dir}/test-00000-of-00001.parquet")
tr["y"], te["y"] = label(tr), label(te)
print(f"train rows {len(tr)} (aggressive {tr.y.mean():.1%}) | test rows {len(te)} (aggressive {te.y.mean():.1%})")

tr_fit, tr_dev = train_test_split(tr, test_size=0.15, random_state=0, stratify=tr.y)
vec = TfidfVectorizer(preprocessor=normalize, ngram_range=(1, 2), min_df=3, max_features=40000, sublinear_tf=True)
Xf = vec.fit_transform(tr_fit.text)
clf = LogisticRegression(C=4.0, max_iter=2000, class_weight="balanced").fit(Xf, tr_fit.y)

p_dev = clf.predict_proba(vec.transform(tr_dev.text))[:, 1]
p_te = clf.predict_proba(vec.transform(te.text))[:, 1]
print(f"test ROC-AUC {roc_auc_score(te.y, p_te):.3f} | PR-AUC {average_precision_score(te.y, p_te):.3f}")

# threshold chosen on the dev split: highest recall with dev precision >= 0.60 (a block should be mostly right)
best = None
for th in np.arange(0.5, 0.98, 0.01):
    pr, rc, _, _ = precision_recall_fscore_support(tr_dev.y, p_dev >= th, average="binary", zero_division=0)
    if pr >= 0.60 and (best is None or rc > best[2]):
        best = (th, pr, rc)
th = float(best[0]) if best else 0.8
print(f"chosen threshold {th:.2f} (dev precision {best[1]:.2f}, recall {best[2]:.2f})" if best else "fallback threshold 0.80")
print("test metrics by threshold:")
for t in (0.5, 0.6, 0.7, th, 0.9):
    pr, rc, f1, _ = precision_recall_fscore_support(te.y, p_te >= t, average="binary", zero_division=0)
    print(f"  th={t:.2f}  precision {pr:.2f}  recall {rc:.2f}  F1 {f1:.2f}{'  <- chosen' if abs(t-th)<1e-9 else ''}")

probes = [
    "hello how are you", "thanks for your help", "you are such a stupid idiot", "shut up loser",
    "I will kill you", "I disagree with your point, but I respect it", "this is not good",
    "go to hell", "you're an a$$hole", "u r a d u m b", "I'm really angry at you right now",
    "I feel frustrated when you interrupt me", "nobody likes you, just disappear",
]
print("probes (prob -> decision):")
for s, p in zip(probes, clf.predict_proba(vec.transform(probes))[:, 1]):
    print(f"  {p:.2f} {'BLOCK' if p >= th else 'ok   '} | {s}")

vocab = vec.vocabulary_
terms = [None] * len(vocab)
for k, v in vocab.items():
    terms[v] = k
model = {
    "threshold": th,
    "intercept": float(clf.intercept_[0]),
    "terms": terms,
    "idf": [round(float(x), 5) for x in vec.idf_],
    "coef": [round(float(x), 5) for x in clf.coef_[0]],
    "ngram": [1, 2],
    "sublinear_tf": True,
    "norm": "l2",
    "token_pattern": r"(?u)\b\w\w+\b",
    "training_data": "google/civil_comments validation split (CC0-1.0)",
}
json.dump(model, open(f"{out_dir}/model.json", "w"), separators=(",", ":"))
json.dump({"probes": probes, "probs": [float(x) for x in clf.predict_proba(vec.transform(probes))[:, 1]]},
          open(f"{out_dir}/parity_probes.json", "w"))
print("exported", len(terms), "terms")

if len(sys.argv) > 3:
    s = te.sample(3000, random_state=1)
    json.dump({"texts": s.text.tolist(), "probs": [float(x) for x in clf.predict_proba(vec.transform(s.text))[:, 1]]},
              open(sys.argv[3], "w"))
    print("parity set written")
