---
name: Activity liveness heartbeat & scale-to-zero forensics
description: Durable principles behind bounding silent autoscale kills on the /activity audit.
---

Autoscale kills the instance with NO catchable signal — "no shutdown event" is normal, not a crash. The audit bounds the true death time with a single-row liveness heartbeat (upsert-in-place, unref'd) that the next boot reads before classifying how the previous lifetime ended.

**Why:** an append-per-tick log would bloat the events table, and any client polling would keep autoscale awake — defeating the very thing being audited. All /activity data loading must stay user-initiated.

**How to apply:**
- Ordering invariant: the new process must READ the previous liveness row before any heartbeat write can touch it — the single row is both the old death bound and the new heartbeat target, so an ungated first upsert erases the forensics.
- Classification rides in the boot event's detail, so old data needs no backfill and pre-feature boots degrade gracefully.
- The timeline's period reconstruction has exactly one implementation, shared verbatim between the page and its unit tests — never fork it.
- Only the first recorded exit cause wins; late hooks (e.g. beforeExit after a signal) must be no-ops.
