'use client';

import {
    useMemo,
    useEffect,
    useState,
    useTransition,
  } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useActionState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Phone, User, AlertCircle, Paperclip, FileText, Image as ImageIcon, X, UserCircle2, Globe, Hash, LayoutList, Type } from 'lucide-react';
import { useFirebase, useUser, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import {
  collection,
  query,
  doc,
  getDocs
} from 'firebase/firestore';
import type { Department, Campus, School, Division, Grade, UserProfile } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { createTicketAction } from '@/actions/ticket_create';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/hooks/use-language';

const FormSchema = z.object({
    title: z.string().min(3, 'Title is required.').max(100, 'Title cannot exceed 100 characters.'),
    departmentId: z.string({ required_error: 'Please select a Category.' }).min(1, 'Please select a Category.'),
    schoolId: z.string({ required_error: 'Please select a school.' }).min(1, 'Please select a school.'),
    campusId: z.string({ required_error: 'Please select a campus.' }).min(1, 'Please select a campus.'),
    divisionId: z.string({ required_error: 'Please select a division.' }).min(1, 'Please select a division.'),
    gradeId: z.string({ required_error: 'Please select a grade.' }).min(1, 'Please select a grade.'),
    channel: z.enum(['Phone', 'Walk-in', 'Social Media', 'Form'], { required_error: 'Please select a channel.' }),
    description: z.string().min(10, 'Description must be at least 10 characters.'),
    parentName: z.string().min(2, 'Parent name is required.'),
    parentEmail: z.string().email('A valid email is required.'),
    studentBlbId: z.string().optional(),
});

export default function NewTicketPage() {
  const { toast } = useToast();
  const { user } = useUser();
  const { firestore } = useFirebase();
  const { t, isRTL } = useLanguage();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const [state, formAction, actionPending] = useActionState(
    createTicketAction,
    { success: false }
  );
  
  const [transitionPending, startTransition] = useTransition();
  const isPending = actionPending || transitionPending;

  const channels = [
    { value: 'Phone', icon: Phone, label: t('Phone') },
    { value: 'Walk-in', icon: User, label: t('Walk-in') },
    { value: 'Social Media', icon: Globe, label: t('Social Media') },
  ];

  const userProfileRef = useMemoFirebase(() =>
    user && firestore ? doc(firestore, 'users', user.uid) : null,
    [user, firestore]
  );
  const { data: userProfile } = useDoc<UserProfile>(userProfileRef);

  const departmentsQuery = useMemoFirebase(() =>
    firestore ? query(collection(firestore, 'departments')) : null,
    [firestore]
  );
  const { data: departments } = useCollection<Department>(departmentsQuery);

  const schoolsQuery = useMemoFirebase(() =>
    firestore ? query(collection(firestore, 'schools')) : null,
    [firestore]
  );
  const { data: allSchools } = useCollection<School>(schoolsQuery);

  const campusesQuery = useMemoFirebase(() =>
    firestore ? query(collection(firestore, 'campuses')) : null,
    [firestore]
  );
  const { data: campuses } = useCollection<Campus>(campusesQuery);

  const divisionsQuery = useMemoFirebase(() =>
    firestore ? query(collection(firestore, 'divisions')) : null,
    [firestore]
  );
  const { data: divisions } = useCollection<Division>(divisionsQuery);

  const gradesQuery = useMemoFirebase(() =>
    firestore ? query(collection(firestore, 'grades')) : null,
    [firestore]
  );
  const { data: allGrades } = useCollection<Grade>(gradesQuery);
useEffect(() => {
  if (!firestore || !user) return;

  const testFirestore = async () => {
    console.log(
      '🔥 CLIENT FIREBASE PROJECT:',
      firestore.app.options.projectId
    );

    console.log('⏳ Starting campuses request...');

    try {
      const campusesSnap = await getDocs(
        collection(firestore, 'campuses')
      );

      console.log('✅ Campuses request finished');
      console.log('✅ Campuses count:', campusesSnap.size);

      console.log(
        '✅ Campuses data:',
        campusesSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
    } catch (error: any) {
      console.error('❌ CAMPUSES ERROR CODE:', error?.code);
      console.error('❌ CAMPUSES ERROR MESSAGE:', error?.message);
      console.error('❌ FULL ERROR:', error);
    }
  };

  testFirestore();
}, [firestore, user]);
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      title: '',
      departmentId: '',
      schoolId: '',
      campusId: '',
      divisionId: '',
      gradeId: '',
      channel: user ? 'Phone' : 'Form',
      description: '',
      parentName: '',
      parentEmail: '',
      studentBlbId: '',
    },
  });

  const selectedCampusId = form.watch('campusId');
  const selectedSchoolId = form.watch('schoolId');

  // Filter available schools based on selected campus
  const availableSchools = useMemo(() => {
    if (!selectedCampusId || !campuses || !allSchools) return [];
    const campus = campuses.find(c => c.id === selectedCampusId);
    if (!campus || !campus.schoolConfigs) return allSchools; // Fallback to all if no config
    
    const linkedSchoolIds = campus.schoolConfigs.map(config => config.schoolId);
    return allSchools.filter(s => linkedSchoolIds.includes(s.id));
  }, [selectedCampusId, campuses, allSchools]);

  // Filter available grades based on selected campus and school
  const availableGrades = useMemo(() => {
    if (!selectedCampusId || !selectedSchoolId || !campuses || !allGrades) return [];
    const campus = campuses.find(c => c.id === selectedCampusId);
    if (!campus || !campus.schoolConfigs) return allGrades; // Fallback

    const schoolConfig = campus.schoolConfigs.find(config => config.schoolId === selectedSchoolId);
    if (!schoolConfig) return [];
    
    return allGrades.filter(g => schoolConfig.gradeIds.includes(g.id));
  }, [selectedCampusId, selectedSchoolId, campuses, allGrades]);

  // Reset dependent fields when parent changes
  useEffect(() => {
    form.setValue('schoolId', '');
    form.setValue('gradeId', '');
  }, [selectedCampusId, form]);

  useEffect(() => {
    form.setValue('gradeId', '');
  }, [selectedSchoolId, form]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
        const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
        const newFiles: File[] = [];
        
        Array.from(files).forEach(file => {
            if (allowedTypes.includes(file.type)) {
                newFiles.push(file);
            } else {
                toast({
                    variant: 'destructive',
                    title: t('invalidFileType'),
                    description: t('invalidFileDetail', { name: file.name }),
                });
            }
        });

        setSelectedFiles(prev => [...prev, ...newFiles]);
        e.target.value = '';
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmitAction = async (formData: FormData) => {
    // Manually trigger validation before action to show toast if needed
    const isValid = await form.trigger();
    if (!isValid) {
        const descriptionError = form.formState.errors.description;
        if (descriptionError) {
            toast({
                variant: 'destructive',
                title: t('invalidFileType'),
                description: t('minCharsError'),
            });
        }
        return;
    }

    selectedFiles.forEach(file => {
      formData.append('attachments', file);
    });
    
    if (!user) {
        formData.set('channel', 'Form');
    }
  
    startTransition(() => {
        formAction(formData);
    });
  };

  const currentStaffName = userProfile?.name || user?.displayName || 'Staff';

  return (
    <Card className="max-w-2xl mx-auto my-8 border-none shadow-xl bg-white overflow-hidden">
        <CardHeader className="bg-[#1e3a8a] text-white p-8">
          <CardTitle className="text-2xl font-bold text-start">{t('createTicketTitle')}</CardTitle>
          {user && (
            <CardDescription className="text-blue-100 text-start">
              {t('createTicketSub')}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="p-8">
            <Form {...form}>
            <form action={handleSubmitAction} className="space-y-8">
                {state?.message && !state?.success && (
                    <Alert variant="destructive" className="bg-red-50 border-red-200">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{state?.message}</AlertDescription>
                    </Alert>
                )}

                {user && (
                    <>
                        <input type="hidden" name="staffId" value={user.uid} />
                        <input type="hidden" name="staffName" value={currentStaffName} />
                        <input type="hidden" name="staffEmail" value={user.email || ''} />
                        <input type="hidden" name="staffAvatar" value={userProfile?.avatarUrl || user.photoURL || ''} />
                        
                        <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-100 mb-6 text-start">
                            <UserCircle2 className="h-5 w-5 text-[#1e3a8a]" />
                            <div className="text-xs">
                                <p className="font-bold text-slate-700">{t('creatingAs', { name: currentStaffName })}</p>
                                <p className="text-slate-400">{t('identityLinkNote')}</p>
                            </div>
                        </div>
                    </>
                )}

                {user && (
                    <div className="space-y-3">
                        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-start block">{t('channelLabel')}</Label>
                        <FormField
                            control={form.control}
                            name="channel"
                            render={({ field }) => (
                                <FormItem className="space-y-0">
                                    <FormControl>
                                        <RadioGroup
                                            onValueChange={field.onChange}
                                            defaultValue={field.value}
                                            className="flex flex-wrap gap-3"
                                            name={field.name}
                                        >
                                            {channels.map((chan) => (
                                                <div key={chan.value}>
                                                    <RadioGroupItem
                                                        value={chan.value}
                                                        id={chan.value}
                                                        className="peer sr-only"
                                                    />
                                                    <Label
                                                        htmlFor={chan.value}
                                                        className={cn(
                                                            "flex items-center gap-2 px-6 py-3 rounded-xl border border-slate-200 bg-white cursor-pointer transition-all hover:bg-slate-50 peer-data-[state=checked]:bg-[#f0f4ff] peer-data-[state=checked]:border-[#1e3a8a] peer-data-[state=checked]:text-[#1e3a8a] peer-data-[state=checked]:shadow-sm",
                                                            "text-sm font-semibold text-slate-600"
                                                        )}
                                                    >
                                                        <chan.icon className="h-4 w-4" />
                                                        {chan.label}
                                                    </Label>
                                                </div>
                                            ))}
                                        </RadioGroup>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                )}

                <div className="space-y-6">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-start">
                        <User className="h-4 w-4 text-slate-400" />
                        <h3 className="text-sm font-bold text-slate-800">{t('parentStudentInfo')}</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="parentName"
                            render={({ field }) => (
                                <FormItem className="text-start">
                                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('parentNameLabel')}</FormLabel>
                                <FormControl>
                                    <Input placeholder={t('fullNamePlaceholder')} className="h-12 bg-slate-50/50 border-slate-200 text-start" {...field} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="parentEmail"
                            render={({ field }) => (
                                <FormItem className="text-start">
                                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('parentEmailLabel')}</FormLabel>
                                <FormControl>
                                    <Input type="email" placeholder={t('emailPlaceholder')} className="h-12 bg-slate-50/50 border-slate-200 text-start" {...field} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="studentBlbId"
                        render={({ field }) => (
                            <FormItem className="md:w-1/2 text-start">
                                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                    <Hash className="h-3 w-3" /> {t('studentBlbIdLabel')} <span className="text-[9px] text-slate-400 lowercase font-medium ml-1">({t('optional')})</span>
                                </FormLabel>
                                <FormControl>
                                    <Input placeholder={t('blbPlaceholder')} className="h-12 bg-slate-50/50 border-slate-200 text-start" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="space-y-6 pt-4">
                    <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-start">
                        <AlertCircle className="h-4 w-4 text-slate-400" />
                        <h3 className="text-sm font-bold text-slate-800">{t('assignmentDetails')}</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="campusId"
                            render={({ field }) => (
                                <FormItem className="text-start">
                                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('campusLabel')}</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value} name={field.name}>
                                    <FormControl>
                                    <SelectTrigger className="h-12 bg-slate-50/50 border-slate-200">
                                        <SelectValue placeholder={t('selectCampus')} />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    {campuses?.map((campus) => (
                                        <SelectItem key={campus.id} value={campus.id}>{campus.name}</SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="schoolId"
                            render={({ field }) => (
                                <FormItem className="text-start">
                                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('schoolLabel')}</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} name={field.name} disabled={!selectedCampusId}>
                                    <FormControl>
                                    <SelectTrigger className="h-12 bg-slate-50/50 border-slate-200">
                                        <SelectValue placeholder={!selectedCampusId ? "Select campus first" : t('selectSchool')} />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    {availableSchools?.map((school) => (
                                        <SelectItem key={school.id} value={school.id}>{school.name}</SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                            control={form.control}
                            name="divisionId"
                            render={({ field }) => (
                                <FormItem className="text-start">
                                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('divisionLabel')}</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value} name={field.name}>
                                    <FormControl>
                                    <SelectTrigger className="h-12 bg-slate-50/50 border-slate-200">
                                        <SelectValue placeholder={t('selectDivision')} />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    {divisions?.map((division) => (
                                        <SelectItem key={division.id} value={division.id}>{division.name}</SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="departmentId"
                            render={({ field }) => (
                                <FormItem className="text-start">
                                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('categoryLabel')}</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value} name={field.name}>
                                    <FormControl>
                                    <SelectTrigger className="h-12 bg-slate-50/50 border-slate-200">
                                        <SelectValue placeholder={t('selectCategory')} />
                                    </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                    {departments?.map((dept) => (
                                        <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                                    ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="gradeId"
                        render={({ field }) => (
                            <FormItem className="md:w-1/2 text-start">
                            <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('gradeLabel')}</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value} name={field.name} disabled={!selectedSchoolId}>
                                <FormControl>
                                <SelectTrigger className="h-12 bg-slate-50/50 border-slate-200">
                                    <SelectValue placeholder={!selectedSchoolId ? "Select school first" : t('selectGrade')} />
                                </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                {availableGrades?.map((grade) => (
                                    <SelectItem key={grade.id} value={grade.id}>{grade.name}</SelectItem>
                                ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="space-y-6 pt-4 border-t border-slate-50">
                        <FormField
                            control={form.control}
                            name="title"
                            render={({ field }) => (
                                <FormItem className="text-start">
                                    <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                        <Type className="h-3 w-3" /> {t('titleLabel')}
                                    </FormLabel>
                                    <FormControl>
                                        <div className="relative">
                                            <Input
                                                placeholder={t('titlePlaceholder')}
                                                className="h-12 bg-slate-50/50 border-slate-200 focus:ring-[#1e3a8a] text-start pr-12 font-bold"
                                                {...field}
                                            />
                                            <span className={cn(
                                                "absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase",
                                                field.value.length > 90 ? "text-red-500" : "text-slate-300"
                                            )}>
                                                {field.value.length}/100
                                            </span>
                                        </div>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem className="text-start">
                                <FormLabel className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('notesLabel')}</FormLabel>
                                <FormControl>
                                    <Textarea
                                        placeholder={t('notesPlaceholder')}
                                        className="min-h-[150px] bg-slate-50/50 border-slate-200 focus:ring-[#1e3a8a] text-start"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="space-y-3 pt-2 text-start">
                        <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('attachmentsLabel')}</Label>
                        <div className={cn(
                            "relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl transition-all min-h-[160px]",
                            "border-slate-200 hover:border-slate-300 bg-slate-50/30"
                        )}>
                            <Input 
                                id="attachment-input"
                                type="file" 
                                multiple
                                accept=".pdf,.png,.jpg,.jpeg"
                                onChange={handleFileChange}
                                className="absolute inset-0 h-full w-full opacity-0 cursor-pointer z-10"
                                disabled={isPending}
                            />
                            
                            <div className="flex flex-col items-center gap-3 text-center pointer-events-none">
                                <div className="p-4 bg-white rounded-2xl shadow-sm border border-slate-100 text-slate-400">
                                    <Paperclip className="h-6 w-6" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-bold text-slate-600">{t('clickToUpload')}</p>
                                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{t('fileTypesNote')}</p>
                                </div>
                            </div>
                        </div>

                        {selectedFiles.length > 0 && (
                            <div className="grid gap-3 mt-4 animate-in fade-in duration-300">
                                {selectedFiles.map((file, idx) => (
                                    <div key={idx} className="flex items-center gap-4 bg-white p-3 rounded-xl shadow-sm border border-blue-100">
                                        <div className="p-2 bg-[#1e3a8a] rounded-lg text-white">
                                            {file.type === 'application/pdf' ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                                        </div>
                                        <div className="text-left flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-900 truncate">{file.name}</p>
                                            <p className="text-[10px] font-medium text-slate-500 uppercase">{(file.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                        <Button 
                                            type="button" 
                                            variant="ghost" 
                                            size="icon" 
                                            disabled={isPending}
                                            onClick={() => removeFile(idx)}
                                            className="h-8 w-8 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="pt-4">
                    <Button 
                        type="submit" 
                        disabled={isPending} 
                        className="w-full h-14 bg-[#1e3a8a] hover:bg-[#1e3a8a]/90 text-lg font-bold shadow-lg transition-all"
                    >
                        {isPending ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                {t('submitting')}
                            </div>
                        ) : t('submitTicket')}
                    </Button>
                    {isPending && (
                        <p className="text-center text-[10px] text-slate-400 font-bold uppercase mt-3 tracking-widest animate-pulse">
                            {t('uploadWaitNote')}
                        </p>
                    )}
                </div>
            </form>
            </Form>
        </CardContent>
    </Card>
  );
}
