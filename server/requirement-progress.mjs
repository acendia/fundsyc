// the one place that decides if a requirement is done, rows, details and counts all use it
// linkedTasks are the active links of the requirement with the task title, progress and status
export function deriveRequirement(requirement, linkedTasks, today) {
  const active = linkedTasks.filter(task => task.status === "active");
  const removed = linkedTasks.filter(task => task.status !== "active");
  const unfinished = active.filter(task => task.progress !== "completed");
  const linked = linkedTasks.length > 0;
  let completed, progress;
  if (!linked) {
    completed = Boolean(requirement.manual_completed);
    progress = completed ? "completed" : "not_started";
  } else {
    // a removed task never counts as done, so it blocks completion until it is unlinked
    completed = removed.length === 0 && unfinished.length === 0;
    if (completed) progress = "completed";
    else if (active.length === 0 || active.every(task => task.progress === "todo")) progress = "not_started";
    else if (unfinished.length > 0 && unfinished.every(task => task.progress === "in_review")) progress = "in_review";
    else progress = "in_progress";
  }
  const attention = [];
  if (!completed && requirement.due_date && requirement.due_date < today) attention.push("overdue");
  if (removed.length) attention.push("linked_task_removed");
  if (requirement.responsible_active === false) attention.push("responsible_inactive");
  return {
    completed, progress, attention,
    mode: linked ? "tasks" : "manual",
    task_total: active.length,
    task_completed: active.length - unfinished.length,
    unfinished_tasks: unfinished.map(({ id, title, progress }) => ({ id, title, progress })),
    removed_tasks: removed.map(({ id, title }) => ({ id, title })),
  };
}

export function summarize(items) {
  return {
    total: items.length,
    completed: items.filter(item => item.progress === "completed").length,
    in_progress: items.filter(item => item.progress === "in_progress").length,
    in_review: items.filter(item => item.progress === "in_review").length,
    needs_attention: items.filter(item => item.attention.length > 0).length,
  };
}
