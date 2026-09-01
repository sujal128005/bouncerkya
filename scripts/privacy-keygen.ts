/**
 * Generates an encryption key for STEALTH_ENCRYPTION_KEY.
 *
 *   npm run privacy:keygen
 *
 * Prints the line to paste into .env and nothing else. It does not write to
 * .env itself: a script that edits the file holding your Razorpay credentials
 * is a script that can corrupt them, and this project has already had one
 * live-key incident.
 *
 * Rotating the key makes every existing encrypted row unreadable. There is no
 * re-encryption tool; for a seeded demo database the answer is
 * `npm run db:reset`, and for anything real it would be a migration.
 */

import { ENCRYPTION_KEY_ENV, generateEncryptionKey } from "../lib/privacy/crypto";

const key = generateEncryptionKey();

console.log("Add this line to your .env file:\n");
console.log(`${ENCRYPTION_KEY_ENV}="${key}"`);
console.log(
  "\n32 bytes from the system CSPRNG, base64 encoded, for AES-256-GCM.\n" +
    "Keep it out of git: .env is already ignored.\n" +
    "Changing it makes every row encrypted under the old key unreadable.",
);
