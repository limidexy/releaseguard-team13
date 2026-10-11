import { readFileSync } from 'node:fs';
const fixtures = JSON.parse(readFileSync(new URL('../public/demo-fixtures.json', import.meta.url), 'utf8'));
export const { cases, suite, application } = fixtures;
