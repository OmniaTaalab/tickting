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
import { DepartmentID } from '@/lib/types';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function DepartmentTicketsPage() {
  const params = useParams();
  const departmentId = params.department as DepartmentID;
  const departmentName = capitalize(departmentId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{departmentName} Tickets</CardTitle>
        <CardDescription>
          View and manage all tickets assigned to the {departmentName} department.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TicketList departmentId={departmentId} />
      </CardContent>
    </Card>
  );
}
