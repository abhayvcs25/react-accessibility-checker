# 19 — Six-Model File-to-Report Phase Acceptance

## Objective

Demonstrate the completed phase: submit one supported accessibility-checker
file/input to the server, receive the existing IBM result plus separate
contextual model results, and show one consolidated report and read-only
fixing prompt.

## Preconditions

- Prompts 12–18 are complete and reviewed.
- Local tests and builds pass.
- The operator has explicitly approved the exact end-to-end live run and
  confirmed current free-tier/billing safeguards.
- No model outside the verified and explicitly enabled set may be dispatched.

## Exact acceptance sequence

1. Start the server using the documented local environment. Confirm health and
   credential readiness without exposing credential values.
2. Submit one small fixture in a supported input format. Confirm the IBM
   checker runs and returns its authoritative findings.
3. Confirm each of the six model entries is shown with its actual state.
   Dispatch only candidates that independently pass verification, account,
   operator-enable, and free-cost eligibility checks. Do not represent skipped
   or blocked models as having assessed the file.
4. Confirm each successful assessment is strictly validated against the
   dispatched target, rule, model, and evidence references before storage or
   display.
5. Confirm report aggregation retains per-model provenance and disagreement,
   and that AI results do not alter IBM findings, counts, severity, or
   conformance statements.
6. Confirm the consolidated fixing prompt contains only actionable validated
   advisory results, has bounded/redacted content, identifies uncertainty,
   and cannot modify source files.
7. Verify idempotent resubmission does not create duplicate provider work.
   Stop if repeated submission would cause additional inference.
8. Record redacted outcome evidence and actual provider usage. Confirm the
   account dashboard shows no paid charge. If any cost, unexpected usage, or
   secret exposure is detected, stop the demo and follow the provider's
   credential-revocation procedure.

## Constraints

- No paid fallback, auto-recharge, dynamic model routing, or substitution.
- Never call a blocked/unverified model to make the screen look complete.
- No automatic source modification.
- Do not change IBM behavior or merge IBM and AI results.
- Keep credentials local; never include them in screenshots, logs, reports, or
  this acceptance record.

## Final verification and phase boundary

- Run the relevant backend/frontend tests and builds, plus `git diff --check`.
- Verify that failures or blocked models remain visible and do not hide valid
  results from other models.
- Produce a final six-row status matrix separating documentation, account,
  runtime verification, and actual participation in the demo.
- List any candidates that did not run and the exact evidence or operator
  action needed next.

## Completion criteria

The supported file-to-report flow works end to end; IBM remains authoritative
and unchanged; every contextual result is attributable and validated; and
unavailable models are disclosed rather than fabricated. This closes the
six-model integration/demo phase. Any subsequent feature work begins in a new
phase after human review of the report and remaining limitations.
