"""Recipient normalisation of AI mail drafts.

Models send recipients in many shapes (null, one string, objects, 'Имя <адрес>'); a validation error there
silently loses the whole letter, and an end-to-end test cannot enumerate the shapes a model may produce.
"""
import pytest

from backend.ai_chat.tools.office import MailDraftArgs


def _draft(**kwargs):
    return MailDraftArgs(subject="Тема", body="Текст", **kwargs)


@pytest.mark.parametrize(
    ("kwargs", "to", "cc", "bcc"),
    [
        ({"to": ["a@x.ru", "b@x.ru"]}, ["a@x.ru", "b@x.ru"], [], []),
        ({"to": "a@x.ru, b@x.ru"}, ["a@x.ru", "b@x.ru"], [], []),
        ({"to": ["a@x.ru, b@x.ru"]}, ["a@x.ru", "b@x.ru"], [], []),
        ({"to": ["a@x.ru"], "cc": ["b@x.ru", "c@x.ru"]}, ["a@x.ru"], ["b@x.ru", "c@x.ru"], []),
        ({"to": ["a@x.ru"], "cc": None, "bcc": None}, ["a@x.ru"], [], []),
        ({"to": ["a@x.ru"], "cc": "b@x.ru; c@x.ru"}, ["a@x.ru"], ["b@x.ru", "c@x.ru"], []),
        ({"to": [{"email": "a@x.ru", "name": "А"}], "cc": [{"address": "b@x.ru"}]}, ["a@x.ru"], ["b@x.ru"], []),
        ({"to": ["Иванов <a@x.ru>"]}, ["a@x.ru"], [], []),
        ({"to": ["a@x.ru"], "cc": ["A@x.ru", "b@x.ru"], "bcc": ["b@x.ru", "c@x.ru"]}, ["a@x.ru"], ["b@x.ru"], ["c@x.ru"]),
    ],
)
def test_recipient_shapes_are_normalised(kwargs, to, cc, bcc):
    draft = _draft(**kwargs)
    assert (draft.to, draft.cc, draft.bcc) == (to, cc, bcc)


def test_name_without_address_is_rejected_with_a_hint_for_the_model():
    with pytest.raises(ValueError, match="office.mail.contacts.resolve"):
        _draft(to=["Иванову"])
