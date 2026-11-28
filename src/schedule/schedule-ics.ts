// compute next calendar day in utc so clock changes do not shift date-only values
function nextDay(date: string) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export type IcsEventItem = {
  id: string;
  title: string;
  partner_name: string;
  organizer_name?: string;
  event_type?: string;
  event_date?: string;
  all_day?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  notes?: string | null;
  status?: string;
};

export type IcsWorkstreamItem = {
  id: string;
  title: string;
  partner_name: string;
  start_date?: string;
  end_date?: string;
  progress?: string;
  description?: string | null;
  status?: string;
};

export type IcsMilestoneItem = {
  id: string;
  title: string;
  partner_name: string;
  due_date?: string;
  progress?: string;
  description?: string | null;
  status?: string;
};

export type IcsTaskItem = {
  id: string;
  title: string;
  partner_name: string;
  assignee_name?: string | null;
  due_date?: string | null;
  progress?: string;
  status?: string;
};

export type ScheduleIcsInput = {
  events: IcsEventItem[];
  workstreams: IcsWorkstreamItem[];
  milestones: IcsMilestoneItem[];
  tasks: IcsTaskItem[];
};

function formatUtc(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function formatDate(date: string) {
  return date.replace(/-/g, "");
}

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// fold lines to 75 utf-8 octets per rfc 5545 without splitting multi-byte characters
function foldLine(line: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const chunks: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit && current) {
      chunks.push(current);
      current = " " + char;
      bytes = 1 + size;
      limit = 75;
    } else {
      current += char;
      bytes += size;
    }
  }
  if (current) chunks.push(current);
  return chunks.join("\r\n");
}

function description(parts: (string | null | undefined)[]) {
  const text = parts.map(part => part?.trim()).filter(Boolean).join("\n");
  return text ? ["DESCRIPTION:" + escapeText(text)] : [];
}

function eventLines(uid: string, stamp: string, summary: string, timing: string[], details: (string | null | undefined)[]) {
  return [
    "BEGIN:VEVENT",
    "UID:" + uid + "@fundsyc",
    "DTSTAMP:" + stamp,
    ...timing,
    "SUMMARY:" + escapeText(summary),
    ...description(details),
    "END:VEVENT",
  ];
}

export function buildScheduleIcs(input: ScheduleIcsInput, now = new Date()) {
  const stamp = formatUtc(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FundSyc//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const event of input.events) {
    if (event.status === "removed" || !event.event_date) continue;
    const timed = !event.all_day && event.starts_at;
    const timing = timed
      ? [
          "DTSTART:" + formatUtc(new Date(event.starts_at!)),
          ...(event.ends_at ? ["DTEND:" + formatUtc(new Date(event.ends_at))] : []),
        ]
      : [
          "DTSTART;VALUE=DATE:" + formatDate(event.event_date),
          "DTEND;VALUE=DATE:" + formatDate(nextDay(event.event_date)),
        ];
    lines.push(...eventLines("event-" + event.id, stamp, event.title, timing, [
      event.event_type ? "Type: " + event.event_type : null,
      "Partner: " + event.partner_name,
      event.organizer_name ? "Organizer: " + event.organizer_name : null,
      event.notes,
    ]));
  }

  for (const workstream of input.workstreams) {
    if (workstream.status === "removed" || !workstream.start_date || !workstream.end_date) continue;
    const timing = [
      "DTSTART;VALUE=DATE:" + formatDate(workstream.start_date),
      "DTEND;VALUE=DATE:" + formatDate(nextDay(workstream.end_date)),
    ];
    lines.push(...eventLines("workstream-" + workstream.id, stamp, "Workstream: " + workstream.title, timing, [
      "Lead partner: " + workstream.partner_name,
      workstream.progress ? "Progress: " + workstream.progress : null,
      workstream.description,
    ]));
  }

  for (const milestone of input.milestones) {
    if (milestone.status === "removed" || !milestone.due_date) continue;
    const timing = [
      "DTSTART;VALUE=DATE:" + formatDate(milestone.due_date),
      "DTEND;VALUE=DATE:" + formatDate(nextDay(milestone.due_date)),
    ];
    lines.push(...eventLines("milestone-" + milestone.id, stamp, "Milestone: " + milestone.title, timing, [
      "Lead partner: " + milestone.partner_name,
      milestone.progress ? "Progress: " + milestone.progress : null,
      milestone.description,
    ]));
  }

  for (const task of input.tasks) {
    if (task.status === "removed" || !task.due_date) continue;
    const timing = [
      "DTSTART;VALUE=DATE:" + formatDate(task.due_date),
      "DTEND;VALUE=DATE:" + formatDate(nextDay(task.due_date)),
    ];
    lines.push(...eventLines("task-" + task.id, stamp, "Task due: " + task.title, timing, [
      "Partner: " + task.partner_name,
      task.assignee_name ? "Assignee: " + task.assignee_name : null,
      task.progress ? "Progress: " + task.progress : null,
    ]));
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
