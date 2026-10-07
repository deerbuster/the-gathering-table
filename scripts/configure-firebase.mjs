import { access, writeFile } from 'node:fs/promises';
const input = process.env.FIREBASE_CONFIG;
if (!input) {
  try { await access('public/firebase-config.json'); }
  catch { await writeFile('public/firebase-config.json', '{ "mode": "demo" }\n'); }
  console.log('Using public/firebase-config.json (a missing file is initialized as an explicitly labeled sample preview).');
} else {
  const config = JSON.parse(input);
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (typeof config[key] !== 'string' || !config[key] || config[key].includes('YOUR_')) throw new Error(`Missing or invalid public Firebase option: ${key}`);
  }
  const allowed = ['apiKey', 'authDomain', 'projectId', 'appId', 'storageBucket', 'messagingSenderId', 'measurementId'];
  if (Object.keys(config).some(key => !allowed.includes(key))) throw new Error('Provide only Firebase web app options, never service-account credentials.');
  await writeFile('public/firebase-config.json', JSON.stringify(config, null, 2) + '\n');
  console.log('Public Firebase web configuration written. Deploy and test the Firestore rules separately before publishing live.');
}
