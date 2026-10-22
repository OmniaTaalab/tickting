import type { TicketStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/hooks/use-language';

interface TicketStatusBadgeProps {
  status: TicketStatus;
}

const statusStyles: Record<TicketStatus | 'Pending', string> = {
  Open: 'bg-blue-100 text-blue-800 hover:bg-blue-100/80',
  'In Progress': 'bg-amber-100 text-amber-800 hover:bg-amber-100/80',
  Pending: 'bg-amber-100 text-amber-800 hover:bg-amber-100/80',
  Resolved: 'bg-green-100 text-green-800 hover:bg-green-100/80',
  Closed: 'bg-red-100 text-red-800 hover:bg-red-100/80',
  Queue: 'bg-purple-100 text-purple-800 hover:bg-purple-100/80 border-purple-200',
  Waiting: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-100/80',
  Duplicate: 'bg-slate-100 text-slate-800 hover:bg-slate-100/80 border-slate-200',
  Ignored: 'bg-zinc-200 text-zinc-800 hover:bg-zinc-200/80 border-zinc-300',
};

export function TicketStatusBadge({ status }: TicketStatusBadgeProps) {
  const { t } = useLanguage();

  const statusTranslations: Record<TicketStatus, string> = {
    Open: t('open'),
    'In Progress': t('inProgress'),
    Resolved: t('resolved'),
    Closed: t('closed'),
    Queue: t('queue'),
    Waiting: t('waiting'),
    Duplicate: t('duplicate'),
    Ignored: t('ignored'),
  };

  const knownStatus = (Object.keys(statusTranslations) as TicketStatus[]).find(
    key => key.toLowerCase() === String(status || '').trim().toLowerCase()
  );
  const normalizedStatus = knownStatus || 'Open';
  const style = statusStyles[normalizedStatus];
  const translated = statusTranslations[normalizedStatus];
  const displayText = normalizedStatus === 'Ignored' && (!translated || translated === 'ignored')
    ? 'Ignored'
    : translated || normalizedStatus;

  return (
    <Badge
      variant="outline"
      className={cn(
        'border-transparent font-bold px-2.5 py-0.5 uppercase text-[10px] tracking-tight whitespace-nowrap',
        style
      )}
    >
      {displayText}
    </Badge>
  );
}
