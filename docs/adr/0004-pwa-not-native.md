# ADR 0004 — Progressive Web App rather than a native mobile application

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** Principal Software Architect, UX/UI Designer

## Context

The system must serve a field assessor on a phone in a village with no signal, a nurse on a tablet
at a triage station, a pharmacist at a counter, and a facility manager on a laptop. Field work
requires offline capture including photographs. Connectivity is intermittent 3G at best.

## Decision

Build a single installable Progressive Web App (React 19 + Vite, Workbox service worker, Dexie over
IndexedDB). No native application in Release 1.

## Consequences

**Positive**
- One codebase and one design system across every device and role.
- Updates deploy instantly, without an app-store review. When a tariff or an assessment template
  changes, every device has it on next load — a native release cycle would make the assessment
  engine's configurability nearly useless.
- Install-to-home-screen gives the field experience the app affordance staff expect.
- Service worker plus IndexedDB covers the offline scope defined in
  `docs/architecture/09-offline-first.md`.
- No app-store account, signing certificates, or distribution overhead for a single-facility pilot.

**Negative — stated plainly**
- **No background sync while the app is closed.** The queue drains when the app is opened with
  connectivity. Mitigated by a prominent pending-record count and a sync prompt on reconnection.
- **No hardware biometrics.** The specification makes biometric attendance explicitly optional
  (§24); QR and PIN are implemented, and a biometric bridge can be added later.
- **iOS storage eviction.** Safari may evict IndexedDB under storage pressure. Mitigated by
  requesting persistent storage, warning at 80% quota, blocking capture at 95%, and prioritising
  sync of the oldest records. This is the single most significant risk in this decision, and it is
  monitored rather than assumed away.
- **Camera and large-file handling** is less reliable than native. Mitigated by capturing at bounded
  resolution and re-encoding to WebP immediately.

## Revisit criteria

This decision should be revisited if any of the following is observed in the field:

1. iOS storage eviction causes actual data loss more than once.
2. Background sync proves necessary because staff do not reliably open the app when connectivity
   returns.
3. Biometric attendance becomes a contractual requirement.

Because the API and `packages/contracts` are client-agnostic, a React Native client can be added
later without changing a line of server code. That is the property that makes this decision
reversible, and it is why it is safe to take now.
