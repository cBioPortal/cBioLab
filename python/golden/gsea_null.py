import math


def seed_of(s):
    """FNV-1a over the name's UTF-16 code units: the seed each set's null is drawn from."""
    h = 0x811C9DC5
    for unit in memoryview(s.encode("utf-16-le")).cast("H"):
        h = ((h ^ unit) * 0x01000193) & 0xFFFFFFFF
    return h


def mulberry32(seed):
    a = seed & 0xFFFFFFFF

    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rnd


def enrichment_score(positions, weights, n):
    """Weighted (p = 1) running-sum ES from the members' 0-based ranks, ascending."""
    k = len(positions)
    if not k or k >= n:
        return 0.0
    nr = sum(weights)
    unweighted = not nr > 0
    if unweighted:
        nr = k
    miss = 1 / (n - k)
    cum, best = 0.0, 0.0
    for i, (pos, w) in enumerate(zip(positions, weights)):
        before = cum / nr - (pos - i) * miss
        if abs(before) > abs(best):
            best = before
        cum += 1 if unweighted else w
        after = cum / nr - (pos + 1 - (i + 1)) * miss
        if abs(after) > abs(best):
            best = after
    return best


def preranked_gsea(ranked, sets, permutations=1000, min_size=10):
    """ranked: [(gene, score)] best first; sets: {name: [genes]}. Returns {name: (size, es, nes, p)}.
    The null for each set is `permutations` random sets of the same size drawn from the same ranking
    (Floyd's sampling), from a generator seeded by the set's name, so p is the same on every run."""
    n = len(ranked)
    rank_of = {}
    for i, (g, _) in enumerate(ranked):
        rank_of.setdefault(g, i)
    abs_w = [abs(s) for _, s in ranked]
    out = {}
    for name, genes in sets.items():
        pos = sorted({rank_of[g] for g in set(genes) if g in rank_of})
        k = len(pos)
        if k < min_size or k >= n:
            continue
        es = enrichment_score(pos, [abs_w[i] for i in pos], n)
        rnd = mulberry32(seed_of(name))
        null_pos, null_neg = [], []
        for _ in range(permutations):
            chosen = set()
            for j in range(n - k, n):
                t = math.floor(rnd() * (j + 1))
                chosen.add(j if t in chosen else t)
            pick = sorted(chosen)
            e = enrichment_score(pick, [abs_w[i] for i in pick], n)
            (null_pos if e >= 0 else null_neg).append(e)
        mean = lambda xs: sum(xs) / len(xs) if xs else 0.0
        if es >= 0:
            nes = es / mean(null_pos) if mean(null_pos) > 0 else 0.0
            same, beyond = null_pos, sum(1 for e in null_pos if e >= es)
        else:
            nes = -es / mean(null_neg) if mean(null_neg) < 0 else 0.0
            same, beyond = null_neg, sum(1 for e in null_neg if e <= es)
        out[name] = (k, es, nes, (beyond + 1) / (len(same) + 1))
    return out
