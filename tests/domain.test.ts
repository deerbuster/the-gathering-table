import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase/firestore';
import { Campaign, CampaignInput, joinPatch, leavePatch, validateInput, applyPatch, acceptPatch } from '../src/app/core/models';
import { localToDate, dateInZone, scheduleDay } from '../src/app/core/time';

const base: Campaign = {
  tableType: 'Virtual', location: '', virtualPlatform: 'Fantasy Grounds', platformOther: '', voiceService: 'Discord', voiceOther: '', recorded: false, broadcast: false, paid: false,
  id: 'table', name: 'Test table', gmUserId: 'gm', gmName: 'GM', systemType: 'RMU',
  minPlayers: 2, maxPlayers: 3, playerIds: ['a','b'], currentPlayers: 2,
  status: 'Open', scheduleState: 'Confirmed', description: 'Adventure',
  startMode: 'Fixed', lifecycleStatus: 'New', pendingPlayerIds: [], retiredPlayerIds: [], scheduleRevision: 0,
  startTime: Timestamp.fromMillis(Date.now() + 86400000),
  timeZone: 'America/Chicago', localStartTime: '19:00', dayOfWeek: 'Friday', sessionLengthHours: 3, frequency: 'Weekly',
};
test('last seat becomes Full; a fresh read blocks the next join', () => {
  const full = { ...base, ...joinPatch(base, 'c') };
  assert.equal(full.status, 'Full'); assert.equal(full.currentPlayers, 3);
  assert.throws(() => joinPatch(full, 'd'));
});
test('GM, duplicate and past-session joins are rejected', () => {
  assert.throws(() => joinPatch(base, 'gm'));
  assert.throws(() => joinPatch(base, 'a'));
  assert.throws(() => joinPatch(base, 'c', base.startTime!.toMillis() + 1));
});
test('leaving below minimum clears GM confirmation', () => {
  const patch = leavePatch(base, 'a');
  assert.equal(patch.currentPlayers, 1); assert.equal(patch.scheduleState, 'Recruiting');
  assert.deepEqual(patch.playerIds, ['b']);
  assert.deepEqual(patch.retiredPlayerIds, ['a']);
});
test('unscheduled rolling applications do not occupy seats', () => {
  const rolling: Campaign = { ...base, startMode: 'Rolling', startTime: null, dayOfWeek: null, localStartTime: null, scheduleState: 'Recruiting' };
  const applied = { ...rolling, ...applyPatch(rolling, 'c') };
  assert.equal(applied.currentPlayers, 2); assert.deepEqual(applied.pendingPlayerIds, ['c']);
  assert.throws(() => joinPatch(rolling, 'c'));
  assert.throws(() => applyPatch(applied, 'c'));
  const accepted = { ...applied, ...acceptPatch(applied, 'gm', 'c') };
  assert.equal(accepted.currentPlayers, 3); assert.equal(accepted.status, 'Full'); assert.deepEqual(accepted.pendingPlayerIds, []);
  assert.throws(() => acceptPatch(applied, 'c', 'c'));
});
test('retiring preserves campaign history without consuming a seat or reopening a closed campaign', () => {
  const retired = leavePatch({ ...base, status: 'Closed', lifecycleStatus: 'Closed' }, 'a');
  assert.equal(retired.status, 'Closed'); assert.equal(retired.currentPlayers, 1); assert.deepEqual(retired.retiredPlayerIds, ['a']);
  const again = leavePatch({ ...base, retiredPlayerIds: ['a'] }, 'a');
  assert.deepEqual(again.retiredPlayerIds, ['a']);
});
test('leaving a full table above minimum keeps confirmation', () => {
  const full = { ...base, ...joinPatch(base, 'c') };
  assert.equal(leavePatch(full, 'c').scheduleState, 'Confirmed');
  assert.equal(leavePatch(full, 'c').status, 'Open');
});
test('completed campaigns preserve player history', () => assert.throws(() => leavePatch({ ...base, status: 'Completed' }, 'a')));
test('native Date instant round-trips through a Firestore Timestamp', () => {
  const date = localToDate('2026-10-09T19:00', 'America/Chicago');
  assert.equal(date.toISOString(), '2026-10-10T00:00:00.000Z');
  assert.equal(Timestamp.fromDate(date).toDate().getTime(), date.getTime());
  assert.equal(dateInZone(date, 'America/Chicago'), '2026-10-09T19:00');
  assert.equal(scheduleDay('2026-10-09T19:00'), 'Friday');
});
test('spring DST gaps cannot silently normalize', () => {
  for (const choice of ['reject','earlier','later'] as const) assert.throws(() => localToDate('2026-03-08T02:30', 'America/Chicago', choice));
});
test('fall DST overlaps require explicit occurrence choice', () => {
  assert.throws(() => localToDate('2026-11-01T01:30', 'America/Chicago'));
  const early = localToDate('2026-11-01T01:30', 'America/Chicago', 'earlier');
  const late = localToDate('2026-11-01T01:30', 'America/Chicago', 'later');
  assert.equal(late.getTime() - early.getTime(), 3600000);
});
test('invalid timezone, invalid calendar date and missing time fail', () => {
  assert.throws(() => localToDate('2026-10-09T19:00', 'Fake/Zone'));
  assert.throws(() => localToDate('2026-02-30T19:00', 'UTC'));
  assert.throws(() => localToDate('2026-10-09', 'UTC'));
});
test('minimum, seat count and session length are validated', () => {
  const input: CampaignInput = { ...base, localDateTime: '2026-10-09T19:00', occurrence: 'reject' };
  assert.doesNotThrow(() => validateInput(input));
  assert.throws(() => validateInput({ ...input, minPlayers: 4 }));
  assert.throws(() => validateInput({ ...input, maxPlayers: 2.5 }));
  assert.throws(() => validateInput({ ...input, sessionLengthHours: NaN }));
});


test('table requirements validate physical locations, virtual platforms and voice services', () => {
  const input: CampaignInput = { ...base, localDateTime: '2026-10-09T19:00', occurrence: 'reject' };
  assert.throws(() => validateInput({ ...input, tableType: 'Physical', location: '' }));
  assert.doesNotThrow(() => validateInput({ ...input, tableType: 'Physical', location: 'Central Games, Chicago' }));
  assert.throws(() => validateInput({ ...input, virtualPlatform: 'Other', platformOther: '' }));
  assert.doesNotThrow(() => validateInput({ ...input, virtualPlatform: 'Other', platformOther: 'Owlbear Rodeo' }));
  assert.throws(() => validateInput({ ...input, tableType: 'Theater of the Mind', voiceService: 'Other', voiceOther: '' }));
  assert.doesNotThrow(() => validateInput({ ...input, tableType: 'Theater of the Mind', voiceService: 'Other', voiceOther: 'Mumble' }));
});

test('profile pictures are bounded JPEG data and reject external URLs and SVG', async () => {
  const { validProfilePhoto } = await import('../src/app/core/profile-photo');
  assert.equal(validProfilePhoto(''), true);
  assert.equal(validProfilePhoto('data:image/jpeg;base64,/9j/2Q=='), true);
  assert.equal(validProfilePhoto('https://example.com/photo.jpg'), false);
  assert.equal(validProfilePhoto('data:image/svg+xml;base64,AAAA'), false);
  assert.equal(validProfilePhoto('data:image/jpeg;base64,' + 'A'.repeat(90000)), false);
});


test('paid/free filters include legacy free tables and distinguish paid listings', async () => {
  const { matchesPaymentFilter } = await import('../src/app/core/models');
  assert.equal(matchesPaymentFilter({}, 'free'), true);
  assert.equal(matchesPaymentFilter({ paid: false }, 'paid'), false);
  assert.equal(matchesPaymentFilter({ paid: true }, 'free'), false);
  assert.equal(matchesPaymentFilter({ paid: true }, 'paid'), true);
  assert.equal(matchesPaymentFilter({ paid: true }, 'all'), true);
});
import { validCampaignBackground } from '../src/app/core/profile-photo';
test('preparing tables reject joining and applications', () => {
  const preparing: Campaign = { ...base, status: 'Preparing', lifecycleStatus: 'Preparing', currentPlayers: 0, playerIds: [], scheduleState: 'Recruiting' };
  assert.throws(() => joinPatch(preparing, 'c'));
  assert.throws(() => applyPatch({ ...preparing, startMode: 'Rolling' }, 'c'));
});
test('campaign backgrounds allow bounded JPEG data only', () => {
  assert.equal(validCampaignBackground(''), true);
  assert.equal(validCampaignBackground('data:image/jpeg;base64,YQ=='), true);
  assert.equal(validCampaignBackground('https://example.com/image.jpg'), false);
  assert.equal(validCampaignBackground('data:image/jpeg;base64,' + 'A'.repeat(300000)), false);
});
import { matchesPreferences, validatePreferences } from '../src/app/core/campaign-preferences';
test('preference filters distinguish missing metadata and combine selected constraints', () => {
  const value = { tags: ['Newbie friendly','Roleplay focused'], playerAge: '18+', contentRating: 'T' };
  assert.equal(matchesPreferences({}, {}), true);
  assert.equal(matchesPreferences({}, { newbie: true }), false);
  assert.equal(matchesPreferences({}, { contentRating: 'E' }), false);
  assert.equal(matchesPreferences(value, { newbie: true, playStyle: 'Roleplay focused', playerAge: '18+', contentRating: 'T' }), true);
  assert.equal(matchesPreferences(value, { playStyle: 'Combat focused' }), false);
  assert.equal(matchesPreferences(value, { contentRating: 'M' }), false);
});
test('campaign preferences reject invented tags, duplicate tags and invalid ratings', () => {
  assert.doesNotThrow(() => validatePreferences({}));
  assert.doesNotThrow(() => validatePreferences({ tags: ['Session zero'], playerAge: '18+', contentRating: 'AO', contentNotes: 'Discuss boundaries.' }));
  assert.throws(() => validatePreferences({ tags: ['Invented'] }));
  assert.throws(() => validatePreferences({ tags: ['Casual','Casual'] }));
  assert.throws(() => validatePreferences({ playerAge: '12+' }));
  assert.throws(() => validatePreferences({ contentRating: 'X' }));
  assert.throws(() => validatePreferences({ contentNotes: 'A'.repeat(2001) }));
});
import { restrictionActive, restrictionEnd, validateAction } from '../src/app/core/moderation';
test('restriction expiry is automatic and permanent bans never expire', () => {
  const startedAt = Timestamp.fromMillis(1000);
  assert.equal(restrictionActive({ startedAt, seconds:3600, permanent:false }, 3600999), true);
  assert.equal(restrictionActive({ startedAt, seconds:3600, permanent:false }, 3601000), false);
  assert.equal(restrictionActive({ startedAt, seconds:0, permanent:true }, 999999999), true);
  assert.equal(restrictionEnd({ startedAt, seconds:3600, permanent:false })?.getTime(), 3601000);
  assert.equal(restrictionEnd({ startedAt:null, seconds:3600, permanent:false }), null);
});
test('account actions require reasons and predefined durations', () => {
  assert.doesNotThrow(() => validateAction('Timeout', 3600, 'Reason'));
  assert.doesNotThrow(() => validateAction('Mute', 604800, 'Reason'));
  assert.doesNotThrow(() => validateAction('Ban', 0, 'Reason'));
  assert.throws(() => validateAction('Role', 'Owner', 'Reason'));
  assert.throws(() => validateAction('Mute', 0, 'Reason'));
  assert.throws(() => validateAction('Timeout', 3600, '   '));
});
