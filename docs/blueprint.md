# **App Name**: TechAssist

## Core Features:

- Email-to-Ticket Conversion: Automatically converts incoming emails into tickets, parsing sender, subject, body, and attachments, leveraging Gmail API.
- Ticket Assignment: Assigns tickets to appropriate department (IT, HR, Finance, etc.) based on email content or subject, using AI to detect keywords to enhance assignment accuracy, acting as an AI tool.
- Ticket Management Dashboard: Displays, filters, and manages tickets by status (Open, In Progress, Resolved, Closed), with role-based access control (Admin/Employee).
- Email Reply Synchronization: Synchronizes replies between the ticket system and email, updating ticket conversations based on incoming email replies and sending email notifications upon admin actions.
- User Authentication and Roles: Implements authentication with roles (Employee, Admin). Employees can only view their tickets. Admins can only view tickets related to their department.
- Ticket Analytics Dashboard: Provides a dashboard displaying ticket analytics by department and status, offering insights into ticket resolution efficiency and workload distribution.
- Notification System: Sends email and in-app notifications for new tickets, updates, and resolutions to keep users informed.

## Style Guidelines:

- Primary color: HSL 210, 60%, 50% - A vibrant blue (#3399FF) for trust and reliability.
- Background color: HSL 210, 20%, 98% - A very light blue (#F0F8FF) to provide a clean, uncluttered backdrop.
- Accent color: HSL 240, 50%, 60% - A complementary violet (#735CDD) used to highlight key actions.
- Headline font: 'Space Grotesk', sans-serif, for a modern, tech-focused feel.
- Body font: 'Inter', sans-serif, for clear and readable content.
- Simple, outline-style icons representing different departments and ticket statuses.
- Clean, organized layout with clear separation of ticket lists, details, and analytics.
- Subtle transitions and animations for status updates and loading states to enhance user experience.