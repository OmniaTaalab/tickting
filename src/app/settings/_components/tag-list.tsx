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
import { Pencil, PlusCircle, Trash2, Tag as TagIcon } from 'lucide-react';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import { Skeleton } from '@/components/ui/skeleton';
import { TagDialog } from './tag-dialog';
import { DeleteDialog } from './delete-dialog';
import { deleteTagAction } from '@/actions/tag_actions';
import { useLanguage } from '@/hooks/use-language';

export function TagList() {
  const { firestore } = useFirebase();
  const { t } = useLanguage();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<{ id: string; name: string } | null>(null);

  const tagsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'settings_tags'), orderBy('name', 'asc'));
  }, [firestore]);

  const { data: tags, isLoading } = useCollection<{ name: string }>(tagsQuery);

  const handleEdit = (tag: any) => {
    setSelectedTag(tag);
    setDialogOpen(true);
  };

  const handleAddNew = () => {
    setSelectedTag(null);
    setDialogOpen(true);
  };
  
  const handleDelete = (tag: any) => {
    setSelectedTag(tag);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <TagDialog
        key={selectedTag ? `edit-${selectedTag.id}` : 'new-tag'}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        tag={selectedTag}
      />
      <DeleteDialog
        key={selectedTag ? `delete-${selectedTag.id}` : 'delete-tag-none'}
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        item={selectedTag}
        action={deleteTagAction}
        itemType={t('tag')}
      />
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleAddNew}
          className="bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-white shadow-sm font-bold gap-2"
        >
          <PlusCircle className="h-4 w-4" />
          {t('addPredefinedTag')}
        </Button>
      </div>
      <div className="rounded-md border bg-white overflow-hidden">
        <Table>
          <TableHeader className="bg-slate-50/50">
            <TableRow>
              <TableHead className="py-4 text-start font-bold text-slate-500 uppercase tracking-tight text-[10px]">
                {t('tagName')}
              </TableHead>
              <TableHead className="text-end w-[180px] pr-6 font-bold text-slate-500 uppercase tracking-tight text-[10px]">
                {t('actions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && [...Array(3)].map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                <TableCell className="text-right space-x-2">
                    <Skeleton className="h-8 w-[150px] ml-auto" />
                </TableCell>
              </TableRow>
            ))}
            {tags?.map((tag) => (
              <TableRow key={tag.id} className="group hover:bg-slate-50/30 transition-colors">
                <TableCell className="font-bold text-slate-700 py-4 flex items-center gap-2 text-start">
                    <TagIcon className="h-4 w-4 text-slate-400" />
                    #{tag.name}
                </TableCell>
                <TableCell className="text-end space-x-2 pr-6 rtl:space-x-reverse">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-indigo-600" onClick={() => handleEdit(tag)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={() => handleDelete(tag)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
         {tags && tags.length === 0 && !isLoading && (
            <div className="p-8 text-center text-sm text-slate-400 italic">
                {t('noTagsFound')}
            </div>
        )}
      </div>
    </>
  );
}
