---
name: Production env vars — agent-set values shadow the Publishing UI secrets
description: setEnvVars(environment:"production") DOES reach the deployment and takes precedence over UI-set secrets of the same key; stale agent values silently override user fixes.
---

The rule: an agent-set production env var (`setEnvVars({ environment: "production" })`) DOES land in the deployment and **shadows** a secret of the same key set by the user in the Publishing UI. When a prod deployment ignores a value the user set in the UI, first run `viewEnvVars({ environment: "production" })` — a stale agent-set env var is the prime suspect. Delete it with `deleteEnvVars` so the UI secret wins.

**Why:** 2026-08-11 — deployment kept using `us-central1` even though the user's Publishing-UI secret said `australia-southeast1`. Cause: an earlier agent `setEnvVars` call had set the prod env var (initially misdiagnosed as "didn't reach the deployment" — it had, and it was overriding the UI). Fixed by deleting the agent-set key.

**How to apply:** prefer letting the user manage prod values in the Publishing UI; if you ever set one programmatically, remember it overrides the UI and clean it up when the user takes over. `viewEnvVars` shows env-var *values* but only secret *existence*. Any production env/secret change requires a republish to take effect — a live autoscale instance keeps its boot-time env.
