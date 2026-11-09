'use client';
import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type MultiSelectOption = {
  id: string;
  label: string;
  /** Small muted text after the label, e.g. the campus a school belongs to. */
  hint?: string;
  disabled?: boolean;
};

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  searchable?: boolean;
  className?: string;
  /** Show "Select all / Clear" shortcuts. */
  bulkActions?: boolean;
  maxBadges?: number;
}

/**
 * Checkbox multi-select in a popover. Controlled; stores ids only.
 * Used by the settings dialogs (campus tree, categories, mailboxes) and the
 * employee scope selector so every multi choice looks and behaves the same.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyText = 'Nothing to choose from',
  disabled,
  searchable,
  className,
  bulkActions,
  maxBadges = 6,
}: MultiSelectProps) {
  const [search, setSearch] = useState('');
  const selected = useMemo(() => options.filter((o) => value.includes(o.id)), [options, value]);
  const visible = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint || '').toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('h-auto min-h-11 w-full justify-between bg-white border-slate-200 px-3 py-2 font-normal', className)}
        >
          <div className="flex flex-wrap gap-1 overflow-hidden text-start">
            {selected.length === 0 ? (
              <span className="text-slate-400 text-sm">{placeholder}</span>
            ) : (
              <>
                {selected.slice(0, maxBadges).map((o) => (
                  <Badge key={o.id} variant="secondary" className="bg-slate-100 text-[10px] px-1.5 py-0 h-5 font-semibold">
                    {o.label}
                  </Badge>
                ))}
                {selected.length > maxBadges && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">+{selected.length - maxBadges}</Badge>
                )}
              </>
            )}
          </div>
          <ChevronDown className="h-4 w-4 text-slate-400 shrink-0 ms-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        {(searchable || bulkActions) && (
          <div className="p-2 border-b space-y-2">
            {searchable && (
              <div className="relative">
                <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="h-8 ps-7 text-xs"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            {bulkActions && (
              <div className="flex items-center justify-between text-[11px] font-semibold">
                <button
                  type="button"
                  className="text-[#1e3a8a] hover:underline disabled:text-slate-300"
                  disabled={!visible.length}
                  onClick={() => onChange(Array.from(new Set([...value, ...visible.filter((o) => !o.disabled).map((o) => o.id)])))}
                >
                  Select all{search ? ' shown' : ''}
                </button>
                <button type="button" className="text-slate-500 hover:underline disabled:text-slate-300" disabled={!value.length} onClick={() => onChange([])}>
                  Clear
                </button>
              </div>
            )}
          </div>
        )}
        <div className="p-2 space-y-0.5 max-h-[280px] overflow-y-auto">
          {visible.length === 0 ? (
            <p className="p-3 text-xs text-slate-400 text-center">{emptyText}</p>
          ) : (
            visible.map((o) => {
              const checked = value.includes(o.id);
              return (
                <div
                  key={o.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!o.disabled) toggle(o.id);
                  }}
                  className={cn(
                    'flex items-center gap-2 p-2 rounded-md cursor-pointer select-none transition-colors',
                    o.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-50'
                  )}
                >
                  <Checkbox checked={checked} className="h-4 w-4 pointer-events-none" />
                  <span className="text-sm font-medium text-slate-700 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-[10px] text-slate-400 truncate max-w-[90px]">{o.hint}</span>}
                  {checked && <Check className="h-3.5 w-3.5 text-[#1e3a8a]" />}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
