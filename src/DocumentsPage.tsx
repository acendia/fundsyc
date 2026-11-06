import { useEffect, useState, type FormEvent } from "react";
import { documentCategories } from "./models";
import type { ApiFetch, DocumentList, DocumentRecord } from "./api-types";

type Props = { proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void };

export function DocumentsPage({ proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost }: Props) {
  const [data, setData] = useState<DocumentList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState("link");
  const [addingVersion, setAddingVersion] = useState(false);
  const [versionSource, setVersionSource] = useState("file");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [myReviews, setMyReviews] = useState(false);
  const [reviewVersion, setReviewVersion] = useState<string | null>(null);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  const path = `/api/proposals/${proposalId}/documents`;
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(path, { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status === 403) onAccessLost();
        setData(null);
        throw new Error(result.error || "Could not load documents.");
      }
      setData(result);
      setLoadError("");
    }).catch((error) => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [path, revision, refreshKey, apiFetch, onAccessLost]);
  async function save(method: string, form?: HTMLFormElement, id?: string) {
    setBusy(true); setMessage("");
    try {
      const values = form ? new FormData(form) : undefined;
      const uploading = method === "POST" && source === "file";
      const file = values?.get("file");
      if (uploading && (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)) throw new Error("Choose a file up to 10 MB.");
      const response = await apiFetch(`${path}${uploading ? "/upload" : id ? `/${id}` : ""}`, { method, headers: uploading ? undefined : { "Content-Type": "application/json" }, body: uploading ? values : values ? JSON.stringify(Object.fromEntries(values)) : undefined });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("The upload API did not respond correctly. Restart the local app and try again.");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save document.");
      if (!id) { form?.reset(); setSource("link"); }
      if (method === "DELETE") setSelected(null);
      setEditing(false); setMessage(method === "DELETE" ? "Document marked as removed." : "Document saved.");
      setRevision((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save document."); }
    finally { setBusy(false); }
  }
  async function saveVersion(event: FormEvent<HTMLFormElement>, documentId: string) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setMessage("");
    try {
      const file = values.get("file");
      if (versionSource === "file" && (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)) throw new Error("Choose a file up to 10 MB.");
      const response = await apiFetch(`${path}/${documentId}/versions/${versionSource === "file" ? "upload" : "link"}`, { method: "POST", headers: versionSource === "file" ? undefined : { "Content-Type": "application/json" }, body: versionSource === "file" ? values : JSON.stringify(Object.fromEntries(values)) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Restart the local app to load the version actions.");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not add version.");
      setAddingVersion(false); setMessage(`Version ${result.versionNumber} saved. Previous versions are preserved.`); setRevision((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add version."); }
    finally { setBusy(false); }
  }
  async function changeReview(documentId: string, versionId: string, body: object, reviewId?: string) {
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(`${path}/${documentId}/versions/${versionId}/reviews${reviewId ? `/${reviewId}` : ""}`, { method: reviewId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save review.");
      setReviewVersion(null); setMessage("Review saved."); setRevision((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save review."); }
    finally { setBusy(false); }
  }
  async function download(documentId: string, versionId: string, fileName: string) {
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(`${path}/${documentId}/versions/${versionId}/download`);
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Could not download file."); }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a"); link.href = url; link.download = fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not download file."); }
    finally { setBusy(false); }
  }
  function fields(document?: DocumentRecord) {
    const owners = data?.owners ?? [];
    return <>
      <p><label>Title <input name="title" defaultValue={document?.title ?? ""} required /></label></p>
      <p><label>Description <textarea name="description" defaultValue={document?.description ?? ""} /></label></p>
      <p><label>Category <select name="category" defaultValue={document?.category ?? documentCategories[0].value}>{documentCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label></p>
      <p><label>Owner <select name="ownerUserId" defaultValue={document?.owner_user_id ?? data?.current_user_id} required>
        {document && !owners.some((owner) => owner.user_id === document.owner_user_id) && <option value="" >Choose an active owner</option>}
        {owners.map((owner) => <option key={owner.user_id} value={owner.user_id}>{owner.display_name}</option>)}
      </select></label></p>
    </>;
  }
  const document = data?.documents.find((item) => item.id === selected);
  const reviewLabels: Record<string, string> = { not_submitted: "Not submitted", in_review: "In review", approved: "Approved", changes_requested: "Changes requested", pending: "Pending", cancelled: "Cancelled" };
  const filteredDocuments = data?.documents.filter((item) => item.title.toLowerCase().includes(search.trim().toLowerCase()) && (!categoryFilter || item.category === categoryFilter) && (!ownerFilter || item.owner_user_id === ownerFilter) && (!reviewFilter || (item.versions[0]?.review_status ?? "not_submitted") === reviewFilter) && (!myReviews || item.versions.some((version) => version.reviews.some((review) => review.reviewer_user_id === data.current_user_id && review.status === "pending")))) ?? [];
  const categoryLabel = (value: string) => documentCategories.find((category) => category.value === value)?.label ?? value;
  return <main>
    <h1>Documents</h1>
    {message && <p role="status">{message}</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {!data && !loadError && <p>Loading documents...</p>}
    {data && <>
      <p>Proposal status: {data.proposal.status}</p>
      <p>Viewers can open and download. Contributors manage their own documents; partner admins manage their organization’s documents; the coordinator manages all proposal documents.</p>
      {selected ? document ? <section className="section section-partner">
        <button type="button" disabled={busy} onClick={() => { setSelected(null); setEditing(false); setAddingVersion(false); setReviewVersion(null); }}>Back to documents</button>
        <h2>{document.title}</h2>
        {editing && document.can_edit ? <form key={document.id} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save("PATCH", event.currentTarget, document.id); }}>
          {fields(document)}<button disabled={busy}>Save changes</button>{" "}<button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form> : <>
          <p>Category: {categoryLabel(document.category)}</p><p>Description: {document.description || "None"}</p>
          <p>Owner: {document.owner_name}</p><p>Added by: {document.added_by_name}</p>
          <p>Last modified: {new Date(document.updated_at).toLocaleString()}</p>
          <h3>Versions</h3>
          <ul>{document.versions.map((version) => <li key={version.id}>
            <p><strong>Version {version.version_number}{version.id === document.versions[0]?.id ? " (current)" : ""}</strong> — {reviewLabels[version.review_status] ?? version.review_status} — added by {version.added_by_name} on {new Date(version.created_at).toLocaleString()}</p>
            {version.external_url ? <a href={version.external_url} target="_blank" rel="noopener noreferrer">Open link</a> : version.source_kind === "uploaded_file" && <><span>{version.file_name}</span>{" "}<button type="button" disabled={busy} onClick={() => download(document.id, version.id, version.file_name ?? "document")}>Download</button></>}
            {version.version_note && <p>Note: {version.version_note}</p>}
            {version.reviews.map((review) => <section key={review.id}>
              <p>Review: {reviewLabels[review.status] ?? review.status} — {review.reviewer_name}; requested by {review.requested_by_name}{review.due_date ? `; due ${review.due_date}` : ""}</p>
              <p>Requested: {new Date(review.created_at).toLocaleString()}{review.resolved_at ? `; resolved: ${new Date(review.resolved_at).toLocaleString()}` : ""}</p>
              {review.instructions && <p>Instructions: {review.instructions}</p>}{review.response && <p>Response: {review.response}</p>}
              {review.can_respond && <form onSubmit={(event) => { event.preventDefault(); const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; void changeReview(document.id, version.id, { status: submitter?.value || "approved", response: new FormData(event.currentTarget).get("response") }, review.id); }}>
                <p><label>Review response <textarea name="response" /></label></p><button value="approved" disabled={busy}>Approve</button>{" "}<button value="changes_requested" disabled={busy}>Request changes</button>
              </form>}
              {review.can_cancel && <button type="button" disabled={busy} onClick={() => changeReview(document.id, version.id, {status:"cancelled"}, review.id)}>Cancel review</button>}
            </section>)}
            {document.can_edit && !version.reviews.some((review) => review.status === "pending") && <p><button type="button" disabled={busy || data.reviewers.length === 0} onClick={() => { setReviewVersion(version.id); setAddingVersion(false); }}>Request review for version {version.version_number}</button></p>}
          </li>)}</ul>
          {reviewVersion && document.can_edit && <form key={reviewVersion} onSubmit={(event) => { event.preventDefault(); void changeReview(document.id, reviewVersion, Object.fromEntries(new FormData(event.currentTarget))); }}>
            <h3>Request review — version {document.versions.find((version) => version.id === reviewVersion)?.version_number}</h3>
            <p><label>Reviewer <select name="reviewerUserId" required>{data.reviewers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label></p>
            <p><label>Due date <input name="dueDate" type="date" /></label></p><p><label>Instructions <textarea name="instructions" /></label></p>
            <button disabled={busy}>Request review</button>{" "}<button type="button" disabled={busy} onClick={() => setReviewVersion(null)}>Cancel</button>
          </form>}
          {document.can_edit && data.reviewers.length === 0 && <p>A review needs another active contributor or administrator in this proposal.</p>}

          <p>External links use the sharing permissions of the original service. Changes inside Google Docs are not tracked here; upload a file snapshot when a fixed copy is needed.</p>
          {addingVersion && document.can_edit && <form onSubmit={(event) => saveVersion(event, document.id)}>
            <h3>Add version {(document.versions[0]?.version_number ?? 0) + 1}</h3>
            <p>Earlier versions will be kept. The new version starts as Not submitted.</p>
            <p><label>Version source <select value={versionSource} onChange={(event) => setVersionSource(event.target.value)}><option value="file">Upload file</option><option value="link">External link</option></select></label></p>
            {versionSource === "file" ? <p><label>Replacement file <input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" required /></label> (up to 10 MB)</p> : <p><label>New URL <input name="url" type="url" defaultValue={document.versions[0]?.external_url ?? ""} required /></label></p>}
            <p><label>Version note <textarea name="versionNote" /></label></p>
            <button disabled={busy}>{busy ? "Saving..." : "Save new version"}</button>{" "}<button type="button" disabled={busy} onClick={() => setAddingVersion(false)}>Cancel</button>
            {message && <p role="status">{message}</p>}
          </form>}
          {document.can_edit && !addingVersion && <p><button type="button" disabled={busy} onClick={() => { setReviewVersion(null); setAddingVersion(true); setVersionSource(document.versions[0]?.source_kind === "external_link" ? "link" : "file"); setMessage(""); }}>Add new version</button></p>}
          {document.can_edit && <><button type="button" disabled={busy} onClick={() => { setEditing(true); setAddingVersion(false); setReviewVersion(null); }}>Edit information</button>{" "}<button type="button" disabled={busy} onClick={() => { if (window.confirm(`Mark ${document.title} as removed? Its versions will be kept.`)) void save("DELETE", undefined, document.id); }}>Remove document</button></>}
        </>}
      </section> : <><p>Document is no longer available.</p><button type="button" onClick={() => { setSelected(null); setEditing(false); setAddingVersion(false); setReviewVersion(null); }}>Back to documents</button></> : <>
        <h2>Active documents</h2>
        <section aria-label="Document filters">
          <p><label>Search title <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label></p>
          <p><label>Category filter <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{documentCategories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>{" "}
          <label>Owner filter <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="">All owners</option>{Array.from(new Map(data.documents.map((item) => [item.owner_user_id,item.owner_name])).entries()).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>{" "}
          <label>Current version review state <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}><option value="">All review states</option>{["not_submitted","in_review","approved","changes_requested"].map((state) => <option key={state} value={state}>{reviewLabels[state]}</option>)}</select></label></p>
          <p><label><input type="checkbox" checked={myReviews} onChange={(event) => setMyReviews(event.target.checked)} /> Reviews assigned to me</label></p>
          <button type="button" onClick={() => { setSearch(""); setCategoryFilter(""); setOwnerFilter(""); setReviewFilter(""); setMyReviews(false); }}>Clear filters</button>
        </section>
        {filteredDocuments.length === 0 ? <p>{data.documents.length === 0 ? "No documents yet." : "No documents match these filters."}</p> : <table><thead><tr><th>Title</th><th>Category</th><th>Owner</th><th>Version</th><th>Review state</th><th>Last modified</th><th>Actions</th></tr></thead><tbody>{filteredDocuments.map((item) => <tr key={item.id}>
          <td>{item.title}</td><td>{categoryLabel(item.category)}</td><td>{item.owner_name}</td><td>{item.versions[0]?.version_number ?? "—"}</td><td>{reviewLabels[item.versions[0]?.review_status] ?? "—"}</td><td>{new Date(item.updated_at).toLocaleString()}</td><td><button type="button" onClick={() => { setSelected(item.id); setAddingVersion(false); setMessage(""); }}>Details</button>{" "}{item.versions[0]?.external_url ? <a href={item.versions[0].external_url} target="_blank" rel="noopener noreferrer">Open link</a> : item.versions[0]?.source_kind === "uploaded_file" && <button type="button" disabled={busy} onClick={() => download(item.id, item.versions[0].id, item.versions[0].file_name ?? "document")}>Download</button>}</td>
        </tr>)}</tbody></table>}
        {data.can_add ? <section className="section section-create"><h2>Add a document</h2><form onSubmit={(event) => { event.preventDefault(); void save("POST", event.currentTarget); }}>
          <p><label>Source <select value={source} onChange={(event) => setSource(event.target.value)}><option value="link">External link</option><option value="file">Upload file</option></select></label></p>
          {fields()}
          {source === "file" ? <p><label>File <input name="file" type="file" accept=".doc,.docx,.xls,.xlsx,.pdf" required /></label> (up to 10 MB)</p> : <p><label>Link <input name="url" type="url" placeholder="https://" required /></label></p>}
          <button disabled={busy}>{busy ? "Saving..." : "Add document"}</button>
          {message && <p role="status">{message}</p>}
        </form></section> : <p>You can view documents. Adding and editing requires an editable proposal and an appropriate role.</p>}
      </>}
    </>}
  </main>;
}
