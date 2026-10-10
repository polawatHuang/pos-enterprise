'use strict';

/**
 * Print a bcrypt hash to paste into phpMyAdmin (e.g. to reset the owner password):
 *   node scripts/hash-password.js 'NewPassw0rd!'
 *   UPDATE users SET password_hash = '<hash>', failed_login_count = 0, locked_until = NULL WHERE email = '...';
 */
const bcrypt = require('bcryptjs');

const pw = process.argv[2];
if (!pw) {
  // eslint-disable-next-line no-console
  console.error('usage: node scripts/hash-password.js <password>');
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log(bcrypt.hashSync(pw, 12));
