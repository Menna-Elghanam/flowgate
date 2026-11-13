import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt is built into Node (no native dependency) and is memory-hard, which makes
// brute-forcing leaked hashes expensive. Parameters are stored with the hash so they can
// be raised later without breaking old passwords.
const PARAMS = { N: 16384, r: 8, p: 1, keyLength: 64 };

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keyLength } = PARAMS;
  const key = await scryptAsync(password, salt, keyLength, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, N, r, p, salt, expected] = stored.split('$');
  if (algorithm !== 'scrypt' || !N || !r || !p || !salt || !expected) return false;
  const expectedKey = Buffer.from(expected, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expectedKey.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expectedKey);
}

/** A random secret for cookies and invite links, plus the hash we store instead of it. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
