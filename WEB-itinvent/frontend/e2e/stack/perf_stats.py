"""Aggregate perf CSVs -> median/p95 per scenario+metric for A/B comparison.

Usage: python perf_stats.py <results-a.csv> <results-b.csv>
Prints a markdown table: scenario, metric, unit, A p50, B p50, delta%.
NaN rows are skipped; runs with <3 samples are flagged.
"""
import csv
import math
import sys
from collections import defaultdict


def load(path):
    rows = defaultdict(list)
    with open(path, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            try:
                v = float(r['value'])
            except (TypeError, ValueError):
                continue
            if math.isnan(v):
                continue
            rows[(r['scenario'], r['metric'], r['unit'])].append(v)
    return rows


def pct(values, q):
    if not values:
        return float('nan')
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round(q * (len(s) - 1)))))
    return s[k]


def main():
    a = load(sys.argv[1])
    b = load(sys.argv[2])
    keys = sorted(set(a) | set(b))
    print('| scenario | metric | unit | n | A p50 | A p95 | B p50 | B p95 | d% |')
    print('|---|---|---|---|---|---|---|---|---|')
    for key in keys:
        va, vb = a.get(key, []), b.get(key, [])
        n = f'{len(va)}/{len(vb)}'
        a50, a95 = pct(va, 0.5), pct(va, 0.95)
        b50, b95 = pct(vb, 0.5), pct(vb, 0.95)
        if a50 and not math.isnan(a50) and not math.isnan(b50):
            d = (b50 - a50) / a50 * 100
            dtxt = f'{d:+.0f}'
        else:
            dtxt = ''
        flag = ' !' if min(len(va), len(vb)) < 3 else ''
        print(f'| {key[0]} | {key[1]} | {key[2]} | {n}{flag} | {a50:.0f} | {a95:.0f} | {b50:.0f} | {b95:.0f} | {dtxt} |')


if __name__ == '__main__':
    main()
