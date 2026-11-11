# ReleaseGuard SAST and DAST evidence — 9 November 2026

## Scope and source identity

The source under test was the public `limidexy/releaseguard-team13` `main` commit `d89ca78ff6828659f6f127915f117365546828b2`. The first dynamic scan ran against an isolated eight-service Docker Compose instance built from that commit, bound only to `127.0.0.1:5199`. A separate worktree, `fix/security-scan-headers-20261109`, changed the gateway CSP and one regression assertion; the second isolated instance used `127.0.0.1:5200`. The scan target in both instances was the gateway on its private Compose network, `http://gateway:8080/`. No live model key, cloud deployment, real user data, or external production target was used.

These are **local scan artifacts**. The historical hosted CI runs described below did not execute Semgrep or ZAP. [PR #53](https://github.com/limidexy/releaseguard-team13/pull/53) later merged the fixes into `main`. The [gateway header follow-up](LOW_HEADER_FOLLOWUP_20261110.md) links to the current hosted security gates.

## Hosted pull-request check

The first hosted check for PR #53, [run 42651826186](https://github.com/limidexy/releaseguard-team13/actions/runs/42651826186), **failed** in the retained-artifact Governance rollback check: `docker image inspect` could not read `.Config.Labels` from an older image without labels. The Windows job passed, but later Linux gates did not run. The follow-up changed this lookup to tolerate an absent label map and added a regression test. On the updated PR head `99e7712be9172620b6a292b0b999607136ac7f04`, [run 42659493342](https://github.com/limidexy/releaseguard-team13/actions/runs/42659493342) **passed** both Linux and Windows jobs, including the rollback check, dependency gate, image gate and evidence upload. This verifies that PR head in CI; it does not establish a production deployment or a hosted Semgrep/ZAP scan.

## Results

| Check | Before fix | After fix | Interpretation |
| --- | --- | --- | --- |
| Semgrep CE 1.183.0, `p/owasp-top-ten` | 80 rules, 108 files, 0 findings, 0 scan errors | 80 rules, 108 files, 0 findings, 0 scan errors | No finding within this rule set; this is not a proof of vulnerability absence. |
| ZAP 2.17.0 baseline, passive | 6 URLs; 0 high, 0 medium, 4 low alert types, 2 informational alert types | Not rerun | Initial quick inventory only. |
| ZAP 2.17.0 full scan, spider plus active scan | 6 URLs; 0 high, **1 medium**, 4 low alert types, 2 informational alert types | 6 URLs; 0 high, **0 medium**, 4 low alert types, 2 informational alert types | The medium alert disappeared after the CSP fix. ZAP exited with code 2 on both runs because low warnings remain; it did not report a failed rule. |
| Node 24 build and automated tests | Existing main built as part of the initial Docker image | **440 passed, 0 failed, 0 skipped**; fixed Docker image built and all 8 services became healthy | Regression evidence for this narrow code change, not a substitute for DAST. |

## Finding, fix, and rescan

The full scan reported `CSP: Failure to Define Directive with No Fallback` (ZAP rule 10055, medium risk, high confidence). Its detail identified the missing `form-action` directive. The gateway already set a CSP, including `frame-ancestors 'none'`, but the missing form rule allowed a page form to target another origin. The fix adds `form-action 'self'` to the existing CSP and checks it in `tests/environment.test.ts`. The fixed gateway's captured response headers contain the new directive. The repeat full scan no longer reports rule 10055.

Four low-risk alert types remained in this rescan: absent Cross-Origin-Embedder-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy, and Permissions-Policy response headers. A [later fix and rescan](LOW_HEADER_FOLLOWUP_20261110.md) addressed those headers. Two informational alerts are a benign comment in the public JavaScript and the deliberate `Cache-Control: no-store` setting. No high-severity alert was found in the scanned surface. The [10 November follow-up](FOLLOWUP_20261110.md) covers selected authenticated API operations. This evidence covers the scanned routes in local Compose.

## Coverage limits

The **9 November** ZAP spider reached six URLs; the report records five distinct endpoints and only GET requests. That scan did not authenticate or exercise protected POST/PUT paths. The 10 November follow-up covers selected protected operations with synthetic identities, but neither scan inspected Kubernetes or cloud controls or tested browser workflows with real users. The five-minute maximum active-scan duration bounds the first test; it does not establish exhaustive coverage. The Semgrep result covers the selected community OWASP rule set and the `src`, `scripts`, and `public` directories. Dependency auditing and container-image scanning are separate checks in the repository's existing CI; they are not counted as SAST or DAST here.

## Original artifacts

Download [the evidence archive](ReleaseGuard_SAST_DAST_Evidence_20261109.zip). The paths below are inside that archive, alongside this report.

| File | Content |
| --- | --- |
| `evidence/sast-semgrep-owasp.json` | Initial SAST machine report. |
| `evidence/sast-semgrep-owasp-after.json` | Post-fix SAST machine report. |
| `evidence/dast-zap-baseline.json`, `.html`, `.md` | Initial passive DAST reports. |
| `evidence/dast-zap-active.json`, `.html`, `.md` | Initial full DAST reports with medium finding. |
| `evidence/dast-zap-active-after.json`, `.html`, `.md` | Full DAST rescan after fix. |
| `evidence/fixed-response-headers.txt` | Direct HTTP header capture from fixed local gateway. |
| `evidence/fix-test.log` | Node 24 dependency install, build, and test output. |
| `evidence/security-fix.patch` | Exact two-file source and regression-test diff. |
| `evidence/SHA256SUMS.txt` | Checksums of retained raw artifacts. |

Image identities retained for reproducibility: Semgrep `semgrep/semgrep:latest` digest `sha256:2e45517a85e13a9cca14a2a00df6bb48affd66b8ebfae1b0991cd57578362fb0`; ZAP `ghcr.io/zaproxy/zaproxy:stable` digest `sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af`; test runtime `node:24-alpine` digest `sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8`.

Reference methods: [Semgrep Community Edition](https://semgrep.dev/products/community-edition/), [ZAP baseline scan](https://www.zaproxy.org/docs/docker/baseline-scan/), [ZAP full scan](https://www.zaproxy.org/docs/docker/full-scan/).
