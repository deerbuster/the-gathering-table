import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase/firestore';
import { Campaign, CampaignInput, joinPatch, leavePatch, validateInput, applyPatch, acceptPatch } from '../src/app/core/models';
import { localToDate, dateInZone, scheduleDay } from '../src/app/core/time';

const base: Campaign = {
  tableType: 'Virtual', location: '', virtualPlatform: 'Fantasy Grounds', platformOther: '', voiceService: 'Discord', voiceOther: '', recorded: false, broadcast: false,
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
