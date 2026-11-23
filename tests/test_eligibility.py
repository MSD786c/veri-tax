"""NR-02 catalogue against FTA guide VATGRH1 (June 2026), Appendix 1."""
from datetime import date

import pytest

from app.eligibility import Verdict, classify, classify_invoice

D = date(2026, 6, 1)
DONE = date(2026, 9, 1)


@pytest.mark.parametrize("text,expected", [
    ("Block work and plastering", Verdict.ELIGIBLE),
    ("Reinforcement steel and cement supply", Verdict.ELIGIBLE),
    ("Central air conditioning and split units", Verdict.ELIGIBLE),
    ("Lighting and switchgear installation", Verdict.ELIGIBLE),
    ("Solar panels", Verdict.ELIGIBLE),
    ("Swimming pool construction", Verdict.ELIGIBLE),  # FTA Decision No. 5 of 2026
    ("Gym room fit-out", Verdict.ELIGIBLE),
    ("Living room furniture and sofa set", Verdict.NOT_ELIGIBLE),
    ("Supply and installation of television", Verdict.NOT_ELIGIBLE),  # "installation" does not rescue it
    ("Washing machine and dryer", Verdict.NOT_ELIGIBLE),
    ("Curtains", Verdict.NOT_ELIGIBLE),
    ("CCTV cameras and integrated smart security system", Verdict.REVIEW),  # guide lists both ways
    ("Intelligent lighting system", Verdict.REVIEW),
    ("Built-in kitchen with oven", Verdict.REVIEW),  # eligible kitchen, appliance not eligible
    ("Carpet", Verdict.REVIEW),
    ("Miscellaneous items", Verdict.REVIEW),  # not recognised: never guessed
])
def test_classify(text, expected):
    assert classify(text, D, DONE).verdict == expected


def test_2026_additions_and_post_completion_work_go_to_a_person():
    assert classify("Swimming pool", date(2025, 11, 1), DONE).verdict == Verdict.REVIEW  # before 1 Jan 2026
    assert classify("Landscaping and trees", date(2026, 10, 1), DONE).verdict == Verdict.REVIEW  # after completion
    assert classify("Landscaping and trees", D, DONE).verdict == Verdict.ELIGIBLE


def test_mixed_invoice_suggests_the_eligible_amount():
    lines = [{"description": "Flooring tiles", "amount": 8000}, {"description": "Sofa", "amount": 2000}]
    result = classify_invoice("Mixed", lines, 10000, D, DONE)
    assert result.verdict == Verdict.REVIEW and result.eligible_taxable == 8000
