/**
 * Compare Firebase Authentication users to Firestore /users.
 * Run from functions/: node scripts/compare-auth-firestore.cjs
 * Default: READ ONLY. Deletion requires reviewed UIDs and an explicit confirmation.
 *
 * Credentials: GOOGLE_APPLICATION_CREDENTIALS must point to a service-account JSON file.
 * Never commit that JSON file to Git.
 */
const admin = require('firebase-admin');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service-account JSON path first.');
  process.exit(1);
}
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const auth = admin.auth();
const outputDir = path.join(process.cwd(), 'auth-audit-output');
const normalize = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
function writeCsv(filename, headers, rows) {
  fs.writeFileSync(path.join(outputDir, filename), [headers.join(','), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(','))].join('\n') + '\n');
}
async function getAuthUsers() {
  const result = [];
  let nextPageToken;
  do {
    const page = await auth.listUsers(1000, nextPageToken);
    result.push(...page.users);
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return result;
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const [authUsers, usersSnapshot] = await Promise.all([getAuthUsers(), db.collection('users').get()]);
  const knownEmails = new Set();
  const knownUids = new Set();
  const emailFields = ['email', 'nisEmail', 'NIS Email', 'personalEmail', 'personal Email'];
  for (const doc of usersSnapshot.docs) {
    const data = doc.data();
    knownUids.add(doc.id);
    for (const field of ['authId', 'googleUid', 'uid', 'isLinkedTo']) {
      if (typeof data[field] === 'string' && data[field].trim()) knownUids.add(data[field].trim());
    }
    for (const field of emailFields) {
      const email = normalize(data[field]);
      if (email) knownEmails.add(email);
    }
  }

  const matched = [], unmatched = [];
  for (const user of authUsers) {
    const email = normalize(user.email);
    const linked = knownUids.has(user.uid) || (email && knownEmails.has(email));
    const row = {
      uid: user.uid,
      email: user.email || '',
      providers: user.providerData.map(p => p.providerId).join(';'),
      disabled: user.disabled,
      createdAt: user.metadata.creationTime || '',
      lastSignInAt: user.metadata.lastSignInTime || '',
      reason: linked ? 'Firestore employee match' : 'No Firestore users match by UID or known email fields - REVIEW BEFORE DELETE',
    };
    (linked ? matched : unmatched).push(row);
  }
  const headers = ['uid', 'email', 'providers', 'disabled', 'createdAt', 'lastSignInAt', 'reason'];
  writeCsv('matched-keep.csv', headers, matched);
  writeCsv('unmatched-review.csv', headers, unmatched);
  console.log(`Firestore users: ${usersSnapshot.size}; Auth users: ${authUsers.length}; Matched: ${matched.length}; Unmatched for review: ${unmatched.length}`);
  console.log('Reports saved in:', outputDir);

  const args = process.argv.slice(2);
  if (!args.includes('--delete')) {
    console.log('READ-ONLY mode: Nothing was deleted. Review unmatched-review.csv first.');
    console.log('To delete manually approved accounts, create approved-uids.txt with ONE UID per line and rerun with --delete.');
    return;
  }
  const approvedFile = path.join(outputDir, 'approved-uids.txt');
  if (!fs.existsSync(approvedFile)) throw new Error('Missing auth-audit-output/approved-uids.txt');
  const approved = [...new Set(fs.readFileSync(approvedFile, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
  const candidates = new Set(unmatched.map(x => x.uid));
  if (approved.length === 0) throw new Error('approved-uids.txt is empty; nothing to delete.');
  for (const uid of approved) {
    if (!candidates.has(uid)) throw new Error(`STOP: ${uid} is not an unmatched candidate in the FRESH audit. No accounts deleted.`);
  }
  console.log(`DANGER: ${approved.length} manually approved Authentication account(s) will be permanently deleted. Firestore is NOT modified.`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const response = await rl.question(`Type DELETE ${approved.length} to proceed: `);
  rl.close();
  if (response !== `DELETE ${approved.length}`) {
    console.log('Cancelled. No accounts deleted.');
    return;
  }
  const results = [];
  for (const uid of approved) {
    try {
      // Recheck immediately before deletion to reduce accidental removal.
      const doc = await db.collection('users').doc(uid).get();
      if (doc.exists) throw new Error('Matching Firestore UID appeared; skipped');
      const target = await auth.getUser(uid);
      const email = normalize(target.email);
      if (email) {
        const liveSnapshot = await db.collection('users').get();
        const nowExists = liveSnapshot.docs.some(d => emailFields.some(f => normalize(d.data()[f]) === email) || ['authId','googleUid','uid','isLinkedTo'].some(f => d.data()[f] === uid));
        if (nowExists) throw new Error('Firestore match appeared; skipped');
      }
      await auth.deleteUser(uid);
      results.push({ uid, result: 'DELETED' });
      console.log(`Deleted Auth UID ${uid}`);
    } catch (err) {
      results.push({ uid, result: `SKIPPED/ERROR: ${err.message}` });
      console.error(`Skipped ${uid}: ${err.message}`);
    }
  }
  writeCsv('deletion-results.csv', ['uid', 'result'], results);
  console.log('Done. See auth-audit-output/deletion-results.csv');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
