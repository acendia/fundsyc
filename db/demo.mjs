import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "../server/app.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const status = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["supabase", "status", "-o", "env"], { cwd: root, shell: process.platform === "win32", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const setting = name => status.match(new RegExp(`^${name}="([^"]+)"`, "m"))?.[1];
const authUrl = setting("API_URL");
const databaseUrl = setting("DB_URL");
for (const url of [authUrl, databaseUrl]) {
  if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("This scenario requires local Supabase.");
}
const password = "Fundsyc-demo-2026!";
const people = [
  { name: "Eleni Papadopoulou", email: "eleni.demo@example.org", organization: "University of Athens", role: "coordinator_manager" },
  { name: "Nikos Georgiou", email: "nikos.demo@example.org", organization: "University of Athens", role: "contributor" },
  { name: "Maria Antoniou", email: "maria.demo@example.org", organization: "Harokopio University", role: "partner_admin" },
  { name: "Sofia Dimitriou", email: "sofia.demo@example.org", organization: "Harokopio University", role: "contributor" },
  { name: "Daniel Miller", email: "daniel.demo@example.org", organization: "UCLA", role: "partner_admin" },
];
const authOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(authUrl, setting("SERVICE_ROLE_KEY"), authOptions);
const tokens = [];
for (const person of people) {
  const client = createClient(authUrl, setting("ANON_KEY"), authOptions);
  let login = await client.auth.signInWithPassword({ email: person.email, password });
  if (login.error) {
    const created = await admin.auth.admin.createUser({ email: person.email, password, email_confirm: true, user_metadata: { full_name: person.name } });
    if (created.error) throw new Error(`Could not create ${person.email}. If it already exists, its demo password may have changed. ${created.error.message}`);
    login = await client.auth.signInWithPassword({ email: person.email, password });
  }
  if (login.error) throw login.error;
  tokens.push(login.data.session.access_token);
}
const server = createApp(() => databaseUrl, { authUrl, authKey: setting("ANON_KEY"), storageKey: setting("SERVICE_ROLE_KEY") }).listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function api(person, path, method = "GET", body) {
  const multipart = body instanceof FormData;
  const response = await fetch(`${base}/api${path}`, { method, headers: { authorization: `Bearer ${tokens[person]}`, ...(multipart ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${people[person].name}: ${method} ${path}: ${result.error}`);
  return result;
}
const day = offset => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
try {
  const title = "SMARTCAMPUS Sustainable University Campuses";
  const created = await api(0, "/proposals", "POST", { title, acronym: "SMARTCAMPUS", organization: people[0].organization, countryCode: "GR", city: "Athens" });
  const proposalId = created.id;
  const proposalPath = `/proposals/${proposalId}`;
  async function accept(person, kind) {
    const current = (await api(0, "/proposals")).find(item => item.id === proposalId);
    const invitation = current.pending_invitations.find(item => item.recipient_email === people[person].email && item.kind === kind);
    if (!invitation) throw new Error("The scenario invitation was not found.");
    await api(person, `/${kind === "member" ? "member-invitations" : "invitations"}/${invitation.id}/resolve`, "POST", { action: "accept" });
  }
  for (const person of [2, 4]) {
    await api(0, "/invitations", "POST", { proposalId, organization: people[person].organization, email: people[person].email, countryCode: person === 4 ? "US" : "GR", city: person === 4 ? "Los Angeles" : "Athens" });
    await accept(person, "organization");
  }
  const proposal = (await api(0, "/proposals")).find(item => item.id === proposalId);
  const partner = name => proposal.partners.find(item => item.legal_name === name).id;
  for (const [inviter, colleague] of [[0, 1], [2, 3]]) {
    await api(inviter, `${proposalPath}/partners/${partner(people[colleague].organization)}/member-invitations`, "POST", { email: people[colleague].email, role: "contributor" });
    await accept(colleague, "member");
  }
  for (let person = 0; person < people.length; person++) {
    const tasks = await api(person, `${proposalPath}/tasks`);
    people[person].id = tasks.current_user_id;
  }
  for (const [title, organization] of [["Proposal coordination", people[0].organization], ["Energy data and budget", people[2].organization], ["Independent methodology review", people[4].organization]]) {
    await api(0, `${proposalPath}/responsibilities`, "POST", { title });
    const current = (await api(0, "/proposals")).find(item => item.id === proposalId);
    const responsibility = current.responsibilities.find(item => item.title === title);
    await api(0, `${proposalPath}/responsibilities/${responsibility.id}/partners/${partner(organization)}`, "PUT");
  }
  async function upload(person, file, fields, documentId) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("file", new Blob([await readFile(new URL(`./demo-files/${file}`, import.meta.url))], { type: "application/pdf" }), file);
    return api(person, `${proposalPath}/documents${documentId ? `/${documentId}/versions/upload` : "/upload"}`, "POST", form);
  }
  const annex = await upload(1, "technical-annex-v1.pdf", { title: "Technical annex", description: "Pilot methodology and campus energy indicators.", category: "proposal_drafts", ownerUserId: people[1].id });
  const budget = await upload(2, "budget-summary.pdf", { title: "Partner budget summary", description: "Draft costs across the three universities.", category: "budget_finance", ownerUserId: people[2].id });
  const evidence = await upload(3, "campus-evidence.pdf", { title: "Campus energy evidence", description: "Illustrative baseline measurements collected by Sofia.", category: "supporting_evidence", ownerUserId: people[3].id });
  async function requestReview(documentId, versionId) {
    return api(1, `${proposalPath}/documents/${documentId}/versions/${versionId}/reviews`, "POST", { reviewerUserId: people[4].id, dueDate: day(5), instructions: "Check the measurement method and the evidence supporting the indicators." });
  }
  let documents = await api(1, `${proposalPath}/documents`);
  const firstVersion = documents.documents.find(item => item.id === annex.id).versions[0];
  const firstReview = await requestReview(annex.id, firstVersion.id);
  await api(4, `${proposalPath}/documents/${annex.id}/versions/${firstVersion.id}/reviews/${firstReview.id}`, "PATCH", { status: "changes_requested", response: "Add the data collection period and normalization per square metre." });
  await upload(1, "technical-annex-v2.pdf", { versionNote: "Added a 12-month baseline and normalized indicators per square metre." }, annex.id);
  documents = await api(1, `${proposalPath}/documents`);
  const secondVersion = documents.documents.find(item => item.id === annex.id).versions[0];
  const secondReview = await requestReview(annex.id, secondVersion.id);
  await api(4, `${proposalPath}/documents/${annex.id}/versions/${secondVersion.id}/reviews/${secondReview.id}`, "PATCH", { status: "approved", response: "The revised methodology is clear and supported by the baseline evidence." });
  const tasks = [];
  async function task(creator, assignee, title, description, priority, dueOffset, progress = "todo") {
    const record = await api(creator, `${proposalPath}/tasks`, "POST", { title, description, partnerId: partner(people[assignee].organization), assigneeUserId: people[assignee].id, priority, dueDate: day(dueOffset) });
    tasks.push({ id: record.id, title, assignee: people[assignee].name, createdBy: people[creator].name });
    if (progress !== "todo") await api(assignee, `${proposalPath}/tasks/${record.id}`, "PATCH", { progress });
    return record.id;
  }
  const technicalTask = await task(0, 1, "Prepare the technical annex", "Describe the pilot methodology and address Daniel's review comments.", "high", -2, "completed");
  const reviewTask = await task(0, 4, "Review the technical methodology", "Review both annex versions and check the normalization method.", "high", -1, "completed");
  const dataTask = await task(2, 2, "Collect campus energy data", "Collect monthly electricity consumption and building floor area.", "urgent", -1);
  await api(2, `${proposalPath}/tasks/${dataTask}`, "PATCH", { assigneeUserId: people[3].id });
  tasks.find(item => item.id === dataTask).assignee = people[3].name;
  await api(3, `${proposalPath}/tasks/${dataTask}`, "PATCH", { progress: "in_progress" });
  const budgetTask = await task(2, 2, "Validate the partner budgets", "Confirm that staff effort and equipment costs match the pilot activities.", "high", 3, "in_review");
  const submissionTask = await task(0, 0, "Finalize the submission checklist", "Confirm the annex approval, partner budgets and supporting evidence.", "medium", 7);
  const risksTask = await task(4, 4, "Check pilot risks", "Check data availability and suggest mitigation actions.", "medium", 4, "in_review");
  async function comment(person, taskId, body) { return api(person, `${proposalPath}/tasks/${taskId}/comments`, "POST", { body }); }
  await comment(1, technicalTask, "Version 2 includes Daniel's requested changes and is now approved.");
  await comment(4, technicalTask, "I approved document version 2. The task completion records the work status separately.");
  await comment(2, dataTask, "Sofia, please collect the building floor areas as well as the consumption totals.");
  await comment(3, dataTask, "The consumption totals are uploaded as Campus energy evidence. Two floor-area values still need confirmation.");
  const note = await comment(0, budgetTask, "Please check the costs.");
  await api(0, `${proposalPath}/tasks/${budgetTask}/comments/${note.id}`, "PATCH", { body: "Please check the staff costs against the proposed pilot activities before approval." });
  const removed = await comment(2, budgetTask, "Draft calculation note superseded by the budget summary.");
  await api(2, `${proposalPath}/tasks/${budgetTask}/comments/${removed.id}`, "DELETE");
  await comment(4, risksTask, "The main risk is incomplete baseline data. Sofia's current data collection task addresses it.");
  const finalDocuments = await api(0, `${proposalPath}/documents`);
  const finalTasks = await api(0, `${proposalPath}/tasks`);
  if (finalDocuments.documents.length !== 3 || finalTasks.tasks.length !== 6) throw new Error("Unexpected scenario record counts.");
  const summary = { title, proposalId, people, documents: [annex.id, budget.id, evidence.id], tasks, password, createdAt: new Date().toISOString() };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(summary, null, 2));
  console.log(`Scenario ready: ${title}\n5 members, 3 universities, 3 documents, 4 file versions and 6 tasks.\nSign in as eleni.demo@example.org with the local demo password Fundsyc-demo-2026!`);
} finally { await new Promise(resolve => server.close(resolve)); }
