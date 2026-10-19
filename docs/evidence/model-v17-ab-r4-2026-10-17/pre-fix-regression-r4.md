# Pre-fix regression evidence

Checked before changing `src/generation-view-v17.ts`.

- Command scope: the two new generation-view regressions only.
- Result: build failed as expected because `GenerationViewV17R3` exposed only `permittedClarifications`; the new test expected `requiredClarifications`.
- Diagnostic: TypeScript reported `Property 'requiredClarifications' does not exist on type 'GenerationViewV17R3'`.
- This is synthetic program verification evidence. It is not a provider result and does not count toward either A/B arm.

After the initial implementation, the interval-origin test passed. The clarification test first used an incorrect fixture assumption that a damaged question necessarily asks unused and receipt status; that assertion was corrected to compare the generated list with the unchanged `contract.mustAsk` list. No new clarification duty was added.
