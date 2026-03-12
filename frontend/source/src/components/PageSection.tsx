import { ReactNode } from 'react';
import { cn } from './ui/utils';

interface PageSectionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Унифицированная "рамка" страницы: отступы, фон и легкая тень.
 * Помогает привести интерфейс к единому визуальному стилю.
 */
export function PageSection({ children, className }: PageSectionProps) {
  return (
    <section className={cn('w-full p-0', className)}>
      {children}
    </section>
  );
}
