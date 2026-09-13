'use client';

import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/use-language";

export function TicketPriorityDisplay({ priority }: { priority: string }) {
  const { t } = useLanguage();

  const priorityStyles: Record<string, { color: string, dot: string, label: string }> = {
    Urgent: { color: "text-red-600", dot: "bg-red-600", label: t('urgent') },
    Critical: { color: "text-red-600", dot: "bg-red-600", label: t('urgent') },
    High: { color: "text-orange-500", dot: "bg-orange-500", label: t('high') },
    Normal: { color: "text-blue-600", dot: "bg-blue-600", label: t('normal') },
    Medium: { color: "text-blue-600", dot: "bg-blue-600", label: t('normal') },
    Low: { color: "text-slate-500", dot: "bg-slate-500", label: t('low') },
  };

  const style = priorityStyles[priority] || { color: "text-blue-600", dot: "bg-blue-600", label: t('normal') };

  return (
    <div className={cn("flex items-center gap-2 font-semibold whitespace-nowrap", style.color)}>
      <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", style.dot)} />
      <span className="text-sm">{style.label}</span>
    </div>
  );
}
