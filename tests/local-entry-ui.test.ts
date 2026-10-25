// Explicit discovery bridge for both npm test and the unchanged Docker build.
// This imports synthetic tests, never an application server or credential helper.
await import(new URL('../../tests/local-entry-ui/entry-controller.test.mjs', import.meta.url).href);
export {};
