"""Seeded, platform-independent ordering for Definition 2.0 selection and house ranking.

Keys are sha256 digests, never the `random` module, so the same activity (seed) replays to the same
question order and the same winner on any Python version or outside Python.
"""

import hashlib
from fractions import Fraction
from typing import Iterable, Mapping, Sequence

TOP_RATING = 5


def shuffle_key(seed: str, purpose: str, ident: str) -> bytes:
    return hashlib.sha256(f"{seed}|{purpose}|{ident}".encode("utf-8")).digest()


def seeded_order(seed: str, purpose: str, idents: Iterable[str]) -> list[str]:
    return sorted(idents, key=lambda ident: shuffle_key(seed, purpose, ident))


def rank_houses(house_ids: Iterable[str], ratings: Mapping[str, Sequence[int]], seed: str) -> list[str]:
    """Answered houses first, then higher exact mean, more top ratings, and finally the seeded key."""
    def key(house_id: str):
        given = ratings.get(house_id, ())
        seeded = shuffle_key(seed, "house", house_id)
        if not given:
            return (1, Fraction(0), 0, seeded)
        return (0, -Fraction(sum(given), len(given)), -list(given).count(TOP_RATING), seeded)

    return sorted(house_ids, key=key)
