/**
 * CLI tool untuk reset password administrator.
 *
 * Cara pakai:
 *   node src/reset-password.js <password-baru>
 *   node src/reset-password.js          (akan generate password random)
 */

import { updateAdminPassword } from './db.js';
import { randomInt } from 'crypto';
import config from './config.js';

const newPassword = process.argv[2];

function generateRandomPassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomInt(chars.length)];
  }
  return result;
}

function main() {
  const pwd = newPassword || generateRandomPassword();

  if (pwd.length < 12) {
    console.error('Error: Password minimal 12 karakter');
    process.exit(1);
  }

  const success = updateAdminPassword(config.adminUsername, pwd);

  if (success) {
    console.log('========================================');
    console.log('  Password admin berhasil direset!');
    console.log('========================================');
    console.log(`  Username: ${config.adminUsername}`);
    console.log(`  Password: ${pwd}`);
    console.log('========================================');
    if (!newPassword) {
      console.log('  (Password di-generate secara random)');
    }
    console.log('  Simpan password ini di tempat aman!');
    console.log('========================================');
  } else {
    console.error(`Error: Gagal reset password. Pastikan user "${config.adminUsername}" ada di database.`);
    process.exit(1);
  }

  process.exit(0);
}

main();
