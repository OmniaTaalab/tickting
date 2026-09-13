'use server';

/**
 * @fileOverview This file contains a Genkit flow that uses AI to analyze a support ticket's content and subject
 * and automatically assign it to the most relevant department (IT, HR, Finance, Website, Data).
 *
 * - assignTicketToDepartment - A function that takes ticket information and returns the suggested department.
 * - AssignTicketToDepartmentInput - The input type for the assignTicketToDepartment function.
 * - AssignTicketToDepartmentOutput - The return type for the assignTicketToDepartment function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AssignTicketToDepartmentInputSchema = z.object({
  subject: z.string().describe('The subject of the support ticket.'),
  body: z.string().describe('The content of the support ticket.'),
});
export type AssignTicketToDepartmentInput = z.infer<typeof AssignTicketToDepartmentInputSchema>;

const AssignTicketToDepartmentOutputSchema = z.object({
  department: z
    .enum(['IT', 'HR', 'Finance', 'Website', 'Data'])
    .describe('The suggested department to assign the ticket to.'),
  reason: z.string().describe('The reason for assigning the ticket to the suggested department.'),
});
export type AssignTicketToDepartmentOutput = z.infer<typeof AssignTicketToDepartmentOutputSchema>;

export async function assignTicketToDepartment(
  input: AssignTicketToDepartmentInput
): Promise<AssignTicketToDepartmentOutput> {
  return assignTicketToDepartmentFlow(input);
}

const assignTicketToDepartmentPrompt = ai.definePrompt({
  name: 'assignTicketToDepartmentPrompt',
  input: {schema: AssignTicketToDepartmentInputSchema},
  output: {schema: AssignTicketToDepartmentOutputSchema},
  prompt: `You are an AI assistant specializing in categorizing support tickets to the relevant department. 
Given the subject and body of the ticket, determine which department is most appropriate to handle the ticket.
Possible departments are: IT, HR, Finance, Website, Data.
Explain the reason behind your choice.

Subject: {{{subject}}}
Body: {{{body}}}`,
});

const assignTicketToDepartmentFlow = ai.defineFlow(
  {
    name: 'assignTicketToDepartmentFlow',
    inputSchema: AssignTicketToDepartmentInputSchema,
    outputSchema: AssignTicketToDepartmentOutputSchema,
  },
  async input => {
    const {output} = await assignTicketToDepartmentPrompt(input);
    return output!;
  }
);
