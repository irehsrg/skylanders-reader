// Community figure-requests + feedback + admin triage UI. Wires the request
// dialog, the public most-wanted list (with voting), and the admin-only panel.
import type { User } from '@supabase/supabase-js';
import { sectionOrder } from './figures/db';
import {
  isAdmin,
  submitRequest,
  listPublicRequests,
  myVotedIds,
  vote,
  unvote,
  listAllRequests,
  updateRequest,
  deleteRequest,
  adminStats,
  type FigureRequest,
  type RequestKind,
  type RequestStatus,
} from './cloud/requests';

const STATUSES: RequestStatus[] = ['pending', 'planned', 'added', 'rejected', 'duplicate'];
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export class RequestsUI {
  private user: User | null = null;
  private admin = false;
  private adminKind: RequestKind = 'figure';
  private dialogKind: RequestKind = 'figure';

  // Dialog refs
  private dialog = $<HTMLDialogElement>('#request-dialog');
  private dTitle = $<HTMLHeadingElement>('#request-title');
  private dSub = $<HTMLParagraphElement>('#request-sub');
  private dName = $<HTMLInputElement>('#request-name');
  private dSection = $<HTMLSelectElement>('#request-section');
  private dNotes = $<HTMLTextAreaElement>('#request-notes');
  private dMessage = $<HTMLParagraphElement>('#request-message');
  private dSigninNote = $<HTMLParagraphElement>('#request-signin-note');
  private dSubmit = $<HTMLButtonElement>('#request-submit');

  // Public list
  private listEl = $<HTMLUListElement>('#requests-list');
  private listEmpty = $<HTMLParagraphElement>('#requests-empty');

  // Admin
  private adminBtn = $<HTMLButtonElement>('#admin-tab-btn');
  private adminStatsEl = $<HTMLDivElement>('#admin-stats');
  private adminListEl = $<HTMLDivElement>('#admin-list');
  private adminEmpty = $<HTMLParagraphElement>('#admin-empty');
  private adminFilter = $<HTMLSelectElement>('#admin-filter');

  /** Called when the user wants to sign in (opens the existing auth dialog). */
  constructor(private requestSignIn: () => void) {
    // Game/set options for the figure-request form.
    for (const s of sectionOrder) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      this.dSection.appendChild(opt);
    }

    $<HTMLButtonElement>('#request-open').addEventListener('click', () => this.open('figure'));
    $<HTMLButtonElement>('#feedback-open').addEventListener('click', () => this.open('feedback'));
    $<HTMLButtonElement>('#request-cancel').addEventListener('click', () => this.dialog.close());
    this.dSubmit.addEventListener('click', () => void this.onSubmit());

    // Admin subtabs / filter / refresh.
    document.querySelectorAll<HTMLButtonElement>('#admin-subtabs .subtab').forEach((b) => {
      b.addEventListener('click', () => {
        document
          .querySelectorAll('#admin-subtabs .subtab')
          .forEach((x) => x.classList.toggle('active', x === b));
        this.adminKind = b.dataset.kind as RequestKind;
        void this.loadAdminList();
      });
    });
    this.adminFilter.addEventListener('change', () => void this.loadAdminList());
    $<HTMLButtonElement>('#admin-refresh').addEventListener('click', () => void this.loadAdmin());
    this.adminBtn.addEventListener('click', () => void this.loadAdmin());
  }

  /** React to auth changes: gate the admin tab, refresh the public list. */
  async setUser(user: User | null): Promise<void> {
    this.user = user;
    this.admin = user ? await isAdmin() : false;
    this.adminBtn.hidden = !this.admin;
    await this.renderPublic();
    if (this.admin) await this.loadAdmin();
  }

  // ---- request dialog ------------------------------------------------------

  private open(kind: RequestKind): void {
    this.dialogKind = kind;
    const figure = kind === 'figure';
    this.dTitle.textContent = figure ? 'Request a missing figure' : 'Report a bug or send feedback';
    this.dSub.textContent = figure
      ? 'Tell us which figure is missing from the catalog and we’ll add it.'
      : 'Found a bug or have an idea? Send it straight to the maintainer.';
    this.dName.placeholder = figure ? 'Figure name (e.g. Dark Spyro)' : 'Subject (e.g. Scan misreads Spyro)';
    this.dNotes.placeholder = figure
      ? 'Variant, edition, or other notes (optional)'
      : 'What happened, and what did you expect? (optional)';
    this.dSection.hidden = !figure;
    this.dName.value = '';
    this.dNotes.value = '';
    this.dSection.value = '';
    this.dMessage.textContent = '';
    this.dMessage.classList.remove('error');

    const signedIn = Boolean(this.user);
    this.dSigninNote.hidden = signedIn;
    this.dSubmit.textContent = signedIn ? 'Submit' : 'Sign in to submit';
    this.dialog.showModal();
  }

  private async onSubmit(): Promise<void> {
    if (!this.user) {
      this.dialog.close();
      this.requestSignIn();
      return;
    }
    this.dMessage.classList.remove('error');
    this.dMessage.textContent = 'Submitting…';
    this.dSubmit.disabled = true;
    try {
      await submitRequest({
        kind: this.dialogKind,
        name: this.dName.value,
        section: this.dSection.value,
        notes: this.dNotes.value,
      });
      this.dialog.close();
      if (this.dialogKind === 'figure') await this.renderPublic();
    } catch (err) {
      this.dMessage.textContent = (err as Error).message;
      this.dMessage.classList.add('error');
    } finally {
      this.dSubmit.disabled = false;
    }
  }

  // ---- public most-wanted list ---------------------------------------------

  private async renderPublic(): Promise<void> {
    let requests: FigureRequest[];
    let voted: Set<string>;
    try {
      [requests, voted] = await Promise.all([listPublicRequests(), myVotedIds()]);
    } catch {
      return; // backend not ready — leave the section quiet
    }
    this.listEmpty.hidden = requests.length > 0;
    this.listEl.replaceChildren(...requests.map((r) => this.publicRow(r, voted.has(r.id))));
  }

  private publicRow(r: FigureRequest, votedByMe: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'request-row';

    const voteBtn = document.createElement('button');
    voteBtn.type = 'button';
    voteBtn.className = votedByMe ? 'vote-btn on' : 'vote-btn';
    voteBtn.innerHTML = `<span class="vote-caret">▲</span><span class="vote-count">${r.vote_count}</span>`;
    voteBtn.title = votedByMe ? 'Remove your vote' : 'Upvote this request';
    voteBtn.addEventListener('click', () => void this.toggleVote(r, votedByMe, voteBtn));

    const body = document.createElement('div');
    body.className = 'request-body';
    const name = document.createElement('div');
    name.className = 'request-name';
    name.textContent = r.name;
    body.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'request-meta';
    if (r.section) meta.append(badge(r.section, 'sec'));
    if (r.status === 'planned') meta.append(badge('Planned', 'planned'));
    if (r.notes) {
      const n = document.createElement('span');
      n.className = 'request-note';
      n.textContent = r.notes;
      meta.appendChild(n);
    }
    if (meta.childNodes.length) body.appendChild(meta);

    li.append(voteBtn, body);
    return li;
  }

  private async toggleVote(r: FigureRequest, votedByMe: boolean, btn: HTMLButtonElement): Promise<void> {
    if (!this.user) {
      this.requestSignIn();
      return;
    }
    btn.disabled = true;
    try {
      if (votedByMe) await unvote(r.id);
      else await vote(r.id);
      await this.renderPublic();
    } catch (err) {
      btn.disabled = false;
      alert((err as Error).message);
    }
  }

  // ---- admin ---------------------------------------------------------------

  private async loadAdmin(): Promise<void> {
    if (!this.admin) return;
    await Promise.all([this.loadAdminStats(), this.loadAdminList()]);
  }

  private async loadAdminStats(): Promise<void> {
    try {
      const s = await adminStats();
      if (!s) return;
      const cards: [string, number | string][] = [
        ['Accounts', s.users],
        ['Collectors', s.collectors],
        ['Figures tracked', s.figures_tracked],
        ['Wishlist items', s.wishlist_rows],
        ['Requests (open)', s.requests_pending],
        ['Requests (total)', s.requests_total],
        ['Feedback (open)', s.feedback_open],
      ];
      this.adminStatsEl.replaceChildren(
        ...cards.map(([label, value]) => {
          const card = document.createElement('div');
          card.className = 'stat-card';
          const v = document.createElement('div');
          v.className = 'stat-value';
          v.textContent = String(value);
          const l = document.createElement('div');
          l.className = 'stat-label';
          l.textContent = label;
          card.append(v, l);
          return card;
        }),
      );
    } catch (err) {
      this.adminStatsEl.textContent = `Couldn’t load stats: ${(err as Error).message}`;
    }
  }

  private async loadAdminList(): Promise<void> {
    if (!this.admin) return;
    let rows: FigureRequest[];
    try {
      rows = await listAllRequests(this.adminKind);
    } catch (err) {
      this.adminListEl.textContent = `Couldn’t load: ${(err as Error).message}`;
      return;
    }
    const filter = this.adminFilter.value;
    if (filter !== 'all') rows = rows.filter((r) => r.status === filter);
    this.adminEmpty.hidden = rows.length > 0;
    this.adminListEl.replaceChildren(...rows.map((r) => this.adminRow(r)));
  }

  private adminRow(r: FigureRequest): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'admin-card';

    const head = document.createElement('div');
    head.className = 'admin-card-head';
    const title = document.createElement('div');
    title.className = 'admin-card-title';
    title.textContent = r.name;
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = new Date(r.created_at).toLocaleDateString();
    head.append(title, when);

    const sub = document.createElement('div');
    sub.className = 'admin-card-sub muted';
    const bits = [
      r.kind === 'figure' ? (r.section || 'no game') : 'feedback',
      `${r.vote_count} vote${r.vote_count === 1 ? '' : 's'}`,
    ];
    sub.textContent = bits.join(' · ');

    card.append(head, sub);

    if (r.notes) {
      const notes = document.createElement('p');
      notes.className = 'admin-card-notes';
      notes.textContent = r.notes;
      card.appendChild(notes);
    }

    const controls = document.createElement('div');
    controls.className = 'admin-card-controls';

    const status = document.createElement('select');
    for (const s of STATUSES) {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s[0].toUpperCase() + s.slice(1);
      if (s === r.status) o.selected = true;
      status.appendChild(o);
    }

    const adminNote = document.createElement('input');
    adminNote.type = 'text';
    adminNote.placeholder = 'Admin note (private)';
    adminNote.value = r.admin_notes;
    adminNote.className = 'admin-note-input';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'sm';
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await updateRequest(r.id, {
          status: status.value as RequestStatus,
          admin_notes: adminNote.value,
        });
        save.textContent = 'Saved';
        setTimeout(() => (save.textContent = 'Save'), 1200);
      } catch (err) {
        alert((err as Error).message);
      } finally {
        save.disabled = false;
      }
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sm ghost danger';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete this ${r.kind}? This can’t be undone.`)) return;
      try {
        await deleteRequest(r.id);
        card.remove();
      } catch (err) {
        alert((err as Error).message);
      }
    });

    controls.append(status, adminNote, save, del);
    card.appendChild(controls);
    return card;
  }
}

function badge(text: string, kind: string): HTMLSpanElement {
  const b = document.createElement('span');
  b.className = `req-badge req-badge-${kind}`;
  b.textContent = text;
  return b;
}
