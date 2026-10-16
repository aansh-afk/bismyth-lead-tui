# Contract validation report

Date: 13 October 2026. Scope: the developer handoff's proposed REST/event contract and synthetic examples. This is not a deployed-router or WhatsApp test.

## Setup and method

Executed `python3 validate_contract.py` using the available Python `jsonschema` package. The script performs no network calls. It checks local schema references, route parameters, unique operation IDs, documented authentication errors, JSON Schema validity, request/response examples and typed events.

Negative cases cover an invalid phone, omitted preview flag, a preview with a fake sent-message ID, unknown event type, a receipt missing its message ID and an unexpected send field. A positive case permits an unresolved LID with a null phone mapping.

## Results

- **193 structural/schema checks passed.** This count includes repeated reference checks; it is not 193 independent integration tests.
- 11 REST routes and 17 component schemas checked.
- 11 positive request/response examples and four typed event examples validated.
- Six deliberately invalid examples rejected.
- Observed validation command wall time: 0.445 seconds, one run; not a performance benchmark.
- Network calls: zero. Actual sends, pairing and account access: zero.

## Limitations and conclusion

The checks validate this package's structure and examples, not a full third-party OpenAPI conformance validator or a running implementation. They cannot prove API authentication, durable idempotency, event replay, pairing, phone attribution or delivery. The developer must run `acceptance-checklist.md` against the actual service, with controlled user-selected accounts/recipients, and report the results.

The handoff contract is ready to give to the router developer. The router and its TUI adapter remain unimplemented.
