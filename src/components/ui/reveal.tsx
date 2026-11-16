'use client';
import { motion } from 'motion/react';
import { useReducedEffects } from '@/features/experience/experience-provider';
export function Reveal({ children }: { children: React.ReactNode }) {
  const reduced = useReducedEffects();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {children}
    </motion.div>
  );
}
