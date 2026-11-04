export type SocialSummary = {
  scope: 'weekly' | 'global';
  weekStart: string;
  weekEnd: string;
  entries: {
    rank: number;
    alias: string;
    xp: number;
    isMe: boolean;
    appearance?: import('@/lib/premium/appearance').Appearance;
  }[];
  total: number;
  offset: number;
  myPosition: number | null;
  myXp: number;
  privacy: { visible: boolean; alias: string };
  invitations: {
    url: string;
    invited: number;
    qualified: number;
    rewarded: number;
    coins: number;
    rewardCoins: number;
    rewardLimit: number;
  };
};
