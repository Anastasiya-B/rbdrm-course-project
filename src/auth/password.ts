import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');

  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;

  return ['scrypt', salt, derivedKey.toString('hex')].join('$');
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, salt, expectedHex] = storedHash.split('$');

  if (algorithm !== 'scrypt' || !salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, 'hex');

  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
