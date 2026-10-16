# Experience definition validation

The pure validation library lives in `agent_runtime.evaluations`. It does not
register public routes or import Product database, authentication or storage code.
JSON fixtures ship with the runtime package; unit tests live in `tests/unit`.

`ExperienceValidator` returns structural diagnostics and checks registered engine
capabilities. The production engine registry remains empty until DEC-04 rule
schemas are registered. Controlled adaptive pilots can explicitly inject
`CompatibilityChecker(PILOT_ENGINE_REGISTRY)`; this does not enable publication.

Definition 2.0 has semantic validators for the adaptive RIASEC rule payloads.
Definition 1.0 remains readable for structural diagnostics but returns
`unsupported` with `VAL_UNSUPPORTED_RULE_PAYLOAD`, even under the pilot registry.
Its branch-tree, cross-weight and staged-tie payload schemas have not been
registered with semantic validators. A nonempty legacy payload is not sufficient
evidence to certify execution or publication. The legacy JSON fixture is a
transport example, not an executable validated definition.

Golden-case validation checks structure and bank references. Replaying answers
and verifying the computed outcome belongs to the evaluator/engine.

Run from `apps/agent-runtime` after installing `.[dev]`:

```powershell
python -m pytest
```

Public contracts are in `contracts/openapi/public` and shared schemas are in
`contracts/openapi/schemas` at the repository root.
