'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useDoc, useFirebase, useMemoFirebase, useUser } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { SLASettings, TicketChannel, TicketPriority } from '@/lib/types';
import { DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { Mail, Phone, User, MessageCircle, Loader2, Save, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { updateSLASettingsAction } from '@/actions/sla_actions';
import { useLanguage } from '@/hooks/use-language';

const channels: { id: TicketChannel; icon: any; color: string; bg: string }[] = [
  { id: 'Email', icon: Mail, color: 'text-blue-600', bg: 'bg-blue-50' },
  { id: 'Phone', icon: Phone, color: 'text-green-600', bg: 'bg-green-50' },
  { id: 'Walk-in', icon: User, color: 'text-purple-600', bg: 'bg-purple-50' },
  { id: 'WhatsApp', icon: MessageCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { id: 'Social Media', icon: Globe, color: 'text-sky-600', bg: 'bg-sky-50' },
  { id: 'Web', icon: Globe, color: 'text-amber-600', bg: 'bg-amber-50' },
];

const priorities: TicketPriority[] = ['Low', 'Normal', 'High', 'Urgent'];

export function SLAPolicies() {
  const { firestore } = useFirebase();
  const { user: currentUser } = useUser();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [isSaving, setIsSaving] = useState(false);

  const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
  const { data: savedSettings, isLoading } = useDoc<SLASettings>(slaRef);

  const [localSettings, setLocalSettings] = useState<SLASettings>(DEFAULT_SLA_SETTINGS);

  useEffect(() => {
    if (savedSettings) {
      // Merge with defaults to handle any missing keys
      setLocalSettings({ ...DEFAULT_SLA_SETTINGS, ...savedSettings });
    }
  }, [savedSettings]);

  const handleChange = (channel: TicketChannel, priority: TicketPriority, value: string) => {
    const num = parseInt(value) || 0;
    setLocalSettings((prev) => ({
      ...prev,
      [channel]: {
        ...(prev[channel] || DEFAULT_SLA_SETTINGS[channel] || { Low: 24, Normal: 8, High: 4, Urgent: 2 }),
        [priority]: num,
      },
    }));
  };

  const handleSave = async () => {
    if (!currentUser) return;
    setIsSaving(true);
    const result = await updateSLASettingsAction(localSettings, {
      userId: currentUser.uid,
      name: currentUser.displayName || 'Admin',
    });

    if (result.success) {
      toast({ title: '✅ Success!', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card className="border-none shadow-sm bg-white overflow-hidden">
      <CardHeader className="bg-slate-50/50 border-b px-6 py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <CardTitle className="text-xl font-bold">{t('slaResponsePolicies')}</CardTitle>
            <CardDescription className="max-w-2xl mt-1">
              {t('slaDescription')}
            </CardDescription>
          </div>
          <Button 
            onClick={handleSave} 
            disabled={isSaving} 
            className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white gap-2 shadow-sm font-bold"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('savePolicies')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50/30">
                <th className="px-6 py-4 text-start text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b">
                    {t('channel')}
                </th>
                {priorities.map((p) => (
                  <th key={p} className="px-6 py-4 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b">
                    {t(p.toLowerCase())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channels.map((chan) => (
                <tr key={chan.id} className="group hover:bg-slate-50/30 transition-colors">
                  <td className="px-6 py-4 border-b">
                    <div className="flex items-center gap-3">
                      <div className={cn('p-2 rounded-lg', chan.bg)}>
                        <chan.icon className={cn('h-4 w-4', chan.color)} />
                      </div>
                      <span className="font-bold text-slate-700">{chan.id}</span>
                    </div>
                  </td>
                  {priorities.map((p) => (
                    <td key={p} className="px-6 py-4 border-b text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="relative group/input">
                          <Input
                            type="number"
                            value={localSettings[chan.id]?.[p] ?? 0}
                            onChange={(e) => handleChange(chan.id, p, e.target.value)}
                            className="w-20 h-10 text-center font-semibold bg-white border-slate-200 focus:ring-[#1e3a8a] focus:border-[#1e3a8a]"
                          />
                        </div>
                        <span className="text-slate-400 text-xs font-medium">h</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 bg-slate-50/30">
          <p className="text-[11px] text-slate-500 italic">
            {t('slaNote')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
