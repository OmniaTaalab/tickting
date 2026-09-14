
import type { Timestamp } from 'firebase/firestore';

export type DayConfig = {
  isOpen: boolean;
  start: string; // "08:00"
  end: string;   // "16:00"
};

export type WorkingHours = Record<string, DayConfig>;

export type AfterHoursEmailSettings = {
    subject: string;
    body: string;
    enabled: boolean;
};

export type Department = {
  id: string;
  name: string;
  responsibleUserId?: string;
  lastAssignedUserIndex?: number;
  workingHours?: WorkingHours;
  afterHoursEmail?: AfterHoursEmailSettings;
};

export type Division = {
  id: string;
  name: string;
  color?: string;
};

export type Grade = {
  id: string;
  name: string;
};

export type CampusSchoolConfig = {
  schoolId: string;
  gradeIds: string[];
};

export type Campus = {
  id: string;
  name: string;
  schoolConfigs?: CampusSchoolConfig[];
  // Legacy fields preserved for safety during migration
  schoolId?: string;
  gradeId?: string;
};

export type School = {
  id: string;
  name: string;
};

export type TicketStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed' | 'Queue' | 'Waiting' | 'Duplicate';

export type TicketPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

export type TicketChannel = 'Email' | 'Phone' | 'Walk-in' | 'Social Media' | 'Web' | 'Form';

export type UserRole = 'Admin' | 'Employee' | 'Manager';

export type UserStatus = 'Available' | 'Busy';

export type UserProfile = {
  id: string;
  authId?: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: UserRole;
  departmentId?: string;
  divisionIds?: string[];
  schoolId?: string;
  schoolIds?: string[];
  gradeIds?: string[];
  campusIds?: string[]; // Changed from schoolIds to campusIds
  status?: UserStatus;
  currentSessionStartedAt?: Timestamp | string;
  lastStatusChangedAt?: Timestamp | string;
  activeSessionId?: string;
};

export type TicketMessage = {
  id: string;
  author: {
    name: string;
    avatarUrl: string;
    userId: string;
  };
  text: string;
  createdAt: Timestamp | string;
  isInternal?: boolean;
  attachments?: string[];
};

export type Attachment = {
  url: string;
  name: string;
  contentType: string;
};

export type Ticket = {
  id: string;
  ticketNumber: number;
  title: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  channel: TicketChannel;
  departmentId: string;
  departmentName: string;
  divisionId?: string;
  divisionName?: string;
  campusId?: string;
  campusName?: string;
  schoolId?: string;
  schoolName?: string;
  gradeId?: string;
  gradeName?: string;
  parentName?: string;
  parentEmail?: string;
  studentBlbId?: string;
  reopenedCount?: number;
  lastReopenedAt?: Timestamp | string;
  createdBy: {
    userId: string;
    name: string;
    email: string;
    avatarUrl: string;
  };
  assignedTo?: {
    userId: string;
    name: string;
    email?: string;
    avatarUrl: string;
  };
  assignedAt?: Timestamp | string;
  attachments?: Attachment[];
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
  resolvedAt?: Timestamp | string;
  closedAt?: Timestamp | string;
  firstRespondedAt?: Timestamp | string;
  messages: TicketMessage[];
  tags?: string[];
};

export type SystemLog = {
    id: string;
    eventType: string;
    actor: {
        userId: string;
        name: string;
    };
    message: string;
    details?: Record<string, any>;
    timestamp: Timestamp;
}

export type TicketEvent = {
  id: string;
  ticketId: string;
  eventType: 'TICKET_CREATED' | 'TICKET_REPLY' | 'TICKET_STATUS_CHANGED' | 'TICKET_TRANSFER_REQUESTED' | 'TICKET_REASSIGN_REQUESTED';
  title: string;
  message: string;
  recipient: string;
  timestamp: Timestamp;
  read: boolean;
  status?: 'pending' | 'approved' | 'rejected';
  requestId?: string;
  requestMetadata?: {
    requesterName?: string;
    fromDepartmentId?: string;
    fromDepartmentName?: string;
    toDepartmentId?: string;
    toDepartmentName?: string;
    fromUserId?: string;
    fromUserName?: string;
    toUserId?: string;
    toUserName?: string;
  };
  processedBy?: string;
};

export type WorkSession = {
  id: string;
  userId: string;
  userName: string;
  departmentId?: string;
  startedAt: Timestamp | string;
  endedAt?: Timestamp | string;
  durationInMinutes?: number;
  dateKey: string;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
};

export type SLAPolicy = Record<TicketPriority, number>;

export type SLASettings = Record<TicketChannel, SLAPolicy>;

export const DEFAULT_AFTER_HOURS_EMAIL: AfterHoursEmailSettings = {
    subject: "Ticket #{{ticketId}} Registered - Outside Working Hours",
    body: "Hello {{userName}},\n\nYour ticket regarding '{{subject}}' has been registered successfully. Please note that it was submitted outside our working hours for the {{departmentName}} category.\n\nWe will review and respond to you as soon as our team is back online during our working hours: {{workingHours}}.\n\nThank you for your patience.",
    enabled: true
};

export const DEFAULT_SLA_SETTINGS: SLASettings = {
    Email: { Low: 48, Normal: 24, High: 8, Urgent: 4 },
    Phone: { Low: 24, Normal: 8, High: 4, Urgent: 2 },
    'Walk-in': { Low: 24, Normal: 8, High: 4, Urgent: 2 },
    'Social Media': { Low: 24, Normal: 12, High: 6, Urgent: 3 },
    Web: { Low: 24, Normal: 12, High: 6, Urgent: 3 },
    Form: { Low: 24, Normal: 12, High: 6, Urgent: 3 },
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  Monday: { isOpen: true, start: "08:00", end: "16:00" },
  Tuesday: { isOpen: true, start: "08:00", end: "16:00" },
  Wednesday: { isOpen: true, start: "08:00", end: "16:00" },
  Thursday: { isOpen: true, start: "08:00", end: "16:00" },
  Friday: { isOpen: false, start: "08:00", end: "16:00" },
  Saturday: { isOpen: false, start: "08:00", end: "16:00" },
  Sunday: { isOpen: true, start: "08:00", end: "16:00" },
};
