"""With 15 questions, tied winners must not favour any house (the old fixed tie order always picked R)."""
import collections
import random

from agent_runtime.engine.fixtures.holland_career_pool import sample_experience_definition
from agent_runtime.engine.services.selector import AdaptiveQuestionSelector


def test_tie_winners_spread_across_houses():
    doc = sample_experience_definition(seed=7, return_dict=True)
    house_of = {q["question_id"]: q["house_id"] for q in doc["questions"]}
    rng, selector = random.Random(0), AdaptiveQuestionSelector()  # random only simulates students
    tie_winners = collections.Counter()
    for n in range(300):
        pref = {h: rng.choice([2, 3, 4]) for h in sorted(set(house_of.values()))}
        answers = []
        # Replay is covered elsewhere; skipping it keeps 300 simulated students fast.
        while (r := selector.select_next_question(answers, definition=doc, validate_sequence=False,
                                                  seed=f"act_{n}")).next_question_id:
            qid = r.next_question_id
            answers.append({"question_id": qid, "option_id": f"{qid}_opt_{pref[house_of[qid]]}"})
        assert len(answers) <= 15
        if r.tie_applied:
            tie_winners[r.primary_house_id] += 1
    assert sum(tie_winners.values()) >= 30
    assert max(tie_winners.values()) <= 0.35 * sum(tie_winners.values()), tie_winners
