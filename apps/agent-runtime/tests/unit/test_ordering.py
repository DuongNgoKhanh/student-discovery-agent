"""Seeded ordering primitives: platform-independent and reproducible per activity."""
import hashlib

from agent_runtime.engine.services.ordering import rank_houses, seeded_order, shuffle_key

HOUSES = ["house_r", "house_i", "house_a", "house_s", "house_e", "house_c"]


def test_shuffle_key_is_sha256_of_joined_parts():
    assert shuffle_key("act_1", "house", "house_r") == hashlib.sha256(b"act_1|house|house_r").digest()


def test_seeded_order_is_stable_and_seed_dependent():
    assert seeded_order("act_1", "house", HOUSES) == seeded_order("act_1", "house", list(reversed(HOUSES)))
    orders = {tuple(seeded_order(f"act_{n}", "house", HOUSES)) for n in range(20)}
    assert len(orders) > 10


def test_purposes_shuffle_independently():
    assert seeded_order("act_1", "baseline-round-1", HOUSES) != seeded_order("act_1", "baseline-round-2", HOUSES)


def test_rank_by_mean_first():
    ratings = {"house_r": [3, 3], "house_i": [4, 4], "house_a": [1], "house_s": [], "house_e": [], "house_c": []}
    assert rank_houses(HOUSES, ratings, "act_1")[:3] == ["house_i", "house_r", "house_a"]


def test_equal_mean_broken_by_count_of_top_ratings():
    ratings = {h: [] for h in HOUSES} | {"house_r": [3, 3, 3, 3], "house_c": [5, 1, 3, 3]}
    assert rank_houses(HOUSES, ratings, "act_1")[0] == "house_c"


def test_full_tie_broken_by_seed_not_by_house_order():
    ratings = {h: [4, 4] for h in HOUSES}
    winners = {rank_houses(HOUSES, ratings, f"act_{n}")[0] for n in range(60)}
    assert winners == set(HOUSES)


def test_unanswered_houses_rank_last():
    ratings = {h: [] for h in HOUSES} | {"house_c": [1]}
    assert rank_houses(HOUSES, ratings, "act_1")[0] == "house_c"
