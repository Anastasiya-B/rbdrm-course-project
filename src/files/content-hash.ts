import { createHash } from 'node:crypto';

import path from 'node:path';

export function createContentHashedName(
  filename: string,
  content: Buffer,
): string {
  const parsed = path.parse(filename);

  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);

  return `${parsed.name}.${hash}${parsed.ext}`;
}
