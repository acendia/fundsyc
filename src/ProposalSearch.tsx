import { useId, useState, type KeyboardEvent } from "react";
import type { Proposal } from "./api-types";

type Props = { proposals: Proposal[] | null; activeId: string | null; disabled: boolean; onChoose: (id: string) => void };

// search box in the top bar, picking a result makes it the active proposal
export function ProposalSearch({ proposals, activeId, disabled, onChoose }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const term = query.trim().toLowerCase();
  const matches = (proposals ?? []).filter(proposal => !term || [proposal.title, proposal.acronym ?? "", proposal.status].some(value => value.toLowerCase().includes(term)));
  const shown = open && !disabled;
  function choose(proposal: Proposal) {
    setOpen(false); setQuery("");
    if (proposal.id !== activeId) onChoose(proposal.id);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (matches.length) setHighlight(value => (value + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter" && shown && matches[highlight]) {
      event.preventDefault(); choose(matches[highlight]);
    } else if (event.key === "Escape") {
      // stop the search box clearing itself, which would reopen the list
      event.preventDefault(); setOpen(false);
    }
  }
  return <div className="proposal-search">
    <input type="search" role="combobox" aria-label="Search proposals" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={shown && matches[highlight] ? `${listId}-${matches[highlight].id}` : undefined}
      placeholder={proposals?.length === 0 ? "No proposals yet" : "Search proposals"} value={query} disabled={disabled || !proposals?.length}
      onChange={event => { setQuery(event.target.value); setOpen(true); setHighlight(0); }}
      onFocus={() => { setOpen(true); setHighlight(0); }} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 21l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" /></svg>
    <ul id={listId} role="listbox" aria-label="Proposals" hidden={!shown}>
      {matches.length === 0 && <li className="proposal-search-empty">No proposals match “{query}”.</li>}
      {matches.map((proposal, index) => <li key={proposal.id} id={`${listId}-${proposal.id}`} role="option" aria-selected={index === highlight}
        data-current={proposal.id === activeId || undefined}
        // mousedown runs before the input loses focus, so the click is not lost
        onMouseDown={event => { event.preventDefault(); choose(proposal); }} onMouseEnter={() => setHighlight(index)}>
        <strong>{proposal.acronym || proposal.title}</strong>
        <span>{proposal.acronym ? proposal.title : ""}</span>
        <small>{proposal.status.replace(/_/g, " ")}{proposal.id === activeId ? " · current" : ""}</small>
      </li>)}
    </ul>
  </div>;
}
