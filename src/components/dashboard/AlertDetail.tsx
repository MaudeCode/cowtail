import type { Alert } from '../../types';

interface AlertDetailProps {
  alert: Alert;
}

export default function AlertDetail({ alert }: AlertDetailProps) {
  return (
    <div className="col-span-full py-5 border-l-[3px] border-l-accent pl-5 slide-in bg-surface">
      <div className="mb-3 last:mb-0">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-gray-400 mb-1">Summary</div>
        <div className="text-[0.85rem] leading-relaxed text-gray-600">{alert.summary}</div>
      </div>
      {alert.rootCause && (
        <div className="mb-3 last:mb-0">
          <div className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-gray-400 mb-1">Root Cause</div>
          <div className="text-[0.85rem] leading-relaxed text-gray-600">{alert.rootCause}</div>
        </div>
      )}
      <div className="mb-3 last:mb-0">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-gray-400 mb-1">Action Taken</div>
        <div className="text-[0.85rem] leading-relaxed text-gray-600">{alert.actionTaken}</div>
      </div>
    </div>
  );
}
