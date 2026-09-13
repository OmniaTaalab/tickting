'use client';
import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Pencil, PlusCircle, Trash2, Building2 } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import type { Division } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { DivisionDialog } from './division-dialog';
import { DeleteDialog } from './delete-dialog';
import { deleteDivisionAction } from '@/actions/division_actions';
import { useLanguage } from '@/hooks/use-language';

export function DivisionList() {
  const { firestore } = useFirebase();
  const { t } = useLanguage();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDivision, setSelectedDivision] = useState<Division | null>(null);

  const divisionQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'divisions'), orderBy('name', 'asc'));
  }, [firestore]);

  const { data: divisions, isLoading } = useCollection<Division>(divisionQuery);

  const handleEdit = (division: Division) => {
    setSelectedDivision(division);
    setDialogOpen(true);
  };

  const handleAddNew = () => {
    setSelectedDivision(null);
    setDialogOpen(true);
  };
  
  const handleDelete = (division: Division) => {
    setSelectedDivision(division);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <DivisionDialog
        key={selectedDivision ? `edit-${selectedDivision.id}` : 'new-div'}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        division={selectedDivision}
      />
      <DeleteDialog
        key={selectedDivision ? `delete-${selectedDivision.id}` : 'delete-div-none'}
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        item={selectedDivision}
        action={deleteDivisionAction}
        itemType={t('divisions')}
      />
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleAddNew} 
          size="sm" 
          className="gap-2 bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white shadow-sm font-bold"
        >
          <PlusCircle className="h-4 w-4" />
          {t('addDivision')}
        </Button>
      </div>
      <div className="rounded-lg border border-slate-100 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow>
              <TableHead className="py-4 text-start">{t('divisionName')}</TableHead>
              <TableHead className="text-end w-[120px] pr-6">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && [...Array(3)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                <TableCell className="text-right pr-6"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
              </TableRow>
            ))}
            {divisions?.map((division) => (
              <TableRow key={division.id} className="group hover:bg-slate-50/30 transition-colors">
                <TableCell className="font-semibold text-slate-700 py-4 flex items-center gap-2 text-start">
                    <div 
                        className="w-2.5 h-2.5 rounded-full shrink-0" 
                        style={{ backgroundColor: division.color || '#3b82f6' }}
                    />
                    {division.name}
                </TableCell>
                <TableCell className="text-end space-x-1 pr-6 rtl:space-x-reverse">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" onClick={() => handleEdit(division)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(division)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
         {divisions && divisions.length === 0 && !isLoading && (
            <div className="p-8 text-center text-sm text-slate-400 bg-slate-50/20 italic">
                {t('noDivisions')}
            </div>
        )}
      </div>
    </>
  );
}
