---
name: Production env vars must be set via Publishing UI
description: Agent setEnvVars(environment:"production") reported success but the deployed app did not receive the values; user had to set them manually.
---

The rule: never assume a programmatic `setEnvVars({ environment: "production" })` call actually reached the published deployment's secrets. Have the user verify/set production values in the Publishing UI (Adjust settings → Secrets), then republish.

**Why:** 2026-08-11 — set `TACTICTOES_FUNCTIONS_REGION` for production via the env-vars callback; call returned success, but the user reported the Replit UI showed different per-environment values and had to set production=australia-southeast1 / development=us-central1 manually. Also: `viewEnvVars` shows secret *existence only*, never values, so "same keys in both environments" says nothing about the values matching.

**How to apply:** when a prod-vs-dev config difference is suspected, ask the user to read the values in the UI instead of inferring from existence checks; after any production env change (by anyone), a republish is required for it to take effect.
