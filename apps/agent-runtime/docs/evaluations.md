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
  write transaction. The default engine registry is empty until DEC-04, so a
  production container fails closed with `422 INCOMPATIBLE_SCHEMA`. Tests
  inject `PILOT_ENGINE_REGISTRY` explicitly.
- No completion projector is configured before B-03/C-04. When the engine
  reports completion, the turn returns `503 SERVICE_UNAVAILABLE` and the final
  answer is not stored. Tests use a fixture projector only to prove the
  interface and atomic commit; that is not scoring or golden-path (AT-07)
  evidence.
- There is no public TypeScript route for turns yet.

Integration checks need a disposable PostgreSQL 16 admin URL:

```bash
RUNTIME_TEST_ADMIN_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/sda_b01_admin \
  python -m pytest -m integration --require-runtime-db
```
