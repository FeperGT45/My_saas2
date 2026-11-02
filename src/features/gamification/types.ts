export type Rewards = {
  eligible: boolean;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  achievements: string[];
  sections: string[];
  daily: string[];
  streak: number;
};
export type GameSummary = {
  xp: number;
  level: number;
  levelFloor: number;
  nextLevelXp: number;
  levelProgress: number;
  coins: number;
  timeZone: string;
  timeZoneLocked: boolean;
  today: string;
  streak: { current: number; longest: number };
  completedLessons: number;
  achievements: {
    code: string;
    title: string;
    description: string;
    coins: number;
    unlocked: boolean;
  }[];
  sections: { title: string; coins: number; kind: 'unit' | 'course' }[];
  daily: {
    id: string;
    title: string;
    target: number;
    progress: number;
    coins: number;
    claimed: boolean;
  }[];
};
