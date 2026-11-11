from __future__ import annotations

from scripts.mobile.mobile_migration_preflight import (
    BASE_REVISION,
    BIOMETRIC_REVISION,
    PUSH_REVISION,
    assess_migration_state,
    collect_ancestry,
    load_migration_graph,
    offline_report,
)


def test_mobile_migration_graph_is_linear_and_fail_closed_offline():
    scripts, head = load_migration_graph()

    report = offline_report(scripts, head)

    assert tuple(scripts.get_heads()) == (head,)
    assert report["repository_head"] == head
    assert report["required_chain"] == [BASE_REVISION, PUSH_REVISION, BIOMETRIC_REVISION]
    assert {BASE_REVISION, PUSH_REVISION, BIOMETRIC_REVISION} <= set(collect_ancestry(scripts, (head,)))
    assert report["production_connected"] is False
    if head == BIOMETRIC_REVISION:
        assert report["ready"] is True
    else:
        assert report["ready"] is False
        assessment = assess_migration_state(
            repository_head=head,
            current_revisions=(BASE_REVISION,),
            applied_revisions=frozenset({BASE_REVISION}),
            push_table_exists=False,
            biometric_table_exists=False,
        )
        assert assessment.reasons == ("repository_head_changed",)
        assert assessment.safe_to_upgrade is False


def test_mobile_migration_preflight_accepts_expected_clean_start():
    assessment = assess_migration_state(
        repository_head=BIOMETRIC_REVISION,
        current_revisions=(BASE_REVISION,),
        applied_revisions=frozenset({BASE_REVISION}),
        push_table_exists=False,
        biometric_table_exists=False,
    )

    assert assessment.status == "ready"
    assert assessment.safe_to_upgrade is True
    assert assessment.reasons == ()


def test_mobile_migration_preflight_accepts_already_applied_chain():
    assessment = assess_migration_state(
        repository_head=BIOMETRIC_REVISION,
        current_revisions=(BIOMETRIC_REVISION,),
        applied_revisions=frozenset({BASE_REVISION, PUSH_REVISION, BIOMETRIC_REVISION}),
        push_table_exists=True,
        biometric_table_exists=True,
    )

    assert assessment.status == "already_current"
    assert assessment.safe_to_upgrade is False


def test_mobile_migration_preflight_rejects_schema_drift_and_contention():
    assessment = assess_migration_state(
        repository_head=BIOMETRIC_REVISION,
        current_revisions=(PUSH_REVISION,),
        applied_revisions=frozenset({BASE_REVISION, PUSH_REVISION}),
        push_table_exists=False,
        biometric_table_exists=True,
        long_transactions=1,
        waiting_locks=2,
    )

    assert assessment.status == "needs_review"
    assert assessment.safe_to_upgrade is False
    assert set(assessment.reasons) == {
        "push_outbox_revision_table_mismatch",
        "biometric_revision_table_mismatch",
        "long_transactions_present",
        "waiting_locks_present",
    }


def test_mobile_migration_preflight_rejects_changed_repository_head():
    assessment = assess_migration_state(
        repository_head="future_revision",
        current_revisions=(BASE_REVISION,),
        applied_revisions=frozenset({BASE_REVISION}),
        push_table_exists=False,
        biometric_table_exists=False,
    )

    assert assessment.status == "needs_review"
    assert assessment.reasons == ("repository_head_changed",)
