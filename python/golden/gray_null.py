import math


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


def gray_statistic(t, cause, entry, group, K, order, entry_order):
    """Sum over groups of (observed - expected)^2 / expected cause-1 events, expected from the pooled
    subdistribution hazard with each group's risk set Y_k (1 - F1_k) / S_k (Gray 1988, weight 1).
    order / entry_order: the records' indices sorted by exit and by entry time."""
    n = len(t)
    Y, S, F = [0.0] * K, [1.0] * K, [0.0] * K
    z, E = [0.0] * K, [0.0] * K
    i = ei = 0
    while i < n:
        tj = t[order[i]]
        while ei < n and entry[entry_order[ei]] < tj:
            Y[group[entry_order[ei]]] += 1
            ei += 1
        d1, d2, cc = [0.0] * K, [0.0] * K, [0.0] * K
        while i < n and t[order[i]] == tj:
            r = order[i]
            i += 1
            if cause[r] == 1:
                d1[group[r]] += 1
            elif cause[r] == 2:
                d2[group[r]] += 1
            else:
                cc[group[r]] += 1
        R = [Y[k] * (1 - F[k]) / S[k] if Y[k] > 0 and S[k] > 0 else 0.0 for k in range(K)]
        D1, Rtot = 0.0, 0.0
        for k in range(K):
            D1 += d1[k]
            Rtot += R[k]
        if D1 > 0 and Rtot > 0:
            for k in range(K):
                e = R[k] * D1 / Rtot
                z[k] += d1[k] - e
                E[k] += e
        for k in range(K):
            if Y[k] > 0:
                F[k] += S[k] * d1[k] / Y[k]
                S[k] *= 1 - (d1[k] + d2[k]) / Y[k]
            Y[k] -= d1[k] + d2[k] + cc[k]
    stat = 0.0
    for k in range(K):
        if E[k] > 0:
            stat += z[k] * z[k] / E[k]
    return stat


def gray_permutation_test(groups, permutations=2000, seed=1):
    """groups: per cohort, a list of (t, cause, entry or None). Returns (statistic, p): p = (b + 1)/(m + 1)
    over `permutations` seeded shuffles of the cohort labels across the pooled records."""
    K = len(groups)
    rows = [(r[0], r[1], -math.inf if r[2] is None else r[2], k) for k, g in enumerate(groups) for r in g]
    t = [r[0] for r in rows]
    cause = [r[1] for r in rows]
    entry = [r[2] for r in rows]
    labels = [r[3] for r in rows]
    order = sorted(range(len(t)), key=lambda i: t[i])
    entry_order = sorted(range(len(t)), key=lambda i: entry[i])
    observed = gray_statistic(t, cause, entry, labels, K, order, entry_order)
    rnd = mulberry32(seed)
    perm = list(labels)
    n = len(perm)
    beyond = 0
    for _ in range(permutations):
        for i in range(n - 1, 0, -1):
            j = math.floor(rnd() * (i + 1))
            perm[i], perm[j] = perm[j], perm[i]
        if gray_statistic(t, cause, entry, perm, K, order, entry_order) >= observed - 1e-12:
            beyond += 1
    return observed, (beyond + 1) / (permutations + 1)
