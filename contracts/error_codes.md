# API error codes

[error-codes.json](error-codes.json) is the source of truth. Run `python scripts/generate-error-codes.py` after editing it, or `--check` in validation. Only registered canonical codes appear in `error.code`. Renamed historical codes appear in optional `error.legacy_code`; service and persisted identities remain unchanged. Validation issue `code` fields are diagnostic subcodes, separate from envelope codes.

| Code | Historical aliases | UI action |
| --- | --- | --- |
| `AUTHZ_FORBIDDEN` | `AUTHZ_INSUFFICIENT_PERMISSION`, `FORBIDDEN` | Show permission error; do not retry. |
| `AUTH_CALLER_CONTEXT_INVALID` |  | Report a server integration authentication failure; repair the caller signer, not user login. |
| `AUTH_CALLER_CONTEXT_MISSING` |  | Report a server integration authentication failure; repair the caller signer, not user login. |
| `AUTH_CSRF_REJECTED` |  | Correct the same-origin request configuration or reload; do not automatically retry. |
| `AUTH_INVALID_CREDENTIALS` |  | Sign in again; refresh only AUTH_TOKEN_EXPIRED once. |
| `AUTH_RATE_LIMITED` |  | Wait for the registration cooldown; do not retry or prompt for login automatically. |
| `AUTH_TOKEN_EXPIRED` |  | Refresh once under the browser coordinator, then retry once; otherwise sign in. |
| `AUTH_TOKEN_INVALID` | `AUTH_INVALID_TOKEN` | Show sign-in; do not automatically refresh a revoked or invalid session. |
| `AUTH_TOKEN_MISSING` | `AUTH_REQUIRED` | Show sign-in; do not automatically refresh. |
| `CONFLICT_ACTIVE_RELEASE` | `ACTIVE_RELEASE_CONFLICT` | Reload current state and ask for a new action; do not automatically retry. |
| `CONFLICT_ALREADY_EXISTS` |  | Choose a different identifier or open the existing resource. |
| `CONFLICT_EMAIL_EXISTS` | `VAL_EMAIL_ALREADY_EXISTS` | Choose another email or sign in to the existing account. |
| `CONFLICT_IDEMPOTENCY_KEY` | `IDEMPOTENCY_KEY_COLLISION` | Create a new key for a new action; retry an existing key only with its original payload. |
| `CONFLICT_INVALID_STATE` |  | Reload the resource and check its current state before retrying. |
| `CONFLICT_RESOURCE_IN_USE` |  | Remove the references listed in details first. |
| `CONFLICT_RESPONSE_NOT_CANCELLABLE` | `RESPONSE_NOT_CANCELLABLE` | Read the response and show its final state; do not retry the cancel. |
| `CONFLICT_REVISION` | `REVISION_CONFLICT` | Reload current state and ask for a new action; do not automatically retry. |
| `CONFLICT_STALE_CLARIFICATION` | `STALE_CLARIFICATION` | Reload current state and ask for a new action; do not automatically retry. |
| `CONFLICT_STALE_REPORT` | `STALE_REPORT` | Reload current state and ask for a new action; do not automatically retry. |
| `CONFLICT_STALE_RESULT_REVISION` | `STALE_RESULT_REVISION` | Reload current state and ask for a new action; do not automatically retry. |
| `CONFLICT_TURN_IN_PROGRESS` | `TURN_IN_PROGRESS` | Poll GET /responses/{details.response_id} until it finishes, then send again with the new revision. |
| `CONFLICT_VERSION_EXISTS` | `VAL_VERSION_ALREADY_EXISTS` | Reload current state and ask for a new action; do not automatically retry. |
| `PUBLISH_GATE_FAILED` |  | Show publish gate details and repair the draft. |
| `RES_AVATAR_NOT_FOUND` |  | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `RES_CONVERSATION_ENDED` | `CONVERSATION_ENDED` | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `RES_CONVERSATION_EXPIRED` | `CONVERSATION_EXPIRED` | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `RES_EXPERIENCE_NOT_CONFIGURED` | `EXPERIENCE_NOT_CONFIGURED` | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `RES_NOT_FOUND` | `RESOURCE_NOT_FOUND` | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `RES_OBJECT_NOT_FOUND` |  | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `RES_RESULT_NOT_READY` | `RESULT_NOT_READY` | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `RES_USER_NOT_FOUND` |  | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `RES_VERSION_NOT_FOUND` |  | Show unavailable/missing resource or terminal state; do not automatically retry. |
| `SYS_ENGINE_FAILURE` | `ENGINE_FAILURE` | Use bounded backoff only when retryable; retain idempotency key and payload. |
| `SYS_INTERNAL_ERROR` | `INTERNAL_ERROR` | Use bounded backoff only when retryable; retain idempotency key and payload. |
| `SYS_RATE_LIMITED` | `RATE_LIMITED` | Wait for the server cooldown before a bounded retry. |
| `SYS_REQUEST_TIMEOUT` | `REQUEST_TIMEOUT` | Use bounded backoff only when retryable; retain idempotency key and payload. |
| `SYS_TURN_ABANDONED` | `TURN_ABANDONED` | Send the message again with a new idempotency key. |
| `SYS_UNAVAILABLE` | `SERVICE_UNAVAILABLE` | For not_configured repair configuration; for dependency_down use bounded backoff and Retry-After when retryable. |
| `VAL_INCOMPATIBLE_RELEASE` | `INCOMPATIBLE_RELEASE` | Show validation feedback and correct the request. |
| `VAL_INCOMPATIBLE_SCHEMA` | `INCOMPATIBLE_SCHEMA` | Show validation feedback and correct the request. |
| `VAL_INVALID_ACTIVITY_TRANSITION` | `INVALID_ACTIVITY_TRANSITION` | Show validation feedback and correct the request. |
| `VAL_INVALID_AVATAR` |  | Show validation feedback and correct the request. |
| `VAL_INVALID_INPUT` | `INVALID_INPUT`, `VAL_UNPROCESSABLE` | Show validation feedback and correct the request. |
| `VAL_INVALID_OPTION` | `INVALID_OPTION` | Show validation feedback and correct the request. |
| `VAL_INVALID_PASSWORD` |  | Show validation feedback and correct the request. |
| `VAL_INVALID_QUESTION` | `INVALID_QUESTION` | Show validation feedback and correct the request. |
| `VAL_INVALID_REQUEST` | `INVALID_REQUEST` | Show validation feedback and correct the request. |
| `VAL_METHOD_NOT_ALLOWED` | `METHOD_NOT_ALLOWED` | Show validation feedback and correct the request. |
| `VAL_PAYLOAD_TOO_LARGE` | `PAYLOAD_TOO_LARGE` | Show validation feedback and correct the request. |
| `VAL_UNSUPPORTED_MEDIA_TYPE` |  | Show validation feedback and correct the request. |
