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
  const categoryLabel = (value: string) => documentCategories.find((category) => category.value === value)?.label ?? value;
  return <main>
    <h1>Documents</h1>
    {message && <p role="status">{message}</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {!data && !loadError && <p>Loading documents...</p>}
    {data && <>
      <p>Proposal status: {data.proposal.status}</p>
      {selected ? document ? <section className="section section-partner">
        <button type="button" disabled={busy} onClick={() => { setSelected(null); setEditing(false); setAddingVersion(false); }}>Back to documents</button>
        <h2>{document.title}</h2>
        {editing && document.can_edit ? <form key={document.id} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save("PATCH", event.currentTarget, document.id); }}>
          {fields(document)}<button disabled={busy}>Save changes</button>{" "}<button type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form> : <>
          <p>Category: {categoryLabel(document.category)}</p><p>Description: {document.description || "None"}</p>
          <p>Owner: {document.owner_name}</p><p>Added by: {document.added_by_name}</p>
          <p>Last modified: {new Date(document.updated_at).toLocaleString()}</p>
          <h3>Versions</h3>
          <ul>{document.versions.map((version) => <li key={version.id}>Version {version.version_number}{version.id === document.versions[0]?.id ? " (current)" : ""} — {version.review_status === "not_submitted" ? "Not submitted" : version.review_status} — added by {version.added_by_name} on {new Date(version.created_at).toLocaleString()}{" "}{version.external_url ? <a href={version.external_url} target="_blank" rel="noopener noreferrer">Open link</a> : version.source_kind === "uploaded_file" && <><span>{version.file_name}</span>{" "}<button type="button" disabled={busy} onClick={() => download(document.id, version.id, version.file_name ?? "document")}>Download</button></>}{version.version_note && <p>Note: {version.version_note}</p>}</li>)}</ul>
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
          {document.can_edit && !addingVersion && <p><button type="button" disabled={busy} onClick={() => { setAddingVersion(true); setVersionSource(document.versions[0]?.source_kind === "external_link" ? "link" : "file"); setMessage(""); }}>Add new version</button></p>}
          {document.can_edit && <><button type="button" disabled={busy} onClick={() => { setEditing(true); setAddingVersion(false); }}>Edit information</button>{" "}<button type="button" disabled={busy} onClick={() => { if (window.confirm(`Mark ${document.title} as removed? Its versions will be kept.`)) void save("DELETE", undefined, document.id); }}>Remove document</button></>}
        </>}
      </section> : <><p>Document is no longer available.</p><button type="button" onClick={() => { setSelected(null); setEditing(false); setAddingVersion(false); }}>Back to documents</button></> : <>
        <h2>Active documents</h2>
        {data.documents.length === 0 ? <p>No documents yet.</p> : <table><thead><tr><th>Title</th><th>Category</th><th>Owner</th><th>Version</th><th>Review state</th><th>Last modified</th><th>Actions</th></tr></thead><tbody>{data.documents.map((item) => <tr key={item.id}>
          <td>{item.title}</td><td>{categoryLabel(item.category)}</td><td>{item.owner_name}</td><td>{item.versions[0]?.version_number ?? "—"}</td><td>{item.versions[0]?.review_status === "not_submitted" ? "Not submitted" : item.versions[0]?.review_status ?? "—"}</td><td>{new Date(item.updated_at).toLocaleString()}</td><td><button type="button" onClick={() => { setSelected(item.id); setAddingVersion(false); setMessage(""); }}>Details</button>{" "}{item.versions[0]?.external_url ? <a href={item.versions[0].external_url} target="_blank" rel="noopener noreferrer">Open link</a> : item.versions[0]?.source_kind === "uploaded_file" && <button type="button" disabled={busy} onClick={() => download(item.id, item.versions[0].id, item.versions[0].file_name ?? "document")}>Download</button>}</td>
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
