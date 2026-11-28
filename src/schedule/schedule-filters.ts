export type ScheduleFilters = {
  title: string;
  type: string;
  partner: string;
  organizer: string;
  progress: string;
};

export const emptyScheduleFilters: ScheduleFilters = {
  title: "", type: "", partner: "", organizer: "", progress: "",
};

type FilterItem = {
  title: string;
  status?: string;
  partner_id?: string;
  lead_partner_id?: string;
  organizer_user_id?: string;
  event_type?: string;
  progress?: string;
  due_date?: string | null;
};

export function matchesScheduleFilters(item: FilterItem, kind: "events" | "workstreams" | "milestones" | "tasks", filters: ScheduleFilters) {
  if (item.status === "removed" || (kind === "tasks" && !item.due_date)) return false;
  if (!item.title.toLowerCase().includes(filters.title.trim().toLowerCase())) return false;
  if (filters.type && filters.type !== kind && !(kind === "events" && filters.type === item.event_type)) return false;
  if (filters.partner && (item.partner_id ?? item.lead_partner_id) !== filters.partner) return false;
  if (filters.organizer && (kind !== "events" || item.organizer_user_id !== filters.organizer)) return false;
  if (filters.progress) {
    const group = kind === "tasks" ? "task" : "timeline";
    if (kind === "events" || filters.progress !== group + ":" + item.progress) return false;
  }
  return true;
}
