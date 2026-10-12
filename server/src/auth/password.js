import { hash, verify } from '@node-rs/argon2';

// argon2id with the library defaults (m=19456 KiB, t=2, p=1), the OWASP recommendation

/**
 * Hash a password with argon2id
 * @param {string} password
 * @returns {Promise<string>} Encoded hash including algorithm, parameters and salt
 */
export function hashPassword(password) {
  return hash(password);
}

/**
 * Check a password against a stored hash
 * @param {string} passwordHash - Encoded argon2 hash
 * @param {string} password
 * @returns {Promise<boolean>} false for wrong passwords and malformed hashes
 */
export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Computed once at module load, so even the first unknown-user login after a
// restart costs exactly one verification, like a wrong password for a real user
const dummyHash = hashPassword('dummy password for timing equalization');

/**
 * Spend the same time as a real verification when the user doesn't exist,
 * so response times don't reveal which usernames are registered
 * @param {string} password
 * @returns {Promise<false>}
 */
export async function verifyAgainstDummy(password) {
  await verifyPassword(await dummyHash, password);
  return false;
}
