import { useEffect, useState, type FormEvent } from "react";
import type { ApiFetch, DocumentList, DocumentRecord, DocumentVersionRecord } from "./api-types";
import "./DocumentsPage.css";
import { Modal } from "./Modal";

type Props = { initialDocumentId?: string; proposalId: string; refreshKey: number; apiFetch: ApiFetch; onBusyChange: (busy: boolean) => void; onAccessLost: () => void };

const reviewLabels: Record<string, string> = { not_submitted: "Not submitted", in_review: "In review", approved: "Approved", changes_requested: "Changes requested", pending: "Pending", cancelled: "Cancelled" };
const categoryTones: Record<string, string> = { proposal_drafts: "blue", budget_finance: "green", legal_documents: "red", supporting_evidence: "amber" };
const modifiedDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function DocumentIcon({ name }: { name: "folder" | "search" | "filter" | "link" }) {
  const paths = { folder: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", search: "M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z", filter: "M3 5h18l-7 8v5l-4 2v-7Z", link: "M10 13l4-4m-6 2-3 3a4 4 0 0 0 6 6l3-3m-4-10 3-3a4 4 0 0 1 6 6l-3 3" };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function FileMark({ version }: { version?: DocumentVersionRecord }) {
  const extension = version?.file_name?.split(".").pop()?.toLowerCase();
  if (version?.external_url) return <span className="documents-file-mark" data-tone="amber" title="External link"><DocumentIcon name="link" /></span>;
  const label = extension === "pdf" ? "PDF" : extension === "xls" || extension === "xlsx" ? "XLS" : extension === "doc" || extension === "docx" ? "DOC" : "FILE";
  return <span className="documents-file-mark" data-tone={label === "PDF" ? "red" : label === "XLS" ? "green" : label === "DOC" ? "blue" : undefined}>{label}</span>;
}

function fileSize(bytes: number) {
  const [value, unit] = bytes >= 1e6 ? [bytes / 1e6, "MB"] : bytes >= 1e3 ? [bytes / 1e3, "KB"] : [bytes, "B"];
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

function ReviewBadge({ status }: { status: string }) {
  return <span className="documents-review-badge" data-status={status}>{reviewLabels[status] ?? status}</span>;
}

export function DocumentsPage({ initialDocumentId, proposalId, refreshKey, apiFetch, onBusyChange, onAccessLost }: Props) {
  const [data, setData] = useState<DocumentList | null>(null);
  const [selected, setSelected] = useState<string | null>(initialDocumentId ?? null);
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
  const [showFilters, setShowFilters] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [rowActions, setRowActions] = useState<string | null>(null);
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
      setCategoryFilter(value => result.categories.some((category: { value: string }) => category.value === value) ? value : "");
      setLoadError("");
    }).catch((error) => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [path, revision, refreshKey, apiFetch, onAccessLost]);
  async function changeCategory(event?: FormEvent<HTMLFormElement>, categoryId?: string) {
    event?.preventDefault();
    const form = event?.currentTarget;
    const label = form ? String(new FormData(form).get("label") ?? "") : undefined;
    setBusy(true); setMessage("");
    try {
      const response = await apiFetch(path + "/categories" + (categoryId ? "/" + categoryId : ""), {
        method: categoryId ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: categoryId ? undefined : JSON.stringify({ label }),
      });
      const result = await response.json();
      if (!response.ok) {
        if ([403, 404, 409].includes(response.status)) setRevision(value => value + 1);
        throw new Error(result.error || "Could not save category.");
      }
      form?.reset();
      setMessage(categoryId ? "Category removed. Removed documents and their versions are preserved." : "Category added.");
      setRevision(value => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save category."); }
    finally { setBusy(false); }
  }
  const categories = data?.categories ?? [];
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
      if (!id) { form?.reset(); setSource("link"); setShowAdd(false); }
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
      <p><label>Category <select name="category" required defaultValue={document?.category ?? categories[0]?.value ?? ""}>
        {categories.length === 0 && <option value="">No categories available</option>}
        {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
      </select></label></p>
      <p><label>Owner <select name="ownerUserId" defaultValue={document?.owner_user_id ?? data?.current_user_id} required>
        {document && !owners.some((owner) => owner.user_id === document.owner_user_id) && <option value="" >Choose an active owner</option>}
        {owners.map((owner) => <option key={owner.user_id} value={owner.user_id}>{owner.display_name}</option>)}
      </select></label></p>
    </>;
  }
  const document = data?.documents.find((item) => item.id === selected);
  const query = search.trim().toLowerCase();
  const filteredDocuments = data?.documents.filter((item) => (!query || item.title.toLowerCase().includes(query) || item.versions[0]?.file_name?.toLowerCase().includes(query)) && (!categoryFilter || item.category === categoryFilter) && (!ownerFilter || item.owner_user_id === ownerFilter) && (!reviewFilter || (item.versions[0]?.review_status ?? "not_submitted") === reviewFilter) && (!myReviews || item.versions.some((version) => version.reviews.some((review) => review.reviewer_user_id === data.current_user_id && review.status === "pending")))) ?? [];
  const categoryLabel = (value: string) => categories.find((category) => category.value === value)?.label ?? value;
  const totalBytes = filteredDocuments.reduce((total, item) => total + (Number(item.versions[0]?.size_bytes) || 0), 0);
  const filterCount = [categoryFilter, ownerFilter, reviewFilter, myReviews].filter(Boolean).length;
  function clearFilters() { setSearch(""); setCategoryFilter(""); setOwnerFilter(""); setReviewFilter(""); setMyReviews(false); setRowActions(null); }
  function openDocument(id: string) { setSelected(id); setRowActions(null); setAddingVersion(false); setMessage(""); }
  function backToDocuments() { setSelected(null); setEditing(false); setAddingVersion(false); setReviewVersion(null); }
  return <main className="proposal-overview documents-page">
    <header className="overview-heading overview-heading-row documents-heading">
      <div>
        {selected && <button type="button" className="overview-link" disabled={busy} onClick={backToDocuments}>← Back to documents</button>}
        <h1>{document?.title ?? "Documents"}</h1>
        <p>{document ? `${categoryLabel(document.category)} · ${data?.proposal.title}` : "One place for proposal files and supporting evidence."}</p>
      </div>
      {!selected && data && (data.can_manage_categories || data.can_add) && <div className="documents-heading-actions">
        {data.can_manage_categories && <button type="button" className="documents-button" aria-haspopup="dialog" disabled={busy} onClick={() => { setMessage(""); setShowCategories(true); setShowAdd(false); }}>Manage categories</button>}
        {data.can_add && <button type="button" className="documents-primary" aria-haspopup="dialog" disabled={busy} onClick={() => { setMessage(""); setShowAdd(true); setShowCategories(false); }}><span aria-hidden="true">+</span> Add document</button>}
      </div>}
    </header>
    {message && !showAdd && !showCategories && <p className="documents-feedback" role="status">{message}</p>}
    {loadError && <p className="documents-feedback" role="alert">{loadError}</p>}
    {!data && !loadError && <p role="status">Loading documents…</p>}
    {data && <>
       {selected ? document ? <section className="overview-panel documents-detail">
         {editing && document.can_edit ? <form className="documents-form" key={document.id} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save("PATCH", event.currentTarget, document.id); }}>
           <h2>Edit document information</h2>
          {fields(document)}<div className="documents-form-actions"><button className="documents-primary" disabled={busy}>Save changes</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </form> : <>
           <dl className="documents-metadata">
             <div><dt>Owner</dt><dd>{document.owner_name}</dd></div><div><dt>Added by</dt><dd>{document.added_by_name}</dd></div>
             <div><dt>Last modified</dt><dd><time dateTime={document.updated_at}>{modifiedDate.format(new Date(document.updated_at))}</time></dd></div>
             <div><dt>Description</dt><dd>{document.description || "No description"}</dd></div>
           </dl>
           <h2>Version history</h2>
           <ul className="documents-versions">{document.versions.map((version) => <li key={version.id}>
             <div className="documents-version-heading"><strong>Version {version.version_number}{version.id === document.versions[0]?.id ? " · Current" : ""}</strong> <ReviewBadge status={version.review_status} /></div>
             <p className="documents-muted">Added by {version.added_by_name} on {modifiedDate.format(new Date(version.created_at))}</p>
            {version.external_url ? <a href={version.external_url} target="_blank" rel="noopener noreferrer">Open link</a> : version.source_kind === "uploaded_file" && <><span>{version.file_name}</span>{" "}<button type="button" disabled={busy} onClick={() => download(document.id, version.id, version.file_name ?? "document")}>Download</button></>}
            {version.version_note && <p>Note: {version.version_note}</p>}
             {version.reviews.map((review) => <section className="documents-review" key={review.id}>
               <div className="documents-version-heading"><strong>Review by {review.reviewer_name}</strong> <ReviewBadge status={review.status} /></div>
               <p>Requested by {review.requested_by_name}{review.due_date ? ` · Due ${review.due_date}` : ""}</p>
              <p>Requested: {new Date(review.created_at).toLocaleString()}{review.resolved_at ? `; resolved: ${new Date(review.resolved_at).toLocaleString()}` : ""}</p>
              {review.instructions && <p>Instructions: {review.instructions}</p>}{review.response && <p>Response: {review.response}</p>}
              {review.can_respond && <form onSubmit={(event) => { event.preventDefault(); const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; void changeReview(document.id, version.id, { status: submitter?.value || "approved", response: new FormData(event.currentTarget).get("response") }, review.id); }}>
                <p><label>Review response <textarea name="response" /></label></p><button value="approved" disabled={busy}>Approve</button>{" "}<button value="changes_requested" disabled={busy}>Request changes</button>
              </form>}
              {review.can_cancel && <button type="button" disabled={busy} onClick={() => changeReview(document.id, version.id, {status:"cancelled"}, review.id)}>Cancel review</button>}
            </section>)}
            {document.can_edit && !version.reviews.some((review) => review.status === "pending") && <p><button type="button" disabled={busy || data.reviewers.length === 0} onClick={() => { setReviewVersion(version.id); setAddingVersion(false); }}>Request review for version {version.version_number}</button></p>}
          </li>)}</ul>
           {reviewVersion && document.can_edit && <form className="documents-form documents-subform" key={reviewVersion} onSubmit={(event) => { event.preventDefault(); void changeReview(document.id, reviewVersion, Object.fromEntries(new FormData(event.currentTarget))); }}>
            <h3>Request review — version {document.versions.find((version) => version.id === reviewVersion)?.version_number}</h3>
            <p><label>Reviewer <select name="reviewerUserId" required>{data.reviewers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label></p>
            <p><label>Due date <input name="dueDate" type="date" /></label></p><p className="documents-wide"><label>Instructions <textarea name="instructions" /></label></p>
            <div className="documents-form-actions"><button className="documents-primary" disabled={busy}>Request review</button><button type="button" disabled={busy} onClick={() => setReviewVersion(null)}>Cancel</button></div>
          </form>}
          {document.can_edit && data.reviewers.length === 0 && <p>A review needs another active contributor or administrator in this proposal.</p>}

          <p>External links use the sharing permissions of the original service. Changes inside Google Docs are not tracked here; upload a file snapshot when a fixed copy is needed.</p>
           {addingVersion && document.can_edit && <form className="documents-form documents-subform" onSubmit={(event) => saveVersion(event, document.id)}>
            <h3>Add version {(document.versions[0]?.version_number ?? 0) + 1}</h3>
            <p className="documents-wide documents-muted">Earlier versions will be kept. The new version starts as Not submitted.</p>
            <p><label>Version source <select value={versionSource} onChange={(event) => setVersionSource(event.target.value)}><option value="file">Upload file</option><option value="link">External link</option></select></label></p>
            {versionSource === "file" ? <p><label>Replacement file <input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx" required /></label> (up to 10 MB)</p> : <p><label>New URL <input name="url" type="url" defaultValue={document.versions[0]?.external_url ?? ""} required /></label></p>}
            <p className="documents-wide"><label>Version note <textarea name="versionNote" /></label></p>
            <div className="documents-form-actions"><button className="documents-primary" disabled={busy}>{busy ? "Saving..." : "Save new version"}</button><button type="button" disabled={busy} onClick={() => setAddingVersion(false)}>Cancel</button></div>
            {message && <p className="documents-wide" role="status">{message}</p>}
          </form>}
          {document.can_edit && !addingVersion && <p><button type="button" disabled={busy} onClick={() => { setReviewVersion(null); setAddingVersion(true); setVersionSource(document.versions[0]?.source_kind === "external_link" ? "link" : "file"); setMessage(""); }}>Add new version</button></p>}
          {document.can_edit && <><button type="button" disabled={busy} onClick={() => { setEditing(true); setAddingVersion(false); setReviewVersion(null); }}>Edit information</button>{" "}<button type="button" disabled={busy} onClick={() => { if (window.confirm(`Mark ${document.title} as removed? Its versions will be kept.`)) void save("DELETE", undefined, document.id); }}>Remove document</button></>}
        </>}
       </section> : <p>Document is no longer available.</p> : <>
          <div className="documents-folders" role="group" aria-label="Document categories">
            {categories.map(category => <button key={category.id} type="button" className="documents-folder" data-tone={categoryTones[category.value]} aria-pressed={categoryFilter === category.value} onClick={() => { setCategoryFilter(categoryFilter === category.value ? "" : category.value); setRowActions(null); }}>
              <span className="documents-folder-mark"><DocumentIcon name="folder" /></span>
              <span><strong>{category.label}</strong><small>{category.document_count} {category.document_count === 1 ? "document" : "documents"}</small></span>
            </button>)}
          </div>
          {data.can_manage_categories && <Modal open={showCategories} onClose={() => { setShowCategories(false); setMessage(""); }} labelledBy="documents-categories-heading" busy={busy}>
           <section id="documents-manage-categories" className="documents-editor">
            <h2 id="documents-categories-heading">Manage document categories</h2>
            {message && <p className="documents-feedback" role="status">{message}</p>}
           <p>Categories apply to this proposal. Remove the active documents in a category yourself before removing it. No documents are removed automatically.</p>
            <ul className="documents-category-list">{categories.map(category => <li key={category.id}>
              <div><strong>{category.label}</strong><small>{category.document_count} active document{category.document_count === 1 ? "" : "s"}</small></div>
             <button type="button" disabled={busy} onClick={() => {
               if (category.document_count) { setMessage(`This category contains ${category.document_count} active document${category.document_count === 1 ? "" : "s"}. Remove these documents yourself before removing the category. No documents have been removed.`); return; }
               if (window.confirm(`Remove the category "${category.label}"?`)) void changeCategory(undefined, category.id);
             }}>Remove category</button>
           </li>)}</ul>
            <form onSubmit={event => void changeCategory(event)}><fieldset className="documents-form" disabled={busy}>
             <p><label>New category <input name="label" required maxLength={80} /></label></p>
              <div className="documents-form-actions"><button className="documents-primary">Add category</button></div>
           </fieldset></form>
          </section>
          </Modal>}
          {data.can_add && <Modal open={showAdd} onClose={() => { setShowAdd(false); setMessage(""); }} labelledBy="documents-add-heading" busy={busy}>
          <section id="documents-add" className="documents-editor"><h2 id="documents-add-heading">Add a document</h2>
          {message && <p className="documents-feedback" role="status">{message}</p>}
          <form className="documents-form" onSubmit={(event) => { event.preventDefault(); void save("POST", event.currentTarget); }}>
          {categories.length === 0 && <p className="documents-wide">The proposal coordinator must add a category before you can add documents.</p>}
          <p><label>Source <select value={source} onChange={(event) => setSource(event.target.value)}><option value="link">External link</option><option value="file">Upload file</option></select></label></p>
          {fields()}
          {source === "file" ? <p><label>File <input name="file" type="file" accept=".doc,.docx,.xls,.xlsx,.pdf" required /></label> (up to 10 MB)</p> : <p><label>Link <input name="url" type="url" placeholder="https://" required /></label></p>}
           <div className="documents-form-actions"><button className="documents-primary" disabled={busy || categories.length === 0}>{busy ? "Saving…" : "Add document"}</button><button type="button" disabled={busy} onClick={() => { setShowAdd(false); setMessage(""); }}>Cancel</button></div>
         </form></section>
          </Modal>}
         <section className="documents-library" aria-labelledby="documents-library-heading">
           <div className="documents-library-heading">
             <div><h2 id="documents-library-heading">{categoryFilter ? categoryLabel(categoryFilter) : "All documents"}</h2>
               <p role="status">{filteredDocuments.length}{filteredDocuments.length !== data.documents.length ? ` of ${data.documents.length}` : ""} {filteredDocuments.length === 1 && data.documents.length === 1 ? "document" : "documents"}{totalBytes > 0 && <> · <span title="Total size of current uploaded versions">{fileSize(totalBytes)} uploaded</span></>}</p>
             </div>
             <div className="documents-heading-actions">
               <div className="documents-search"><DocumentIcon name="search" /><input type="search" aria-label="Search files by title or filename" placeholder="Search files" value={search} onChange={(event) => { setSearch(event.target.value); setRowActions(null); }} /></div>
               <button type="button" className="documents-button" aria-expanded={showFilters} aria-controls="documents-filters" onClick={() => setShowFilters(!showFilters)}><DocumentIcon name="filter" /> Filter{filterCount > 0 && <span className="documents-tag">{filterCount}</span>}</button>
             </div>
           </div>
           <div id="documents-filters" className="documents-filters" hidden={!showFilters}>
             <label>Category <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setRowActions(null); }}><option value="">All categories</option>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
             <label>Owner <select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setRowActions(null); }}><option value="">All owners</option>{Array.from(new Map(data.documents.map((item) => [item.owner_user_id,item.owner_name])).entries()).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
             <label>Review status <select value={reviewFilter} onChange={(event) => { setReviewFilter(event.target.value); setRowActions(null); }}><option value="">All review states</option>{["not_submitted","in_review","approved","changes_requested"].map((state) => <option key={state} value={state}>{reviewLabels[state]}</option>)}</select></label>
             <label className="documents-check"><input type="checkbox" checked={myReviews} onChange={(event) => { setMyReviews(event.target.checked); setRowActions(null); }} /> Reviews assigned to me</label>
             <button type="button" className="overview-link" onClick={clearFilters}>Clear filters</button>
           </div>
           {filteredDocuments.length === 0 ? <div className="documents-empty">
             <p>{data.documents.length === 0 ? "No documents yet." : "No documents match these filters."}</p>
             {data.documents.length !== 0 && <button type="button" className="overview-link" onClick={clearFilters}>Clear filters</button>}
           </div> : <div className="documents-table-scroll" tabIndex={0} role="region" aria-label="Document table">
             <table><thead><tr>{["Name", "Category", "Owner", "Version", "Review status", "Last modified", "Actions"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{filteredDocuments.map((item) => {
               const version = item.versions[0];
               const expanded = rowActions === item.id;
               const initials = item.owner_name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
               return <tr key={item.id}>
                 <th scope="row"><div className="documents-name"><FileMark version={version} /><button type="button" className="documents-title-link" onClick={() => openDocument(item.id)}>{item.title}</button></div></th>
                 <td><span className="documents-tag">{categoryLabel(item.category)}</span></td>
                 <td><div className="documents-owner"><span aria-hidden="true">{initials}</span>{item.owner_name}</div></td>
                 <td>{version ? `v${version.version_number}` : "—"}</td>
                 <td>{version ? <ReviewBadge status={version.review_status} /> : "—"}</td>
                 <td><time dateTime={item.updated_at}>{modifiedDate.format(new Date(item.updated_at))}</time></td>
                 <td className="documents-row-actions">
                   <button type="button" className="documents-ellipsis" aria-label={`Actions for ${item.title}`} aria-expanded={expanded} aria-controls={`document-actions-${item.id}`} onClick={() => setRowActions(expanded ? null : item.id)}>⋯</button>
                   <div id={`document-actions-${item.id}`} hidden={!expanded}>
                     <button type="button" className="overview-link" onClick={() => openDocument(item.id)}>Details</button>
                     {version?.external_url ? <a href={version.external_url} target="_blank" rel="noopener noreferrer">Open link</a> : version?.source_kind === "uploaded_file" && <button type="button" className="overview-link" disabled={busy} onClick={() => download(item.id, version.id, version.file_name ?? "document")}>Download</button>}
                   </div>
                 </td>
               </tr>;
             })}</tbody></table>
           </div>}
         </section>
         {!data.can_add && <p className="documents-muted">You can view documents. Adding and editing requires an editable proposal and an appropriate role.</p>}
      </>}
    </>}
  </main>;
}
