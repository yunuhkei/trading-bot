"""Read-only: which first-minute clues the coin model leans on. Trains on earlier days, scores the latest day, and
measures how much worse it gets when each clue is scrambled (permutation importance)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import roc_auc_score

from bot import brain, coin_log as cl

PLAIN = {"s60.n": "trades in the 1st minute", "s60.nb": "buys in the 1st minute", "s60.ns": "sells in the 1st minute",
         "s60.bs": "SOL bought in the 1st minute", "s60.ss": "SOL sold in the 1st minute", "s60.mb": "biggest single buy",
         "s60.u": "different buyers (not the creator)", "s60.t5": "seconds until 5 buyers showed up",
         "s60.dv": "creator's own buys", "s60.cs": "creator already sold", "s60.top": "biggest buyer's share of buying",
         "s60.pm": "price move in the 1st minute", "s10.n": "trades in the first 10 s", "s10.u": "buyers in the first 10 s",
         "s10.bs": "SOL bought in the first 10 s", "s10.pm": "price move in the first 10 s", "hr": "hour of the day",
         "lr": "launches per minute (how busy pump.fun is)", "cp": "creator's past coins", "cd": "creator's past coins that died",
         "cg": "creator's past coins that graduated", "st": "SOL's trend over the last hour", "sv": "SOL's swings",
         "f0": "creator's first buy at launch", "tw": "named after the news", "wv": "naming wave (30 min)", "wv5": "naming wave (5 min)"}
cfg = brain.config()
ct = brain.CoinTable(cfg["cost"])
for r in cl.rows("c"):
    ct.add(r)
idx = [i for i, r in enumerate(ct.ret) if r is not None]
X = np.array([ct.x60[i] for i in idx]); y = (np.array([ct.ret[i] for i in idx]) > 0).astype(int)
days = np.array([ct.day[i] for i in idx]); order = sorted(set(days))
test = days == order[-1]
if (days == order[-1]).sum() < 1000 and len(order) > 2:          # a short latest day: use the one before as the test
    test = days == order[-2]
    train = days < order[-2]
else:
    train = days < order[-1]
m = HistGradientBoostingClassifier(max_iter=100, max_leaf_nodes=15, l2_regularization=1.0, random_state=0).fit(X[train], y[train])
p = m.predict_proba(X[test])[:, 1]
print(f"IMPORTANCE: trained on {train.sum():,} coins, tested on {test.sum():,} unseen coins; AUC {roc_auc_score(y[test], p):.3f} "
      "(0.5 = guessing, 1.0 = perfect)")
imp = permutation_importance(m, X[test], y[test], scoring="roc_auc", n_repeats=5, random_state=0)
names = [f"{a}.{b}" if a else b for a, b in brain.F60]
top = np.argsort(-imp.importances_mean)
picks = p >= np.quantile(p, 0.9)
for j in top[:12]:
    pk, al = X[test][picks, j].mean(), X[test][:, j].mean()
    print(f"IMPORTANCE: {PLAIN.get(names[j], names[j]):42} {imp.importances_mean[j]:.4f}   its top-10% picks avg {pk:.3g} vs all coins {al:.3g}")
