const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.error('Usage: node server/hashPassword.js <password>');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64);
const encoded = `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
console.log(encoded);
