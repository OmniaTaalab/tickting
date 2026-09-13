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
import { Pencil, PlusCircle, Trash2, School as SchoolIcon } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import type { School } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { SchoolDialog } from './school-dialog';
import { DeleteDialog } from './delete-dialog';
import { deleteSchoolAction } from '@/actions/school_actions';
import { useLanguage } from '@/hooks/use-language';

export function SchoolList() {
  const { firestore } = useFirebase();
  const { t } = useLanguage();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);

  const schoolQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'schools'), orderBy('name', 'asc'));
  }, [firestore]);

  const { data: schools, isLoading } = useCollection<School>(schoolQuery);

  const handleEdit = (school: School) => {
    setSelectedSchool(school);
    setDialogOpen(true);
  };

  const handleAddNew = () => {
    setSelectedSchool(null);
    setDialogOpen(true);
  };
  
  const handleDelete = (school: School) => {
    setSelectedSchool(school);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <SchoolDialog
        key={selectedSchool ? `edit-${selectedSchool.id}` : 'new-school'}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        school={selectedSchool}
      />
      <DeleteDialog
        key={selectedSchool ? `delete-${selectedSchool.id}` : 'delete-school-none'}
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        item={selectedSchool}
        action={deleteSchoolAction}
        itemType={t('schools')}
      />
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleAddNew} 
          size="sm" 
          className="gap-2 bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white shadow-sm font-bold"
        >
          <PlusCircle className="h-4 w-4" />
          {t('addSchool')}
        </Button>
      </div>
      <div className="rounded-lg border border-slate-100 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow>
              <TableHead className="py-4 text-start">{t('schoolName')}</TableHead>
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
            {schools?.map((school) => (
              <TableRow key={school.id} className="group hover:bg-slate-50/30 transition-colors">
                <TableCell className="font-semibold text-slate-700 py-4 flex items-center gap-2 text-start">
                    <SchoolIcon className="h-3.5 w-3.5 text-slate-400" />
                    {school.name}
                </TableCell>
                <TableCell className="text-end space-x-1 pr-6 rtl:space-x-reverse">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" onClick={() => handleEdit(school)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(school)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
         {schools && schools.length === 0 && !isLoading && (
            <div className="p-8 text-center text-sm text-slate-400 bg-slate-50/20 italic">
                {t('noSchools')}
            </div>
        )}
      </div>
    </>
  );
}
