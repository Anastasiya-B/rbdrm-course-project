import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../src/config/env.schema.ts', import.meta.url);
const examplePath = new URL('../.env.example', import.meta.url);

const schemaContent = await readFile(schemaPath, 'utf8');
const exampleContent = await readFile(examplePath, 'utf8');

const schemaKeys = [
  ...schemaContent.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm),
].map(match => match[1]);

const exampleKeys = exampleContent
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(line => line.split('=')[0].trim());

const missing = schemaKeys.filter(key => !exampleKeys.includes(key));

const extra = exampleKeys.filter(key => !schemaKeys.includes(key));

if (missing.length > 0 || extra.length > 0) {
  console.error('.env.example is not synchronized with env schema.');

  if (missing.length > 0) {
    console.error(`Missing variables: ${missing.join(', ')}`);
  }

  if (extra.length > 0) {
    console.error(`Unknown variables: ${extra.join(', ')}`);
  }

  process.exit(1);
}

console.log('.env.example is synchronized with env schema.');
