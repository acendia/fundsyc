export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type Contact = {
  id: string;
  full_name: string;
  email: string;
  job_title: string | null;
  phone: string | null;
};

export type Member = {
  id: string;
  display_name: string;
  email: string;
  access_role: string;
};

export type Partner = {
  id: string;
  status: string;
  legal_name: string;
  city: string | null;
  country_code: string;
  full_name: string | null;
  email: string | null;
  responsibilities: string[];
  contacts: Contact[];
  primary_contact_id: string | null;
  can_manage_contacts: boolean;
  can_withdraw: boolean;
  members: Member[];
};

export type Responsibility = {
  id: string;
  title: string;
  description: string | null;
  partner_ids: string[];
};

export type Proposal = {
  id: string;
  created_at: string;
  title: string;
  acronym: string | null;
  status: string;
  coordinator_partner_id: string;
  partners: Partner[];
  pending_invitations: { id: string; partner_id: string; kind: string; granted_role: string; legal_name: string; recipient_email: string; expires_at: string }[];
  responsibilities: Responsibility[];
  can_manage_responsibilities: boolean;
};


export type DocumentRecord = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  owner_user_id: string;
  owner_name: string;
  added_by_name: string;
  updated_at: string;
  can_edit: boolean;
  versions: DocumentVersionRecord[];
};

export type DocumentList = {
  categories: { id: string; value: string; label: string; document_count: number }[];
  can_manage_categories: boolean;
  reviewers: { user_id: string; display_name: string }[];
  proposal: { title: string; status: string };
  current_user_id: string;
  can_add: boolean;
  owners: { user_id: string; display_name: string }[];
  documents: DocumentRecord[];
};

export type DocumentReviewRecord = {
  id: string;
  reviewer_user_id: string;
  reviewer_name: string;
  requested_by_name: string;
  created_at: string;
  resolved_at: string | null;
  status: string;
  due_date: string | null;
  instructions: string | null;
  response: string | null;
  can_respond: boolean;
  can_cancel: boolean;
};
export type DocumentVersionRecord = {
  id: string;
  version_number: number;
  source_kind: string;
  file_name: string | null;
  size_bytes: number | null;
  external_url: string | null;
  created_at: string;
  added_by_name: string;
  version_note: string | null;
  review_status: string;
  reviews: DocumentReviewRecord[];
};

export type TaskRecord = {
  workstream_id: string | null;
  workstream_title: string | null;
  workstream_status: string | null;
  id: string;
  title: string;
  description: string | null;
  partner_id: string;
  partner_name: string;
  assignee_user_id: string | null;
  assignee_name: string | null;
  assignees: { user_id: string; display_name: string; assigned_at: string; assigned_by_user_id: string }[];
  progress: string;
  priority: string;
  assigned_at: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  // exact database time text, send it back as expectedVersion when saving
  version: string;
  created_by_name: string;
  updated_by_name: string;
  comment_count: number;
  can_edit: boolean;
  can_assign: boolean;
  can_remove: boolean;
};
export type TaskPartner = {
  id: string;
  legal_name: string;
  can_create: boolean;
  members: { user_id: string; display_name: string }[];
};
export type TaskList = {
  workstreams: { id: string; title: string }[];
  proposal: { id: string; status: string };
  current_user_id: string;
  can_add: boolean;
  can_assign_new: boolean;
  partners: TaskPartner[];
  tasks: TaskRecord[];
};

export type TaskCommentRecord = {
  id: string;
  author_name: string;
  body: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
  can_edit: boolean;
  can_remove: boolean;
};
export type TaskActivityRecord = {
  can_comment: boolean;
  comments: TaskCommentRecord[];
  // newest page only, older pages load on request
  history: TaskHistoryEvent[];
  has_more_history: boolean;
  history_total: number;
};
export type TaskHistoryEvent = { id: string; action: string; actor_name: string; created_at: string; metadata: Record<string, unknown> };
export type TaskHistoryPage = { history: TaskHistoryEvent[]; has_more_history: boolean };

export type DiscussionLinkKind = "task" | "event" | "workstream" | "milestone";
export type DiscussionLinkable = { id: string; title: string };
export type DiscussionReplyRecord = {
  id: string;
  discussion_id: string;
  partner_name: string;
  created_by_user_id: string;
  created_by_name: string;
  body: string;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_remove: boolean;
};
export type DiscussionRecord = {
  id: string;
  partner_id: string;
  partner_name: string;
  title: string;
  body: string;
  created_by_user_id: string;
  created_by_name: string;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
  // linked_kind stays set when the item is removed, linked_item is null then
  linked_kind: DiscussionLinkKind | null;
  linked_id: string | null;
  linked_item: { kind: DiscussionLinkKind; id: string; title: string } | null;
  reply_count: number;
  replies: DiscussionReplyRecord[];
  can_edit: boolean;
  can_remove: boolean;
  can_reply: boolean;
};
export type DiscussionList = {
  current_user_id: string;
  can_create: boolean;
  linkable: { tasks: DiscussionLinkable[]; events: DiscussionLinkable[]; workstreams: DiscussionLinkable[]; milestones: DiscussionLinkable[] };
  discussions: DiscussionRecord[];
};

export type MessagePerson = { user_id: string; display_name: string; partner_name: string; access_role: string };
export type ConversationSummary = {
  id: string;
  kind: "direct" | "group";
  // group name, or the other person's name for direct chats
  title: string | null;
  created_by_user_id: string;
  created_at: string;
  last_activity_at: string;
};
export type ConversationList = {
  current_user_id: string;
  can_start: boolean;
  people: MessagePerson[];
  conversations: ConversationSummary[];
};
export type ConversationMember = { user_id: string; display_name: string; partner_name: string | null; joined_at: string; is_creator: boolean };
export type ConversationMessage = {
  id: string;
  conversation_id: string;
  author_user_id: string;
  author_name: string;
  // null once the message is removed
  body: string | null;
  status: "active" | "removed";
  created_at: string;
  removed_at: string | null;
  is_own: boolean;
  can_remove: boolean;
};
export type ConversationDetail = {
  current_user_id: string;
  conversation: { id: string; kind: "direct" | "group"; title: string | null; created_by_user_id: string; status: string };
  members: ConversationMember[];
  addable: MessagePerson[];
  messages: ConversationMessage[];
  has_more: boolean;
  can_send: boolean;
  can_manage: boolean;
  can_leave: boolean;
};

export type RequirementTask = { id: string; title: string; progress: string; status: "active" | "removed" };
export type RequirementRecord = {
  id: string;
  code: string;
  requirement_number: number;
  title: string;
  description: string | null;
  category: string;
  owner_user_id: string | null;
  owner_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  due_date: string | null;
  priority: string;
  version: string;
  created_by_name: string;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
  completed: boolean;
  progress: "not_started" | "in_progress" | "in_review" | "completed";
  mode: "manual" | "tasks";
  task_total: number;
  task_completed: number;
  tasks: RequirementTask[];
  unfinished_tasks: { id: string; title: string; progress: string }[];
  removed_tasks: { id: string; title: string }[];
  attention: ("overdue" | "linked_task_removed" | "responsible_inactive")[];
  can_edit: boolean;
  can_remove: boolean;
  can_complete: boolean;
};
export type RequirementList = {
  proposal: { id: string; status: string };
  current_user_id: string;
  can_manage: boolean;
  owners: { user_id: string; display_name: string; partner_name: string }[];
  partners: { id: string; legal_name: string }[];
  linkable_tasks: { id: string; title: string; progress: string }[];
  summary: { total: number; completed: number; in_progress: number; in_review: number; needs_attention: number };
  requirements: RequirementRecord[];
};

export type OverviewPageName = "consortium" | "documents" | "tasks" | "schedule" | "discussions" | "messages" | "requirements";
export type OverviewTarget = { page: OverviewPageName; id?: string; scheduleKind?: "events" | "milestones" | "workstreams" };
export type OverviewItem = {
  kind: "tasks" | "requirements" | "documents" | "milestones" | "workstreams";
  id: string;
  title: string;
  partner: string | null;
  owner: string | null;
  due_date: string | null;
  reason: string;
  overdue: boolean;
};
export type OverviewData = {
  proposal: { id: string; title: string; acronym: string | null; status: string; coordinator_name: string };
  role: string;
  today: string;
  through: string;
  time_zone: string;
  generated_at: string;
  editable: boolean;
  summary: {
    tasks: { total: number; todo: number; completed: number; in_progress: number; in_review: number };
    requirements: RequirementList["summary"];
    documents: { total: number; pending_versions: number };
    consortium: { partners: number; members: number };
    upcoming: number;
  };
  attention: OverviewItem[];
  mine: OverviewItem[];
  upcoming: import("./schedule/schedule-calendar").CalendarEntry[];
  timeline: { id: string; title: string; partner_name: string; start_date: string; end_date: string; progress: string }[];
  discussions: { id: string; title: string; last_activity_at: string; reply_count: number }[];
  messaging_available: boolean;
  conversations: { id: string; kind: "direct" | "group"; title: string | null; last_activity_at: string }[];
};
