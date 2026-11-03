import type { CefrLevel } from '@/lib/placement/types';
export type LibraryCourse = {
  id: string;
  title: string;
  description: string;
  level: CefrLevel;
  tier: 'free' | 'premium';
  lessons: {
    id: string;
    title: string;
    description: string;
    level: CefrLevel;
    minutes: number | null;
    skills: string[];
    objectives: string[];
    notes: string[];
    unit: string;
    preview: boolean;
    prerequisites: string[];
  }[];
};
