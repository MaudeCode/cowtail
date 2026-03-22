interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={className}>
      {title && (
        <div className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-gray-400 mb-6 pb-2 border-b-2 border-gray-200">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}
