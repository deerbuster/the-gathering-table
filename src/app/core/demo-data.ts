import { Timestamp } from 'firebase/firestore';
import { Campaign, Profile } from './models';
import { scheduleDay, dateInZone } from './time';

export const DEMO_PLAYER = 'demo-player';
export const DEMO_GM = 'demo-gm';
export function demoCampaigns(): Campaign[] {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const seeds = [
    ['the-ashen-frontier', 'The Ashen Frontier', 'RMU', 'Mara', 3, 5, 3, 1, 'Weekly', 4, 'A border fortress. A missing caravan. Something beneath the ash.\n\n## The table\nA character-led Rolemaster Unified campaign with dangerous combat and room for discovery. New players are welcome; we will build characters together.\n\n**Bring:** curiosity, a microphone, and a willingness to work as a party.'],
    ['stars-beyond', 'Stars Beyond the Veil', 'Space Master', 'Orion', 2, 4, 1, 2, 'Biweekly', 3, 'Your salvage crew has discovered a signal from a ship that vanished a century ago.\n\nA science-fiction exploration campaign with tactical encounters and collaborative storytelling.'],
    ['roads-of-eriador', 'The Roads of Eriador', 'MERP', 'Elin', 3, 6, 6, 3, 'Weekly', 3, 'Travel the forgotten roads of Middle-earth, where old ruins hold older secrets.\n\nThis table is currently full.'],
    ['winter-court', 'The Winter Court', 'HARP', 'Rowan', 2, 5, 2, 4, 'Weekly', 2.5, 'A stolen oath has left the winter court without an heir.\n\nA welcoming fantasy campaign of intrigue, strange bargains, and unexpected allies.'],
    ['under-iron-hills', 'Under the Iron Hills', 'Rolemaster Classic', 'Bram', 3, 5, 2, 5, 'Biweekly', 4, 'The miners heard singing before the tunnels went silent.\n\nClassic dungeon exploration with meaningful choices and a steady, patient pace.'],
    ['last-watch', 'The Last Watch', 'RMFRP', 'Sera', 2, 4, 3, 6, 'One-shot', 3, 'One night remains before the city gates fall. Who will stand the last watch?\n\nA focused one-shot for players who enjoy high stakes and teamwork.'],
  ] as const;
  return seeds.map((s, index) => {
    const date = new Date();
    date.setDate(date.getDate() + s[7]);
    date.setHours(19, 0, 0, 0);
    const local = dateInZone(date, zone);
    return {
      id: s[0], name: s[1], systemType: s[2], gmName: s[3],
      tableType: 'Virtual', location: '', virtualPlatform: 'Fantasy Grounds', platformOther: '', voiceService: 'Discord', voiceOther: '', recorded: false, broadcast: false, paid: index === 1,
      gmUserId: index === 0 ? DEMO_GM : `sample-gm-${index}`,
      minPlayers: s[4], maxPlayers: s[5], currentPlayers: s[6],
      playerIds: Array.from({ length: s[6] }, (_, i) => `sample-player-${index}-${i}`), pendingPlayerIds: [],
      startMode: index === 0 ? 'Rolling' : 'Fixed',
      scheduleRevision: 0,
      lifecycleStatus: index === 0 ? 'New' : 'Established',
      retiredPlayerIds: index === 0 ? ['demo-retired'] : [],
      status: s[6] === s[5] ? 'Full' : 'Open',
      scheduleState: index === 0 ? 'Confirmed' : 'Recruiting',
      description: s[10], dayOfWeek: scheduleDay(local), sessionLengthHours: s[9],
      frequency: s[8], startTime: index === 0 ? null : Timestamp.fromDate(date), timeZone: zone, localStartTime: index === 0 ? null : '19:00',
      ...(index === 0 ? { scheduleState: 'Recruiting' as const, dayOfWeek: null } : {}),
    };
  });
}
export function demoProfiles(): Record<string, Profile> {
  return {
    [DEMO_PLAYER]: { username: 'Alex', biography: 'Here for discovery, good company, and a well-earned critical.', pastPlayerReviews: [], allowCampaignMessages: false },
    [DEMO_GM]: { username: 'Mara', biography: 'GM of The Ashen Frontier. I enjoy character-driven adventures and helping new players find their footing.', pastPlayerReviews: [], allowCampaignMessages: true },
    'demo-retired': { username: 'Finch', biography: 'Former player of The Ashen Frontier. Happy to answer questions about the table.', pastPlayerReviews: [], allowCampaignMessages: true },
  };
}


