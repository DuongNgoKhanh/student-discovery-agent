import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

ROOT = Path(__file__).resolve().parents[5]
FIXTURE = json.loads((ROOT / 'contracts/fixtures/session-lifecycle.json').read_text(encoding='utf-8-sig'))


def models():
    # Missing DTOs must be an assertion failure rather than a collection error.
    try:
        from agent_runtime.sessions.schemas import activity, conversation
    except ImportError as error:
        pytest.fail(f'Session contract DTOs have not been implemented: {error}')
    return activity, conversation


def test_closed_ack_contains_no_session_content():
    _, conversation = models()
    closed_ack = conversation.ClosedConversationAcknowledgement.model_validate(FIXTURE['closed_ack'])
    assert set(closed_ack.model_dump()) == {'conversation_id', 'status', 'revision', 'closed_at', 'expires_at'}
    for forbidden in ('display_name', 'answers', 'result', 'owner_id'):
        with pytest.raises(ValidationError):
            conversation.ClosedConversationAcknowledgement.model_validate({**FIXTURE['closed_ack'], forbidden: 'secret'})


def test_adaptive_requires_view_v2_and_manifest():
    activity, conversation = models()
    adaptive_state = TypeAdapter(activity.ActivityState).validate_python(FIXTURE['adaptive_state'])
    assert adaptive_state.progress.total is None
    assert adaptive_state.progress.completed == 14
    request = conversation.CreateConversationInput.model_validate(FIXTURE['adaptive_create'])
    assert request.accepted_activity_profiles == ('riasec.mean.bounds.v2',)
    for bad in ({**FIXTURE['adaptive_state'], 'schema_version': 1},
                {**FIXTURE['adaptive_create'], 'supported_blocks': [{'type': 'text', 'schema_versions': [1]}]}):
        with pytest.raises(ValidationError):
            if 'state_schema_version' in bad:
                TypeAdapter(activity.ActivityState).validate_python(bad)
            else:
                conversation.CreateConversationInput.model_validate(bad).capability_snapshot()


def test_legacy_stays_bounded_at_six():
    activity, _ = models()
    legacy = TypeAdapter(activity.ActivityState).validate_python(FIXTURE['legacy_state'])
    assert legacy.progress.total == 6
    bad = deepcopy(FIXTURE['legacy_state'])
    bad['progress']['completed'] = 7
    with pytest.raises(ValidationError):
        TypeAdapter(activity.ActivityState).validate_python(bad)


def test_unknown_state_version_is_rejected():
    activity, _ = models()
    with pytest.raises(ValidationError):
        TypeAdapter(activity.ActivityState).validate_python({**FIXTURE['adaptive_state'], 'state_schema_version': 99})


@pytest.mark.parametrize('mutation', [
    {'expected_revision': -1}, {'expected_revision': 9007199254740992},
    {'expected_revision': True}, {'owner_id': 'forged'}, {'idempotency_key': ''},
])
def test_end_input_guards_revisions_and_server_owned_identity(mutation):
    _, conversation = models()
    with pytest.raises(ValidationError):
        conversation.EndConversationInput.model_validate({'expected_revision': 0, 'idempotency_key': 'end1', **mutation})


def test_legacy_defaults_and_adaptive_manifest_are_not_implicitly_expanded():
    _, conversation = models()
    request = conversation.CreateConversationInput(idempotency_key='create1')
    assert request.accepted_activity_profiles == ()
    assert all(block.schema_versions == (1,) for block in request.supported_blocks)
    with pytest.raises(ValidationError):
        conversation.CreateConversationInput(idempotency_key='create2', accepted_activity_profiles=['riasec.mean.bounds.v2']).capability_snapshot()
    with pytest.raises(ValidationError):
        conversation.CreateConversationInput(idempotency_key='create3', accepted_activity_profiles=['unregistered']).capability_snapshot()


@pytest.mark.parametrize('change', ['non_contiguous', 'duplicate_question', 'wrong_option', 'progress', 'premature_total'])
def test_state_rejects_structurally_corrupt_answers_without_scoring(change):
    activity, _ = models()
    value = deepcopy(FIXTURE['adaptive_state'])
    if change == 'non_contiguous':
        value['answers'][0]['ordinal'] = 2
    elif change == 'duplicate_question':
        value['answers'][1]['question_id'] = value['answers'][0]['question_id']
    elif change == 'wrong_option':
        value['answers'][0]['option_id'] = 'missing'
    elif change == 'progress':
        value['progress']['completed'] = 13
    else:
        value['progress']['total'] = 30
    with pytest.raises(ValidationError):
        TypeAdapter(activity.ActivityState).validate_python(value)


@pytest.mark.parametrize('timestamp', ['2026-10-20T00:30:00', '2026-10-20T00:30:00+07:00'])
def test_closed_ack_requires_utc_timestamps(timestamp):
    _, conversation = models()
    with pytest.raises(ValidationError):
        conversation.ClosedConversationAcknowledgement.model_validate({**FIXTURE['closed_ack'], 'closed_at': timestamp})


def test_release_descriptor_requires_metadata_for_its_kind():
    models()
    from agent_runtime.sessions.schemas.release import AgentSnapshotV1, ReleaseDescriptor
    with pytest.raises(ValidationError):
        AgentSnapshotV1(greeting_text=' ', allowed_activity_profiles=[])
    with pytest.raises(ValidationError):
        AgentSnapshotV1(greeting_text='Hello', allowed_activity_profiles=['x', 'x'])
    with pytest.raises(ValidationError):
        ReleaseDescriptor(environment='demo', kind='experience', release_id='rel1', content_hash='sha256:' + 'a' * 64,
                          delivery_schema_version='experience.snapshot.v1', content={}, is_demo=True)


def test_share_projection_does_not_admit_internal_scores():
    models()
    from agent_runtime.sessions.schemas.result import ShareCard
    with pytest.raises(ValidationError):
        ShareCard(schema_version=1, projection_version='summary.v1', result_id='res1', result_revision=1,
                  activity_id='act1', display_name='Ngân', house={'house_id': 'h1', 'name': 'House',
                  'theme_ref': 'theme1', 'mascot_ref': 'mascot1'}, branding={'brand_ref': 'brand', 'label': 'Brand'},
                  is_demo=True, demo_label='Demo', template_ref='summary1', scores={'R': 99})

@pytest.mark.parametrize('bad_block', [
    {'block_id': 'b1', 'type': 'text', 'schema_version': 99, 'content': 'Hello'},
    {'block_id': 'b1', 'type': 'text', 'schema_version': 1},
    {'block_id': 'b1', 'type': 'unknown', 'schema_version': 1},
])
def test_new_message_rejects_unregistered_or_malformed_blocks(bad_block):
    activity, _ = models()
    with pytest.raises(ValidationError):
        activity.NewMessage(message_id='msg1', role='assistant', blocks=[bad_block])


def test_commit_patch_cannot_invalidate_its_current_result():
    activity, _ = models()
    value = deepcopy(FIXTURE['adaptive_state'])
    value.update(status='ended', current_question=None, current_result_id='res1')
    value['progress'].update(phase='completed', total=14)
    with pytest.raises(ValidationError):
        activity.CommitPatch(request_input={'expected_revision': 0}, activity_id='act1', expected_activity_revision=0,
                             next_state=value, append_messages=[], new_result=None,
                             invalidate_result_ids=['res1'], response_data={})


def test_policy_cannot_slide_demo_ttl_or_exceed_resource_limits():
    models()
    from agent_runtime.sessions.schemas.common import RuntimePolicy
    for override in ({'session_ttl_seconds': 7200}, {'max_json_bytes': 65537}, {'cleanup_batch_size': 101}):
        with pytest.raises(ValidationError):
            RuntimePolicy(environment='demo', **override)


def test_new_message_accepts_registered_versions_and_serializes_public_blocks():
    activity, _ = models()
    block = {'block_id': 'b1', 'type': 'text', 'schema_version': 1, 'content': 'Hello'}
    message = activity.NewMessage(message_id='msg1', role='assistant', blocks=[block])
    assert message.model_dump(mode='json')['blocks'] == [block]
    adaptive = {'block_id': 'b2', 'type': 'assessment_question', 'schema_version': 2, 'activity_id': 'act1',
                'progress': FIXTURE['adaptive_state']['progress'], **FIXTURE['adaptive_state']['current_question']}
    message = activity.NewMessage(message_id='msg2', role='assistant', blocks=[adaptive])
    assert message.blocks[0].schema_version == 2


def test_agent_descriptor_accepts_the_exact_snapshot_schema_and_rejects_extras():
    models()
    from agent_runtime.sessions.schemas.release import ReleaseDescriptor
    descriptor = {'environment': 'demo', 'kind': 'agent', 'release_id': 'rel1',
                  'content_hash': 'sha256:' + 'a' * 64, 'delivery_schema_version': 'agent.snapshot.v1',
                  'content': FIXTURE['agent_snapshot'], 'is_demo': True}
    assert ReleaseDescriptor.model_validate(descriptor).content['greeting_text'] == 'Xin chào'
    with pytest.raises(ValidationError):
        ReleaseDescriptor.model_validate({**descriptor, 'content': {**FIXTURE['agent_snapshot'], 'raw_provider': 'x'}})


def test_missing_adaptive_manifest_has_a_machine_readable_incompatibility_code():
    _, conversation = models()
    with pytest.raises(ValidationError) as caught:
        conversation.CreateConversationInput(idempotency_key='create1', accepted_activity_profiles=['riasec.mean.bounds.v2']).capability_snapshot()
    assert caught.value.errors()[0]['type'] == 'incompatible_schema'


def test_history_interaction_does_not_store_arbitrary_provider_payload():
    activity, _ = models()
    with pytest.raises(ValidationError):
        activity.NewMessage(message_id='msg1', role='user', blocks=[], interaction={'raw_provider_response': 'secret'})


@pytest.mark.parametrize('cap', [12, 20, 30])
def test_adaptive_progress_accepts_a_definition_question_cap(cap):
    activity, _ = models()
    progress = activity.AssessmentProgressV2(completed=cap, max_total=cap, total=cap, phase='completed')
    assert progress.max_total == cap and progress.min_total == 12


@pytest.mark.parametrize('progress', [
    {'completed': 0, 'max_total': 11, 'total': None, 'phase': 'baseline'},
    {'completed': 0, 'max_total': 31, 'total': None, 'phase': 'baseline'},
    {'completed': 13, 'max_total': 12, 'total': 13, 'phase': 'completed'},
])
def test_adaptive_progress_rejects_caps_outside_the_contract(progress):
    activity, _ = models()
    with pytest.raises(ValidationError):
        activity.AssessmentProgressV2(**progress)


def test_evidence_requires_completed_scoring_and_the_result_release():
    models()
    from agent_runtime.sessions.schemas.result import ResultEvidence
    from tests.helpers.builders import fixture_evidence
    evidence = fixture_evidence('experience-x')
    with pytest.raises(ValidationError):
        ResultEvidence.model_validate(evidence.model_dump(mode='json') | {
            'scoring': {'schema_version': '2.0', 'is_complete': False, 'total_answers': 11}})
    with pytest.raises(ValidationError):
        ResultEvidence.model_validate(evidence.model_dump(mode='json') | {'answers': []})


def test_result_snapshot_rejects_evidence_from_another_release():
    models()
    from agent_runtime.sessions.schemas.result import ResultSnapshotInput
    from tests.helpers.builders import fixture_evidence
    card = {'display_name': 'Ngân', 'house': {'house_id': 'h1', 'name': 'House', 'theme_ref': 't', 'mascot_ref': 'm'},
            'strengths': ['S'], 'tendencies': ['T'], 'career_groups': ['G'], 'quote': 'Q', 'is_demo': True}
    data = {'result_id': 'res1', 'activity_id': 'act1', 'result_revision': 1, 'source_activity_revision': 13,
            'result_projection': {'result_id': 'res1', 'result_revision': 1, 'conversation_id': 'conv',
                                  'activity_id': 'act1', 'activity_type': 'personality_assessment_adaptive',
                                  'experience_release_id': 'experience-x', 'created_at': '2026-10-23T00:00:00Z',
                                  'data': card},
            'card_projection': card,
            'share_projection': {'result_id': 'res1', 'result_revision': 1, 'activity_id': 'act1',
                                 'display_name': 'Ngân', 'house': card['house'],
                                 'branding': {'brand_ref': 'ihrd', 'label': 'IHRD'}, 'is_demo': True,
                                 'demo_label': 'Demo', 'template_ref': 'share_summary_v1'}}
    ResultSnapshotInput.model_validate(data | {'evidence': fixture_evidence('experience-x').model_dump(mode='json')})
    with pytest.raises(ValidationError):
        ResultSnapshotInput.model_validate(data | {'evidence': fixture_evidence('experience-y').model_dump(mode='json')})
