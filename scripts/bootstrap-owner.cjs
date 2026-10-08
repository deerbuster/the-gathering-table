const { getGlobalDefaultAccount, getAccessToken } = require('firebase-tools/lib/auth');
const project = 'the-gathering-table-afd96';
const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
async function main() {
  if (!ownerEmail) throw new Error('Set OWNER_EMAIL to the designated site owner email.');
  const account = getGlobalDefaultAccount();
  if (!account) throw new Error('Sign into Firebase CLI first.');
  const token = await getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/firebase']);
  const headers = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, { method:'POST', headers, body:JSON.stringify({ email:[ownerEmail] }) });
  if (!response.ok) throw new Error(`Account lookup failed (${response.status}).`);
  const data = await response.json(); const owner = data.users?.find(user => user.email?.toLowerCase() === ownerEmail);
  if (!owner) throw new Error('The designated owner must register with this email first.');
  console.log(JSON.stringify({ uid: owner.localId, emailVerified: owner.emailVerified === true, applyRequested: process.argv.includes('--apply') }));
  if (!process.argv.includes('--apply')) return;
  if (!owner.emailVerified) throw new Error('Verify the owner email before granting Admin access.');
  const base = `projects/${project}/databases/(default)/documents`;
  const accessURL = `https://firestore.googleapis.com/v1/${base}/accountAccess/${owner.localId}`;
  const current = await fetch(accessURL, { headers });
  if (current.ok) throw new Error('An owner access record already exists. Inspect it rather than overwriting history.');
  if (current.status !== 404) throw new Error(`Owner access lookup failed (${current.status}).`);
  const value = input => input === null ? { nullValue:null } : typeof input === 'string' ? { stringValue:input } : typeof input === 'number' ? { integerValue:String(input) } : { mapValue:{ fields:Object.fromEntries(Object.entries(input).map(([key,val])=>[key,value(val)])) } };
  const before = { role:'Member', timeout:null, mute:null, ban:null, revision:0, lastActionId:'', updatedAt:null };
  const after = { ...before, role:'Admin', revision:1, lastActionId:'owner-bootstrap' };
  const fields = data => Object.fromEntries(Object.entries(data).map(([key,val])=>[key,value(val)]));
  const writes = [
    { update:{ name:`${base}/siteSecurity/owner`, fields:fields({ uid:owner.localId }) }, currentDocument:{ exists:false } },
    { update:{ name:`${base}/accountAccess/${owner.localId}`, fields:fields(after) }, currentDocument:{ exists:false }, updateTransforms:[{ fieldPath:'updatedAt', setToServerValue:'REQUEST_TIME' }] },
    { update:{ name:`${base}/accountAccess/${owner.localId}/actions/owner-bootstrap`, fields:fields({ actorUid:owner.localId, actorName:'Site setup', kind:'Bootstrap', reason:'Initial owner designated by the site owner.', createdAt:null, before, after }) }, currentDocument:{ exists:false }, updateTransforms:[{ fieldPath:'createdAt', setToServerValue:'REQUEST_TIME' }, { fieldPath:'after.updatedAt', setToServerValue:'REQUEST_TIME' }] }
  ];
  const commit = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`, { method:'POST', headers, body:JSON.stringify({ writes }) });
  if (!commit.ok) throw new Error(`Owner bootstrap failed (${commit.status}). No credentials were logged.`);
  console.log('Verified owner initialized as protected Admin; bootstrap audit recorded.');
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
