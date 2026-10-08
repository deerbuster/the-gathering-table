import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, serverTimestamp, runTransaction, Timestamp } from 'firebase/firestore';

let env;
const profile = { username: 'Adventurer', biography: '', pastPlayerReviews: [], allowCampaignMessages: false };
const campaign = () => ({ tableType: 'Virtual', location: '', virtualPlatform: 'Fantasy Grounds', platformOther: '', voiceService: 'Discord', voiceOther: '', recorded: false, broadcast: false, paid: false, name: 'Test', systemType: 'RMU', gmUserId: 'gm', gmName: 'Adventurer', minPlayers: 2, maxPlayers: 3, currentPlayers: 2, playerIds: ['a','b'], retiredPlayerIds: [], pendingPlayerIds: [], startMode: 'Fixed', lifecycleStatus: 'New', scheduleRevision: 0, status: 'Open', scheduleState: 'Confirmed', description: 'Adventure', dayOfWeek: 'Friday', sessionLengthHours: 3, frequency: 'Weekly', startTime: Timestamp.fromMillis(Date.now() + 86400000), timeZone: 'America/Chicago', localStartTime: '19:00' });
const db = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const ref = uid => doc(db(uid), 'campaigns', 'table');
before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-the-gathering-table', firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } }); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for (const uid of ['gm','a','b','c','d']) await setDoc(doc(ctx.firestore(), 'users', uid), profile);
    await setDoc(doc(ctx.firestore(), 'campaigns', 'table'), campaign());
  });
});
after(async () => { await env?.cleanup(); });

test('public reads; unauthenticated writes denied', async () => {
  await assertSucceeds(getDoc(ref(null)));
  await assertFails(updateDoc(ref(null), { name: 'Forged' }));
});
test('atomic last-seat self join succeeds and extra seats fail', async () => {
  await assertSucceeds(updateDoc(ref('c'), { playerIds: ['a','b','c'], currentPlayers: 3, status: 'Full' }));
  await assertFails(updateDoc(ref('d'), { playerIds: ['a','b','c','d'], currentPlayers: 4 }));
});
test('simultaneous transactions reserve exactly one last seat', async () => {
  const join = uid => {
    const firestore = db(uid);
    const reference = doc(firestore, 'campaigns', 'table');
    return runTransaction(firestore, async tx => {
      const snapshot = await tx.get(reference); const c = snapshot.data();
      if (c.status !== 'Open') throw new Error('Full');
      tx.update(reference, { playerIds: [...c.playerIds, uid], currentPlayers: 3, status: 'Full' });
    });
  };
  const outcomes = await Promise.allSettled([join('c'), join('d')]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal((await getDoc(ref(null))).data().currentPlayers, 3);
});
test('cannot append another user, replace a member or join as GM', async () => {
  await assertFails(updateDoc(ref('c'), { playerIds: ['a','b','d'], currentPlayers: 3, status: 'Full' }));
  await assertFails(updateDoc(ref('c'), { playerIds: ['a','c'], currentPlayers: 2 }));
  await assertFails(updateDoc(ref('gm'), { playerIds: ['a','b','gm'], currentPlayers: 3, status: 'Full' }));
});
test('non-GM cannot change schedule or confirmation', async () => {
  await assertFails(updateDoc(ref('a'), { startTime: Timestamp.now() }));
  await assertFails(updateDoc(ref('a'), { scheduleState: 'Recruiting' }));
});
test('leaving below minimum must clear confirmation', async () => {
  await assertFails(updateDoc(ref('a'), { playerIds: ['b'], currentPlayers: 1 }));
  await assertSucceeds(updateDoc(ref('a'), { playerIds: ['b'], retiredPlayerIds: ['a'], currentPlayers: 1, status: 'Open', scheduleState: 'Recruiting' }));
  await assertFails(updateDoc(ref('gm'), { scheduleState: 'Confirmed' }));
});
test('GM can reschedule, confirm with minimum, and complete', async () => {
  await assertSucceeds(updateDoc(ref('gm'), { startTime: Timestamp.fromMillis(Date.now() + 172800000), scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertSucceeds(updateDoc(ref('gm'), { scheduleState: 'Confirmed' }));
  await assertSucceeds(updateDoc(ref('gm'), { status: 'Completed', lifecycleStatus: 'Completed' }));
  await assertFails(updateDoc(ref('a'), { playerIds: ['b'], currentPlayers: 1, status: 'Open', scheduleState: 'Recruiting' }));
  await assertFails(updateDoc(ref('gm'), { status: 'Open' }));
});
test('string timestamps, impossible min/max and invented fields denied', async () => {
  await assertFails(updateDoc(ref('gm'), { startTime: '2026-10-09', scheduleState: 'Recruiting' }));
  await assertFails(updateDoc(ref('gm'), { minPlayers: 5, scheduleState: 'Recruiting' }));
  await assertFails(updateDoc(ref('gm'), { billingToken: 'no-payments' }));
});
test('campaign creation requires own GM identity, empty seats and a profile', async () => {
  const create = { ...campaign(), playerIds: [], currentPlayers: 0, scheduleState: 'Recruiting' };
  await assertSucceeds(setDoc(doc(db('gm'), 'campaigns', 'new'), create));
  await assertFails(setDoc(doc(db('c'), 'campaigns', 'forged'), create));
  await assertFails(setDoc(doc(db('gm'), 'campaigns', 'seeded'), campaign()));
});
test('profiles cannot forge reviews or edit other users', async () => {
  await assertSucceeds(updateDoc(doc(db('a'), 'users', 'a'), { biography: 'My story' }));
  await assertFails(updateDoc(doc(db('a'), 'users', 'b'), { biography: 'Forged' }));
  await assertFails(updateDoc(doc(db('a'), 'users', 'a'), { pastPlayerReviews: [{ rating: 5 }] }));
});
async function writeReview(reviewer, target, atomic = true) {
  const firestore = db(reviewer); const id = `table_${reviewer}`;
  const review = { id, rating: 5, text: 'Thoughtful player.', reviewerId: reviewer, reviewerName: 'Adventurer', campaignId: 'table', createdAt: Timestamp.now() };
  if (!atomic) return setDoc(doc(firestore, 'users', target, 'reviews', id), review);
  return runTransaction(firestore, async tx => {
    const targetRef = doc(firestore, 'users', target); const snapshot = await tx.get(targetRef);
    tx.set(doc(firestore, 'users', target, 'reviews', id), review);
    const cache = snapshot.data().pastPlayerReviews;
    if (cache.length < 20) tx.update(targetRef, { pastPlayerReviews: [...cache, review] });
  });
}
test('review requires completed campaign, shared participation, and synchronized cache', async () => {
  await assertFails(writeReview('a','b'));
  await updateDoc(ref('gm'), { status: 'Completed', lifecycleStatus: 'Completed' });
  await assertFails(writeReview('c','b'));
  await assertFails(writeReview('a','a'));
  await assertFails(writeReview('a','b', false));
  await assertSucceeds(writeReview('a','b'));
  await assertFails(writeReview('a','b'));
  assert.equal((await getDoc(doc(db(null),'users','b'))).data().pastPlayerReviews.length, 1);
});
test('review cache stays bounded while canonical reviews continue', async () => {
  await updateDoc(ref('gm'), { status: 'Completed', lifecycleStatus: 'Completed' });
  await env.withSecurityRulesDisabled(async ctx => updateDoc(doc(ctx.firestore(),'users','b'), { pastPlayerReviews: Array.from({ length: 20 }, () => ({ rating: 5 })) }));
  await assertSucceeds(writeReview('a','b'));
  assert.equal((await getDoc(doc(db(null),'users','b'))).data().pastPlayerReviews.length, 20);
});

async function rolling(patch = {}) {
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(),'campaigns','table'), { ...campaign(), startMode: 'Rolling', startTime: null, localStartTime: null, dayOfWeek: null, scheduleState: 'Recruiting', ...patch }));
}
test('rolling campaigns can be created without a placeholder date', async () => {
  const data = { ...campaign(), playerIds: [], currentPlayers: 0, startMode: 'Rolling', startTime: null, localStartTime: null, dayOfWeek: null, scheduleState: 'Recruiting' };
  await assertSucceeds(setDoc(doc(db('gm'),'campaigns','rolling'), data));
  await assertFails(setDoc(doc(db('gm'),'campaigns','fixed-null'), { ...data, startMode: 'Fixed' }));
  await assertFails(setDoc(doc(db('gm'),'campaigns','rolling-dated'), { ...data, startTime: Timestamp.fromMillis(Date.now() + 86400000), localStartTime: '19:00', dayOfWeek: 'Friday' }));
});
test('only self-applications and GM acceptance affect a rolling roster', async () => {
  await rolling();
  await assertSucceeds(updateDoc(ref('c'), { pendingPlayerIds: ['c'] }));
  await assertFails(updateDoc(ref('d'), { pendingPlayerIds: ['c','a'] }));
  await assertFails(updateDoc(ref('c'), { playerIds: ['a','b','c'], pendingPlayerIds: [], currentPlayers: 3, status: 'Full' }));
  await assertFails(updateDoc(ref('gm'), { playerIds: ['a','b','d'], pendingPlayerIds: [], currentPlayers: 3, status: 'Full' }));
  await assertSucceeds(updateDoc(ref('gm'), { playerIds: ['a','b','c'], pendingPlayerIds: [], currentPlayers: 3, status: 'Full' }));
});
test('pending applications cannot unlock first-session scheduling', async () => {
  await rolling({ playerIds: ['a'], currentPlayers: 1, pendingPlayerIds: ['b','c'] });
  const schedule = { startTime: Timestamp.fromMillis(Date.now() + 86400000), localStartTime: '19:00', dayOfWeek: 'Friday', scheduleRevision: 1 };
  await assertFails(updateDoc(ref('gm'), schedule));
  await assertSucceeds(updateDoc(ref('gm'), { playerIds: ['a','b'], currentPlayers: 2, pendingPlayerIds: ['c'] }));
  await assertSucceeds(updateDoc(ref('gm'), schedule));
  await assertFails(updateDoc(ref('a'), { startTime: Timestamp.fromMillis(Date.now() + 172800000), scheduleRevision: 2 }));
});
test('simultaneous GM acceptances cannot overfill the final seat', async () => {
  await rolling({ pendingPlayerIds: ['c','d'] });
  const firestore = db('gm'); const reference = doc(firestore,'campaigns','table');
  const accept = uid => runTransaction(firestore, async tx => {
    const c = (await tx.get(reference)).data();
    if (c.status !== 'Open' || !c.pendingPlayerIds.includes(uid)) throw new Error('Full or no longer pending');
    tx.update(reference, { playerIds: [...c.playerIds, uid], currentPlayers: c.currentPlayers + 1, status: 'Full', pendingPlayerIds: c.pendingPlayerIds.filter(id => id !== uid) });
  });
  const outcomes = await Promise.allSettled([accept('c'), accept('d')]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const c = (await getDoc(reference)).data();
  assert.equal(c.currentPlayers, 3); assert.equal(c.pendingPlayerIds.length, 1);
});
test('a running rolling campaign can change day and time below its original minimum', async () => {
  await rolling({ playerIds: ['a'], currentPlayers: 1, startTime: Timestamp.fromMillis(Date.now() - 86400000), localStartTime: '19:00', dayOfWeek: 'Tuesday', lifecycleStatus: 'Established' });
  await assertSucceeds(updateDoc(ref('gm'), { startTime: Timestamp.fromMillis(Date.now() + 172800000), localStartTime: '21:00', dayOfWeek: 'Friday', timeZone: 'Europe/London', frequency: 'Biweekly', scheduleRevision: 1 }));
  await assertFails(updateDoc(ref('gm'), { scheduleState: 'Confirmed' }));
});
test('closed recruitment preserves membership and permits rescheduling but prevents joining', async () => {
  await assertSucceeds(updateDoc(ref('gm'), { status: 'Closed', lifecycleStatus: 'Closed' }));
  await assertFails(updateDoc(ref('c'), { playerIds: ['a','b','c'], currentPlayers: 3, status: 'Full' }));
  await assertSucceeds(updateDoc(ref('gm'), { startTime: Timestamp.fromMillis(Date.now() + 172800000), scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertSucceeds(updateDoc(ref('a'), { playerIds: ['b'], retiredPlayerIds: ['a'], currentPlayers: 1, scheduleState: 'Recruiting' }));
  await assertSucceeds(updateDoc(ref('gm'), { status: 'Open', lifecycleStatus: 'Established' }));
});
test('retired participants stay eligible for completed-campaign reviews', async () => {
  await assertSucceeds(updateDoc(ref('a'), { playerIds: ['b'], retiredPlayerIds: ['a'], currentPlayers: 1, scheduleState: 'Recruiting' }));
  await updateDoc(ref('gm'), { status: 'Completed', lifecycleStatus: 'Completed' });
  await assertSucceeds(writeReview('a','b'));
});

async function thread(creator, target, id = 'conversation') {
  return setDoc(doc(db(creator),'conversations',id), { campaignId: 'table', campaignName: 'Test', participantIds: [creator,target], createdBy: creator, createdAt: serverTimestamp() });
}
function message(uid, id = 'conversation', body = 'A question about the campaign.') {
  return setDoc(doc(db(uid),'conversations',id,'messages',crypto.randomUUID()), { senderId: uid, text: body, createdAt: serverTimestamp() });
}
test('prospects can message GMs, and GMs can reply to a prospective initiator', async () => {
  await assertSucceeds(thread('c','gm'));
  await assertSucceeds(message('c'));
  await assertSucceeds(message('gm'));
  await assertSucceeds(getDoc(doc(db('gm'),'conversations','conversation')));
  await assertFails(getDoc(doc(db('d'),'conversations','conversation')));
  await assertFails(getDocs(collection(db('d'),'conversations','conversation','messages')));
  await assertFails(message('d'));
  await assertFails(getDoc(doc(db(null),'conversations','conversation')));
});
test('member inbox queries succeed; unfiltered conversation queries fail', async () => {
  await thread('c','gm');
  await assertSucceeds(getDocs(query(collection(db('c'),'conversations'), where('participantIds','array-contains','c'))));
  await assertFails(getDocs(collection(db('c'),'conversations')));
});
test('current and retired players require explicit opt-in; later opt-out blocks unsolicited messages', async () => {
  await assertFails(thread('c','a'));
  await updateDoc(doc(db('a'),'users','a'), { allowCampaignMessages: true });
  await assertSucceeds(thread('c','a'));
  await assertSucceeds(message('c'));
  await updateDoc(doc(db('a'),'users','a'), { allowCampaignMessages: false });
  await assertFails(message('c'));
  await assertSucceeds(getDoc(doc(db('a'),'conversations','conversation')));
  await assertSucceeds(message('a')); // A reply to the user who explicitly initiated.
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(),'campaigns','table'), { retiredPlayerIds: ['d'] }));
  await assertFails(thread('c','d','retired'));
  await updateDoc(doc(db('d'),'users','d'), { allowCampaignMessages: true });
  await assertSucceeds(thread('c','d','retired'));
});
test('cannot forge senders, add a conversation participant, or edit messages', async () => {
  await thread('c','gm');
  await assertFails(updateDoc(doc(db('c'),'conversations','conversation'), { participantIds: ['c','gm','d'] }));
  const reference = doc(db('c'),'conversations','conversation','messages','forged');
  await assertFails(setDoc(reference, { senderId: 'gm', text: 'Forged', createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(reference, { senderId: 'c', text: 'Original', createdAt: serverTimestamp() }));
  await assertFails(updateDoc(reference, { text: 'Changed' }));
});

test('read receipts are private, self-only and cannot move backwards or into the future', async () => {
  await thread('c', 'gm');
  const receipt = uid => doc(db(uid), 'conversations', 'conversation', 'reads', 'c');
  const readThrough = Timestamp.fromMillis(Date.now() - 1000);
  await assertSucceeds(setDoc(receipt('c'), { readThrough }));
  await assertSucceeds(getDoc(receipt('c')));
  await assertFails(getDoc(receipt('gm')));
  await assertFails(getDoc(receipt('d')));
  await assertFails(setDoc(receipt('gm'), { readThrough }));
  await assertFails(setDoc(receipt('c'), { readThrough: Timestamp.fromMillis(Date.now() + 86400000) }));
  await assertFails(setDoc(receipt('c'), { readThrough: Timestamp.fromMillis(readThrough.toMillis() - 1000) }));
  await assertFails(setDoc(receipt('c'), { readThrough, extra: true }));
  await assertFails(getDocs(collection(db('c'), 'conversations', 'conversation', 'reads')));
  await assertSucceeds(setDoc(doc(db('gm'), 'conversations', 'conversation', 'reads', 'gm'), { readThrough }));
});

async function decideAndNotify(accepted, feedback = '', sender = 'gm', updateCampaign = true) {
  const firestore = db(sender);
  const campaignRef = doc(firestore, 'campaigns', 'table');
  const conversationRef = doc(firestore, 'conversations', 'decision-thread');
  return runTransaction(firestore, async tx => {
    const c = (await tx.get(campaignRef)).data();
    const existing = await tx.get(conversationRef);
    if (updateCampaign) tx.update(campaignRef, accepted ? { pendingPlayerIds: [], playerIds: [...c.playerIds, 'c'], currentPlayers: c.currentPlayers + 1, status: 'Full' } : { pendingPlayerIds: [] });
    if (!existing.exists()) tx.set(conversationRef, { campaignId: 'table', campaignName: 'Test', participantIds: [sender, 'c'], createdBy: sender, createdAt: serverTimestamp() });
    tx.set(doc(firestore, 'conversations', 'decision-thread', 'messages', 'result'), { senderId: sender, text: feedback || 'Application decision', decision: accepted ? 'Accepted' : 'Declined', createdAt: serverTimestamp() });
  });
}
test('GM accepts and atomically notifies an opted-out applicant with feedback', async () => {
  await rolling({ playerIds: ['a', 'b'], currentPlayers: 2, pendingPlayerIds: ['c'] });
  await assertSucceeds(decideAndNotify(true, 'Welcome! We will build characters together.'));
  const result = await assertSucceeds(getDoc(doc(db('c'), 'conversations', 'decision-thread', 'messages', 'result')));
  assert.equal(result.data().decision, 'Accepted');
  assert.match(result.data().text, /Welcome/);
  assert.equal((await getDoc(ref(null))).data().currentPlayers, 3);
  await assertSucceeds(message('c', 'decision-thread', 'Thank you!'));
});
test('GM decline delivers an inbox status without optional feedback', async () => {
  await rolling({ pendingPlayerIds: ['c'] });
  await assertSucceeds(decideAndNotify(false));
  const result = await getDoc(doc(db('c'), 'conversations', 'decision-thread', 'messages', 'result'));
  assert.equal(result.data().decision, 'Declined');
  assert.equal((await getDoc(ref(null))).data().currentPlayers, 2);
});
test('decision messages require an actual GM decision and cannot be replayed', async () => {
  await rolling({ pendingPlayerIds: ['c'] });
  await assertFails(decideAndNotify(false, 'Forged', 'a'));
  await assertFails(decideAndNotify(false, 'No decision', 'gm', false));
  await assertSucceeds(decideAndNotify(false));
  await assertFails(setDoc(doc(db('gm'), 'conversations', 'decision-thread', 'messages', 'repeat'), { senderId: 'gm', text: 'Repeated decision', decision: 'Declined', createdAt: serverTimestamp() }));
});


test('GM edits meeting details; physical locations and custom services are required', async () => {
  const edit = fields => updateDoc(ref('gm'), { ...fields, scheduleState: 'Recruiting', scheduleRevision: 1 });
  await assertFails(edit({ tableType: 'Physical', location: '', virtualPlatform: null, voiceService: null }));
  await assertFails(edit({ virtualPlatform: 'Other', platformOther: '' }));
  await assertFails(edit({ voiceService: 'Other', voiceOther: '' }));
  await assertFails(updateDoc(ref('a'), { recorded: true }));
  await assertSucceeds(edit({ tableType: 'Physical', location: 'Central Games, Chicago', virtualPlatform: null, voiceService: null, recorded: true, broadcast: false }));
});
test('voice-only tables require voice and clear virtual platform; recording flags are boolean', async () => {
  await assertFails(updateDoc(ref('gm'), { tableType: 'Theater of the Mind', scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertFails(updateDoc(ref('gm'), { recorded: 'yes', scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertSucceeds(updateDoc(ref('gm'), { tableType: 'Theater of the Mind', virtualPlatform: null, voiceService: 'Other', voiceOther: 'Mumble', recorded: false, broadcast: true, scheduleState: 'Recruiting', scheduleRevision: 1 }));
});

test('owners can add/remove bounded profile pictures without changing message preferences', async () => {
  const own = doc(db('a'), 'users', 'a');
  await assertSucceeds(updateDoc(own, { photoURL: 'data:image/jpeg;base64,/9j/2Q==' }));
  assert.equal((await getDoc(own)).data().allowCampaignMessages, false);
  await assertFails(updateDoc(doc(db('b'), 'users', 'a'), { photoURL: '' }));
  await assertFails(updateDoc(own, { photoURL: 'https://example.com/photo.jpg' }));
  await assertFails(updateDoc(own, { photoURL: 'data:image/svg+xml;base64,AAAA' }));
  await assertFails(updateDoc(own, { photoURL: 'data:image/jpeg;base64,' + 'A'.repeat(90000) }));
  await assertSucceeds(updateDoc(own, { photoURL: '' }));
  await assertSucceeds(setDoc(doc(db('new-player'), 'users', 'new-player'), { ...profile, allowCampaignMessages: true, photoURL: '' }));
});


test('paid is a boolean flag controlled by the GM; legacy campaigns remain readable and editable', async () => {
  await assertFails(updateDoc(ref('a'), { paid: true }));
  await assertFails(updateDoc(ref('gm'), { paid: 'yes', scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertSucceeds(updateDoc(ref('gm'), { paid: true, scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertSucceeds(updateDoc(ref('gm'), { paid: false, scheduleRevision: 2 }));
  await env.withSecurityRulesDisabled(async ctx => { const c = campaign(); delete c.paid; await setDoc(doc(ctx.firestore(), 'campaigns', 'table'), c); });
  await assertSucceeds(getDoc(ref(null)));
  await assertSucceeds(updateDoc(ref('c'), { playerIds: ['a','b','c'], currentPlayers: 3, status: 'Full' }));
});
test('Preparing campaign blocks applications until GM opens recruitment', async () => {
  const preparing = { ...campaign(), startMode: 'Rolling', startTime: null, localStartTime: null, dayOfWeek: null, currentPlayers: 0, playerIds: [], status: 'Preparing', lifecycleStatus: 'Preparing', scheduleState: 'Recruiting', backgroundImageURL: 'data:image/jpeg;base64,YQ==' };
  const reference = doc(db('gm'), 'campaigns', 'preparing');
  await assertSucceeds(setDoc(reference, preparing));
  await assertFails(updateDoc(doc(db('c'), 'campaigns', 'preparing'), { pendingPlayerIds: ['c'] }));
  await assertSucceeds(updateDoc(reference, { backgroundImageURL: '', scheduleRevision: 1 }));
  await assertSucceeds(updateDoc(reference, { status: 'Open', lifecycleStatus: 'New' }));
  await assertSucceeds(updateDoc(doc(db('c'), 'campaigns', 'preparing'), { pendingPlayerIds: ['c'] }));
});
test('campaign background changes are GM-only and bounded', async () => {
  await assertFails(updateDoc(ref('a'), { backgroundImageURL: 'data:image/jpeg;base64,YQ==', scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertFails(updateDoc(ref('gm'), { backgroundImageURL: 'https://example.com/banner.jpg', scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertFails(updateDoc(ref('gm'), { backgroundImageURL: 'data:image/jpeg;base64,' + 'A'.repeat(300000), scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertSucceeds(updateDoc(ref('gm'), { backgroundImageURL: 'data:image/jpeg;base64,YQ==', scheduleState: 'Recruiting', scheduleRevision: 1 }));
  await assertFails(updateDoc(ref('gm'), { status: 'Preparing', lifecycleStatus: 'Preparing' }));
});
test('GM can save campaign tags and content guidance; members cannot edit them', async () => {
  const preferences = { tags: ['Newbie friendly','Horror','Session zero'], playerAge: '18+', contentRating: 'M', contentNotes: 'Frightening scenes; discuss boundaries with the GM.', scheduleState: 'Recruiting', scheduleRevision: 1 };
  await assertFails(updateDoc(ref('a'), preferences));
  await assertSucceeds(updateDoc(ref('gm'), preferences));
  await assertSucceeds(updateDoc(ref('c'), { playerIds: ['a','b','c'], currentPlayers: 3, status: 'Full' }));
  const c = (await getDoc(ref(null))).data();
  assert.equal(c.contentRating, 'M'); assert.deepEqual(c.tags, preferences.tags);
});
test('invalid or duplicate campaign tags and invalid content guidance are denied', async () => {
  for (const invalid of [{ tags: ['Unknown'] }, { tags: ['Casual','Casual'] }, { tags: 'Casual' }, { contentRating: 'X' }, { playerAge: '12+' }, { contentNotes: 'A'.repeat(2001) }]) {
    await assertFails(updateDoc(ref('gm'), { ...invalid, scheduleState: 'Recruiting', scheduleRevision: 1 }));
  }
  await assertSucceeds(updateDoc(ref('gm'), { tags: [], contentRating: '', playerAge: '', contentNotes: '', scheduleState: 'Recruiting', scheduleRevision: 1 }));
});
test('full editor saves and GM decisions stay within the rules expression budget', async () => {
  const image = 'data:image/jpeg;base64,' + 'A'.repeat(220000);
  const existing = { ...campaign(), startMode: 'Rolling', startTime: null, dayOfWeek: null, localStartTime: null, scheduleState: 'Recruiting', pendingPlayerIds: ['c'], backgroundImageURL: image };
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'campaigns', 'table'), existing); });
  const fullSave = { ...existing, tags: ['Newbie friendly','Roleplay focused','Session zero','Graphic violence'], playerAge: '18+', contentRating: 'T', contentNotes: 'Discuss boundaries.', scheduleRevision: 1 };
  for (const key of ['gmUserId','gmName','playerIds','pendingPlayerIds','retiredPlayerIds','currentPlayers','lifecycleStatus']) delete fullSave[key];
  await assertSucceeds(updateDoc(ref('gm'), fullSave));
  await assertSucceeds(updateDoc(ref('gm'), { pendingPlayerIds: [], playerIds: ['a','b','c'], currentPlayers: 3, status: 'Full' }));
  await assertSucceeds(updateDoc(ref('gm'), { startTime: Timestamp.fromMillis(Date.now() + 86400000), dayOfWeek: 'Friday', localStartTime: '19:00', scheduleRevision: 2 }));
  await assertSucceeds(updateDoc(ref('gm'), { scheduleState: 'Confirmed' }));
  await assertSucceeds(updateDoc(ref('gm'), { lifecycleStatus: 'Established' }));
  await assertSucceeds(updateDoc(ref('gm'), { lifecycleStatus: 'Closed', status: 'Closed' }));
  await assertSucceeds(updateDoc(ref('a'), { playerIds: ['b','c'], retiredPlayerIds: ['a'], currentPlayers: 2, status: 'Closed' }));
  const saved = (await getDoc(ref(null))).data();
  assert.equal(saved.contentRating, 'T'); assert.equal(saved.backgroundImageURL, image);
});
