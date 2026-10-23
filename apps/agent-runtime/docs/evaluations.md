# Experience definition validation

The pure validation library lives in `agent_runtime.evaluations`. It does not
register public routes or import Product database, authentication or storage code.
Unit tests live in `tests/unit` and build minimal inputs in memory. The runtime
package does not ship sample assessment content.

`ExperienceValidator` returns structural diagnostics and checks registered engine
capabilities. The production engine registry remains empty until DEC-04 rule
schemas are registered. Controlled adaptive pilots can explicitly inject
`CompatibilityChecker(PILOT_ENGINE_REGISTRY)`; this does not enable publication.

Definition 2.0 has semantic validators for the adaptive RIASEC rule payloads.
Definition 1.0 remains readable for structural diagnostics but returns
`unsupported` with `VAL_UNSUPPORTED_RULE_PAYLOAD`, even under the pilot registry.
Its branch-tree, cross-weight and staged-tie payload schemas have not been
registered with semantic validators. A nonempty legacy payload is not sufficient
evidence to certify execution or publication.

Golden-case validation checks structure and bank references. Replaying answers
and verifying the computed outcome belongs to the evaluator/engine.

Run from `apps/agent-runtime` after installing `.[dev]`:

```powershell
python -m pytest
```

Public contracts are in `contracts/openapi/public` and shared schemas are in
`contracts/openapi/schemas` at the repository root.

## Structured conversation turns (B-02)

`POST /api/v1/internal/conversations/{conversation_id}/turns` executes only
`set_name` and `submit_answer` with an option. Message, text, confirm and edit
turns are well-formed but return `422 INVALID_ACTIVITY_TRANSITION`.

- The selector runs against the release pinned on the activity, outside any
  write transaction. The default engine registry runs `career-assessment-v1`
  for Definition 2.0; other engine versions fail closed with
  `422 INCOMPATIBLE_SCHEMA`. `PILOT_ENGINE_REGISTRY` stays test-only.

## Completion, result and card (B-03)

- Completion is decided only by the engine's valid stop (`bounded_winner` or
  `question_limit`). The cap is `coverage_rules.payload.max_total` of the
  pinned definition (12..30); the demo profile uses 12. Harness only guards
  that no turn goes past that cap.
- `EngineCompletionPort` scores the answers, requires the scorer's House to
  equal the selector's, projects the `summary.v1` card/share and builds
  `ResultEvidence` (pin, definition hash, rule refs, exact scores and
  contributions). Result, card, share and evidence are written in the same
  commit as the final answer and the `completed` state.
- Evidence lives in `result_snapshots.evidence` and is never returned by the
  result or share-card APIs.
- Scorer/projection failures return `422 ENGINE_FAILURE` (legacy 1.0
  definitions: `422 INCOMPATIBLE_SCHEMA`) and write nothing; the same request
  can be retried.
- Golden paths (AT-07), evidence (AT-13) and pure-engine parity (AT-20, partial)
  are in `tests/integration/test_turn_completion.py`.
- There is no public TypeScript route for turns yet.

Integration checks need a disposable PostgreSQL 16 admin URL:

```bash
RUNTIME_TEST_ADMIN_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/sda_b01_admin \
  python -m pytest -m integration --require-runtime-db
```
