# UI refinement, 8 October 2026

## Scope and design choices

This revision changes only `public/index.html`, `public/style.css`, and `public/app.js`. It retains the existing light surfaces, teal identity, native form controls, API contracts, test rules and evidence provenance. It is not a new backend, cloud release, or model experiment.

The console is an **Operate** surface: users inspect evidence and make a release decision. Existing functions now have hash-linked navigation (evidence, history, comparison, review). Connection and submission are progressive disclosures. The selected job retains a case table, rule metrics, original JSON and a distinct release-gate panel. Narrow screens put the gate before detailed evidence. Semantic green, amber and red communicate outcomes, not decorative branding.

Type uses the existing platform sans approach with Avenir Next / Segoe UI / PingFang SC fallbacks. Functional text has an 11px minimum. Primary action height is 40px; navigation is 44px. Panels use a 12px radius, inputs/buttons 6px, state tags 5px. Focus is visible; reduced-motion preferences are respected. Full table content remains reachable in labeled horizontal scroll regions rather than being clipped or deleted.

## Skill usage

- Taste-Skill: https://github.com/Leonxlnx/taste-skill. Its current general skill explicitly excludes dashboards, data tables and multi-step product UI. Its read-the-brief and audit-first principles informed this review; its landing-page image and animation prescriptions were **not** applied to the console.
- Impeccable 4.5.0: https://github.com/pbakaus/impeccable. Used the context loader, polish playbook, Operate guidance and craft floor. No automatic hook was installed. A single mechanical detector pass identified undersized functional text and a pulsing loading dot; the refinement increased the small text and removed the pulse. Verification is bounded to the actual checked viewports and interactions, not a certification of universal accessibility.
- Vercel Web Interface Guidelines: semantic controls, labels, keyboard focus, reduced motion and internationalized data formatting.

## Evidence and limitations

The 7 October acceptance bundle remains historical and refers to its own source hashes. This UI update does not relabel that evidence as a new full acceptance run. See the separate UI update delivery for current screenshots, source hashes and targeted checks.

All preview answers are static replay fixtures. The local UI smoke-test review explicitly states it is not student UAT or a real deployment decision. No real model calls, cloud resources or hosted CI runs were made in this UI task. No claim of a guaranteed course score is made.

## Tabler icon attribution

Four navigation glyphs are adapted from `layout-dashboard`, `history`, `columns-2`, and `shield-check` in https://github.com/tabler/tabler-icons. Stroke width is harmonized to 1.7. The SVG geometry is vendored, so the application makes no external icon or font requests.

MIT License

Copyright (c) 2020-2026 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
