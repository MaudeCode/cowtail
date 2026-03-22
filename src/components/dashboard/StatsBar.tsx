import type { Outcome } from '../../types';

interface Stats {
  total: number;
  fixed: number;
  selfResolved: number;
  noise: number;
  escalated: number;
}

const items: Array<{
  key: keyof Stats;
  outcome: Outcome | 'all';
  label: string;
  numColor: string;
  activeBorderColor: string;
  activeBg: string;
}> = [
  { key: 'total', outcome: 'all', label: 'Total', numColor: '', activeBorderColor: 'border-b-accent', activeBg: 'bg-glow' },
  { key: 'fixed', outcome: 'fixed', label: 'Fixed', numColor: 'text-outcome-fixed', activeBorderColor: 'border-b-outcome-fixed', activeBg: 'bg-[rgba(45,155,82,0.08)]' },
  { key: 'selfResolved', outcome: 'self-resolved', label: 'Self Resolved', numColor: 'text-self-resolved', activeBorderColor: 'border-b-self-resolved', activeBg: 'bg-[rgba(58,123,213,0.08)]' },
  { key: 'noise', outcome: 'noise', label: 'Noise', numColor: 'text-noise', activeBorderColor: 'border-b-noise', activeBg: 'bg-[rgba(90,90,100,0.08)]' },
  { key: 'escalated', outcome: 'escalated', label: 'Escalated', numColor: 'text-escalated', activeBorderColor: 'border-b-escalated', activeBg: 'bg-[rgba(212,136,10,0.08)]' },
];

interface StatsBarProps {
  stats: Stats;
  activeOutcome: Outcome | 'all';
  onOutcomeChange: (outcome: Outcome | 'all') => void;
}

export default function StatsBar({ stats, activeOutcome, onOutcomeChange }: StatsBarProps) {
  return (
    <div className="flex border-b border-gray-200 flex-wrap max-md:flex-col">
      {items.map(({ key, outcome, label, numColor, activeBorderColor, activeBg }) => {
        const isActive = activeOutcome === outcome;
        return (
          <div
            key={key}
            className={`flex-1 min-w-[20%] px-6 py-4 border-r border-gray-100 text-center cursor-pointer transition-all duration-150 bg-surface border-b-2 border-b-transparent last:border-r-0 hover:bg-[rgba(255,255,255,0.02)] max-md:min-w-full max-md:border-r-0 max-md:border-b max-md:border-b-gray-100 ${isActive ? `${activeBorderColor} ${activeBg}` : ''}`}
            onClick={() => onOutcomeChange(outcome)}
          >
            <div className={`text-[1.8rem] font-bold leading-none ${numColor}`}>{stats[key]}</div>
            <div className={`font-mono text-[0.55rem] uppercase tracking-[0.12em] mt-1 ${isActive ? 'text-txt' : 'text-gray-400'}`}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}
