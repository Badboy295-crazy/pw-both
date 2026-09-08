/**
 * auth.js — Helper script to generate GramJS MTProto SESSION_STRING
 * Run with: node auth.js
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const { TG_API_ID, TG_API_HASH } = require('./config');

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

(async () => {
  console.log('\n════════════════════════════════════════════════');
  console.log('   Study Hub — Telegram Session String Generator');
  console.log('════════════════════════════════════════════════\n');

  const apiId = TG_API_ID || 39381974;
  const apiHash = TG_API_HASH || '966567ba55e48502b1ed766404c12c64';
  console.log(`Using Telegram API ID: ${apiId}\n`);

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await question('Enter Phone Number (with country code, e.g. +919876543210): '),
    password: async () => await question('Enter 2FA Password (if enabled, or press enter): '),
    phoneCode: async () => await question('Enter OTP Code sent by Telegram: '),
    onError: (err) => console.error('Telegram Error:', err.message),
  });

  console.log('\n✅ Successfully Logged in to Telegram!');
  const sessionString = client.session.save();
  console.log('\n════════════════ YOUR SESSION STRING ════════════════');
  console.log(sessionString);
  console.log('═════════════════════════════════════════════════════\n');
  console.log('Copy the above SESSION_STRING and paste it in your Render Environment Variables or .env file.\n');

  await client.disconnect();
  rl.close();
  process.exit(0);
})();
