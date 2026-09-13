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
import { Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import type { Subject, Department } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { SubjectDialog } from './subject-dialog';
import { DeleteDialog } from './delete-dialog';
import { deleteSubjectAction } from '@/actions/subject_actions';

export function SubjectList() {
  const { firestore } = useFirebase();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);

  const subjectsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'subjects'), orderBy('name', 'asc'));
  }, [firestore]);
  const { data: subjects, isLoading: isLoadingSubjects } = useCollection<Subject>(subjectsQuery);
  
  const deptsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'departments'));
  }, [firestore]);
  const { data: departments, isLoading: isLoadingDepts } = useCollection<Department>(deptsQuery);
  
  const departmentsMap = useMemoFirebase(() => new Map(departments?.map(d => [d.id, d.name])), [departments]);
  const isLoading = isLoadingSubjects || isLoadingDepts;

  const handleEdit = (subject: Subject) => {
    setSelectedSubject(subject);
    setDialogOpen(true);
  };

  const handleAddNew = () => {
    setSelectedSubject(null);
    setDialogOpen(true);
  };

  const handleDelete = (subject: Subject) => {
    setSelectedSubject(subject);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <SubjectDialog
        key={selectedSubject ? `edit-${selectedSubject.id}` : 'new-subj'}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        subject={selectedSubject}
        departments={departments || []}
      />
      <DeleteDialog
        key={selectedSubject ? `delete-${selectedSubject.id}` : 'delete-subj-none'}
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        item={selectedSubject}
        action={deleteSubjectAction}
        itemType="Subject"
      />
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleAddNew} 
          disabled={isLoading || !departments?.length}
          className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white shadow-sm"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Subject
        </Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right w-[180px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && [...Array(3)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                <TableCell className="text-right"><Skeleton className="h-8 w-[150px] ml-auto" /></TableCell>
              </TableRow>
            ))}
            {subjects?.map((subj) => (
              <TableRow key={subj.id}>
                <TableCell className="font-medium">{subj.name}</TableCell>
                <TableCell>{departmentsMap.get(subj.departmentId) || 'N/A'}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="outline" size="icon" onClick={() => handleEdit(subj)}>
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">Edit</span>
                  </Button>
                   <Button variant="destructive" size="icon" onClick={() => handleDelete(subj)}>
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
         {subjects && subjects.length === 0 && !isLoading && (
            <div className="p-4 text-center text-sm text-muted-foreground">
                No subjects found.
            </div>
        )}
         {departments && departments.length === 0 && !isLoading && (
             <div className="p-4 text-center text-sm text-amber-700">
                Please add a department before you can add subjects.
            </div>
         )}
      </div>
    </>
  );
}
