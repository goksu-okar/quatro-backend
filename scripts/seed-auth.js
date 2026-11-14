// One-off setup script: writes the admin email + password hash into the
// AuthConfig collection. Run this once per database (local dev, then again
// against production when you're ready to go live).
//
// Usage: node scripts/seed-auth.js
// Prompts for email and password locally - nothing is sent anywhere else.
// Also the recommended way to change the password directly, bypassing the
// app's "current password" check (e.g. if the password is forgotten).

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline');
const db = require('../db');

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // not a real terminal (e.g. piped input) - fall back to plain prompt
    return prompt(question);
  }

  return new Promise((resolve) => {
    process.stdout.write(question);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '') {
        process.exit(1);
      } else if (char === '') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const dbName = process.env.MONGODB_NAME || 'quatro';
  console.log(`Connecting to database: ${dbName}`);
  const connectionString = `mongodb+srv://${process.env.MONGOUSER}:${process.env.MONGOPSSWD}@quatro.sgb5fdh.mongodb.net/${dbName}?retryWrites=true&w=majority`;
  await mongoose.connect(connectionString);

  const existing = await db.getAuthConfig();
  if (existing) {
    const overwrite = await prompt(`An admin credential already exists for ${existing.email}. Overwrite? (y/N): `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  const email = await prompt('Admin login email: ');
  const password = await promptHidden('Admin login password: ');

  if (!email || !password) {
    console.log('Email and password are both required.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.setAuthPassword(passwordHash);
  await mongoose.model('AuthConfig').findOneAndUpdate({}, { $set: { email } }, { upsert: true });

  console.log(`Done. Admin email set to ${email} in the "${dbName}" database.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
