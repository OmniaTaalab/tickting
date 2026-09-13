
'use client';

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useCollection, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { UserProfile } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface DepartmentEmployeesCardProps {
    departmentId: string;
    departmentName: string;
}

export function DepartmentEmployeesCard({ departmentId, departmentName }: DepartmentEmployeesCardProps) {
    const { firestore } = useFirebase();
    const router = useRouter();

    const employeesQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return query(
            collection(firestore, 'users'),
            where('departmentId', '==', departmentId),
            where('role', '==', 'Employee')
        );
    }, [firestore, departmentId]);

    const { data: employees, isLoading } = useCollection<UserProfile>(employeesQuery);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <Skeleton className="h-6 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {[...Array(3)].map((_, i) => (
                             <div key={i} className="flex items-center gap-4">
                                <Skeleton className="h-10 w-10 rounded-full" />
                                <div className='space-y-2'>
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-3 w-40" />
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        )
    }

    if (!employees || employees.length === 0) {
        return null;
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Employees in {departmentName}</CardTitle>
                <CardDescription>
                    All employees managed in this department.
                </CardDescription>
            </CardHeader>
            <CardContent>
                 <Table>
                    <TableBody>
                        {employees.map(employee => {
                            // Default to Available if status is missing
                            const currentStatus = employee.status || 'Available';
                            const isAvailable = currentStatus === 'Available';
                            return (
                                <TableRow key={employee.id} onClick={() => router.push(`/users/${employee.id}`)} className="cursor-pointer">
                                    <TableCell>
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <Avatar>
                                                    <AvatarImage src={employee.avatarUrl} alt={employee.name} />
                                                    <AvatarFallback>{employee.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="font-medium">{employee.name}</p>
                                                    <p className="text-xs text-muted-foreground">{employee.email}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className={cn(
                                                    "h-2 w-2 rounded-full",
                                                    isAvailable ? "bg-green-500" : "bg-red-500"
                                                )} />
                                                <span className="text-[10px] font-medium uppercase text-muted-foreground">
                                                    {currentStatus}
                                                </span>
                                            </div>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    )
}
