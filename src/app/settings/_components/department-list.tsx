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
import { Pencil, PlusCircle, Trash2, Layers } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import type { Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { DepartmentDialog } from './department-dialog';
import { DeleteDialog } from './delete-dialog';
import { deleteDepartmentAction } from '@/actions/department_actions';
import { useLanguage } from '@/hooks/use-language';

export function DepartmentList() {
  const { firestore } = useFirebase();
  const { t } = useLanguage();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);

  const deptsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'departments'), orderBy('name', 'asc'));
  }, [firestore]);

  const { data: departments, isLoading } = useCollection<Department>(deptsQuery);

  const handleEdit = (dept: Department) => {
    setSelectedDept(dept);
    setDialogOpen(true);
  };

  const handleAddNew = () => {
    setSelectedDept(null);
    setDialogOpen(true);
  };
  
  const handleDelete = (dept: Department) => {
    setSelectedDept(dept);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <DepartmentDialog
        key={selectedDept ? `edit-${selectedDept.id}` : 'new-dept'}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        department={selectedDept}
      />
      <DeleteDialog
        key={selectedDept ? `delete-${selectedDept.id}` : 'delete-dept-none'}
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        item={selectedDept}
        action={deleteDepartmentAction}
        itemType={t('categories')}
      />
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleAddNew} 
          size="sm" 
          className="gap-2 bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white shadow-sm font-bold"
        >
          <PlusCircle className="h-4 w-4" />
          {t('addCategory')}
        </Button>
      </div>
      <div className="rounded-lg border border-slate-100 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow>
              <TableHead className="py-4 text-start">{t('categoryName')}</TableHead>
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
            {departments?.map((dept) => (
              <TableRow key={dept.id} className="group hover:bg-slate-50/30 transition-colors">
                <TableCell className="font-semibold text-slate-700 py-4 flex items-center gap-2 text-start">
                    <Layers className="h-3.5 w-3.5 text-slate-400" />
                    {dept.name}
                </TableCell>
                <TableCell className="text-end space-x-1 pr-6 rtl:space-x-reverse">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" onClick={() => handleEdit(dept)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(dept)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
         {departments && departments.length === 0 && !isLoading && (
            <div className="p-8 text-center text-sm text-slate-400 bg-slate-50/20 italic">
                {t('noCategories')}
            </div>
        )}
      </div>
    </>
  );
}
