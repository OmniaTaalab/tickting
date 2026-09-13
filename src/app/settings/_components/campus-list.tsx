'use client';
import { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Pencil, PlusCircle, Trash2, Building2, School as SchoolIcon } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import type { Campus, School, Grade } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { CampusDialog } from './campus-dialog';
import { DeleteDialog } from './delete-dialog';
import { deleteCampusAction } from '@/actions/campus_actions';
import { useLanguage } from '@/hooks/use-language';
import { Badge } from '@/components/ui/badge';

export function CampusList() {
  const { firestore } = useFirebase();
  const { t } = useLanguage();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);

  const campusQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'campuses'), orderBy('name', 'asc'));
  }, [firestore]);
  const { data: campuses, isLoading } = useCollection<Campus>(campusQuery);

  const schoolsQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'schools')) : null, [firestore]
  );
  const { data: schools } = useCollection<School>(schoolsQuery);
  const schoolsMap = useMemo(() => new Map(schools?.map(s => [s.id, s.name])), [schools]);

  const gradesQuery = useMemoFirebase(() => 
    firestore ? query(collection(firestore, 'grades')) : null, [firestore]
  );
  const { data: grades } = useCollection<Grade>(gradesQuery);
  const gradesMap = useMemo(() => new Map(grades?.map(g => [g.id, g.name])), [grades]);

  const handleEdit = (campus: Campus) => {
    setSelectedCampus(campus);
    setDialogOpen(true);
  };

  const handleAddNew = () => {
    setSelectedCampus(null);
    setDialogOpen(true);
  };
  
  const handleDelete = (campus: Campus) => {
    setSelectedCampus(campus);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <CampusDialog
        key={selectedCampus ? `edit-${selectedCampus.id}` : 'new-campus'}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        campus={selectedCampus}
      />
      <DeleteDialog
        key={selectedCampus ? `delete-${selectedCampus.id}` : 'delete-campus-none'}
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        item={selectedCampus}
        action={deleteCampusAction}
        itemType={t('campuses')}
      />
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleAddNew} 
          size="sm" 
          className="gap-2 bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white shadow-sm font-bold"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          {t('addCampus')}
        </Button>
      </div>
      <div className="rounded-lg border border-slate-100 overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow>
              <TableHead className="py-4 text-start">{t('campusName')}</TableHead>
              <TableHead className="text-start">Linked Schools & Grades</TableHead>
              <TableHead className="text-end w-[120px] pr-6">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && [...Array(3)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                <TableCell className="text-right pr-6"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
              </TableRow>
            ))}
            {campuses?.map((campus) => (
              <TableRow key={campus.id} className="group hover:bg-slate-50/30 transition-colors">
                <TableCell className="font-semibold text-slate-700 py-4 flex items-center gap-2 text-start align-top">
                    <Building2 className="h-3.5 w-3.5 text-slate-400 mt-1" />
                    {campus.name}
                </TableCell>
                <TableCell className="text-start">
                    <div className="space-y-3 py-2">
                        {campus.schoolConfigs && campus.schoolConfigs.length > 0 ? (
                            campus.schoolConfigs.map((config, idx) => (
                                <div key={idx} className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 uppercase tracking-tight">
                                        <SchoolIcon className="h-3 w-3 text-[#1e3a8a]" />
                                        {schoolsMap.get(config.schoolId) || 'Unknown School'}
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {config.gradeIds.map(gid => (
                                            <Badge key={gid} variant="outline" className="text-[9px] font-bold px-1.5 h-4 bg-slate-50 border-slate-200 text-slate-500">
                                                {gradesMap.get(gid) || gid}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <span className="text-slate-400 italic text-xs">No schools linked</span>
                        )}
                    </div>
                </TableCell>
                <TableCell className="text-end space-x-1 pr-6 rtl:space-x-reverse align-top py-4">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" onClick={() => handleEdit(campus)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(campus)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
         {campuses && campuses.length === 0 && !isLoading && (
            <div className="p-8 text-center text-sm text-slate-400 bg-slate-50/20 italic">
                {t('noCampuses')}
            </div>
        )}
      </div>
    </>
  );
}
