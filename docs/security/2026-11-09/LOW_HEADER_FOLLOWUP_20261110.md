# Local gateway security-header follow-up — 10 November 2026

## Finding and change

The earlier authenticated local ZAP report recorded four low-risk alert types on the gateway: missing or invalid `Cross-Origin-Embedder-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and `Permissions-Policy`. The gateway now sends `require-corp`, `same-origin`, `same-origin`, and an explicit deny policy for camera, microphone, geolocation, payment, and USB. The page currently loads its script and stylesheet from the same origin; no cross-origin embed or browser feature is part of this tested flow.

## Verification and limits

The updated gateway's HTML, script, JSON, and API-error responses passed the focused header regression. The full Node suite passed **441/441** with no skips. A passive ZAP baseline scan of an isolated gateway on an internal Docker network reported **0 high, 0 medium, 0 low, and 1 informational alert type**; the four earlier low-risk header types were absent. The remaining informational alert concerns a comment in public JavaScript and does not identify a secret. ZAP exited with code **2** because it classified that informational finding as a warning; this was not a warning-free scan.

This rescan used a gateway with no upstream business services. ZAP recorded network failures for unreachable API endpoints and did not perform an authenticated application journey. The earlier authenticated scan and 13 selected protected API checks remain separate evidence. These results do not prove production security or browser compatibility for a future cross-origin integration. The response-header regression is relevant to API responses, but the scan itself chiefly reached the public gateway surface.

## Retained evidence

- [Original ZAP JSON, Markdown, scan log and SHA-256 checksums](ReleaseGuard_Low_Header_Rescan_20261110.zip)
- [Previous authenticated scan and API checks](FOLLOWUP_20261110.md)

The isolated gateway used synthetic test secrets and no model key. The report paths are relative to this PR branch. SAST and DAST are still local checks; the hosted CI workflow does not run Semgrep or ZAP.
