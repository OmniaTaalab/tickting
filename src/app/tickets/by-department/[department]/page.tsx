'use client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TicketList } from '@/components/tickets/ticket-list';
import { useParams } from 'next/navigation';
import { Department, DepartmentID, SLASettings, Ticket, DEFAULT_SLA_SETTINGS } from '@/lib/types';
import { useCollection, useDoc, useFirebase, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function DepartmentTicketsPage() {
  const params = useParams();
  const departmentId = params.department as DepartmentID;
  const departmentName = capitalize(departmentId || '');
  const { firestore } = useFirebase();

  const ticketsQuery = useMemoFirebase(
    () => (firestore && departmentId ? query(collection(firestore, 'tickets'), where('departmentId', '==', departmentId)) : null),
    [firestore, departmentId]
  );
  const { data: tickets, isLoading } = useCollection<Ticket>(ticketsQuery);

  const deptsQuery = useMemoFirebase(() => (firestore ? query(collection(firestore, 'departments')) : null), [firestore]);
  const { data: departments } = useCollection<Department>(deptsQuery);

  const slaRef = useMemoFirebase(() => (firestore ? doc(firestore, 'settings', 'sla') : null), [firestore]);
  const { data: slaSettings } = useDoc<SLASettings>(slaRef);

  return (
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle>{departmentName} Tickets</CardTitle>
        <CardDescription>
          View and manage all tickets assigned to the {departmentName} department.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TicketList 
          data={tickets || []}
          isLoading={isLoading}
          departments={departments || []}
          slaSettings={slaSettings || DEFAULT_SLA_SETTINGS}
        />
      </CardContent>
    </Card>
  );
}
