// Reset a user's password and sign them out everywhere.
//
//   node scripts/reset-password.js <username>                    # generates and prints a password
//   echo 'new password' | node scripts/reset-password.js <username> --password-stdin
//
// In Docker: docker compose exec app node scripts/reset-password.js <username>
import { text } from 'node:stream/consumers';
import { createPool } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { resetPassword, generatePassword } from '../src/auth/admin.js';

const args = process.argv.slice(2);
const fromStdin = args.includes('--password-stdin');
const [username] = args.filter((arg) => !arg.startsWith('--'));

if (!username) {
  console.error('Usage: node scripts/reset-password.js <username> [--password-stdin]');
  process.exit(1);
}

// Read from stdin instead of an argument so the password stays out of shell history and ps
const password = fromStdin ? (await text(process.stdin)).replace(/\r?\n$/, '') : generatePassword();

const pool = createPool(loadConfig(process.env));
try {
  const storedName = await resetPassword(pool, username, password);
  console.log(`Password for "${storedName}" was reset and all sessions were signed out.`);
  if (!fromStdin) console.log(`New password: ${password}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
