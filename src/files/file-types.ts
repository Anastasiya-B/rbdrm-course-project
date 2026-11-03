export const FILE_TYPES = {
  'image/jpeg': {
    extension: 'jpg',
  },
  'image/png': {
    extension: 'png',
  },
  'image/webp': {
    extension: 'webp',
  },
  'application/pdf': {
    extension: 'pdf',
  },
  'application/json': {
    extension: 'json',
  },
  'application/octet-stream': {
    extension: 'bin',
  },
} as const;

export type AllowedContentType = keyof typeof FILE_TYPES;

export function isAllowedContentType(
  value: string,
): value is AllowedContentType {
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, value);
}

export function extensionForContentType(
  contentType: AllowedContentType,
): string {
  return FILE_TYPES[contentType].extension;
}
