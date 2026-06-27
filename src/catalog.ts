// Catalog view: browse all catalogued figures with search/filter, see what's
// owned vs missing, and toggle wishlist.
import { visibleFigures, sectionOrder, type Figure } from './figures/db';
import { figureThumb } from './figures/art';
import type { Collection } from './collection/collection';

type Filter = 'all' | 'owned' | 'missing' | 'wishlist';

export class CatalogView {
  private collection: Collection;
  private searchEl: HTMLInputElement;
  private filterEl: HTMLSelectElement;
  private sectionEl: HTMLSelectElement;
  private countEl: HTMLElement;
  private gridEl: HTMLElement;
  private onChange: () => void;

  constructor(collection: Collection, onChange: () => void) {
    this.collection = collection;
    this.onChange = onChange;
    this.searchEl = document.querySelector<HTMLInputElement>('#catalog-search')!;
    this.filterEl = document.querySelector<HTMLSelectElement>('#catalog-filter')!;
    this.sectionEl = document.querySelector<HTMLSelectElement>('#catalog-section')!;
    this.countEl = document.querySelector('#catalog-count')!;
    this.gridEl = document.querySelector('#catalog-grid')!;

    for (const section of sectionOrder) {
      const opt = document.createElement('option');
      opt.value = section;
      opt.textContent = section;
      this.sectionEl.appendChild(opt);
    }

    const rerender = () => this.render();
    this.searchEl.addEventListener('input', debounce(rerender, 120));
    this.filterEl.addEventListener('change', rerender);
    this.sectionEl.addEventListener('change', rerender);
  }

  render() {
    const q = this.searchEl.value.trim().toLowerCase();
    const filter = this.filterEl.value as Filter;
    const section = this.sectionEl.value;

    const matches = visibleFigures.filter((f) => {
      if (section !== 'all' && f.section !== section) return false;
      if (q && !f.name.toLowerCase().includes(q)) return false;
      const owned = this.collection.isOwned(f.charId, f.variantId);
      const wished = this.collection.isWishlisted(f.charId, f.variantId);
      if (filter === 'owned') return owned;
      if (filter === 'missing') return !owned;
      if (filter === 'wishlist') return wished;
      return true;
    });

    this.countEl.textContent = `${matches.length} figure${matches.length === 1 ? '' : 's'}`;

    const frag = document.createDocumentFragment();
    for (const f of matches) frag.appendChild(this.card(f));
    this.gridEl.replaceChildren(frag);
  }

  private card(f: Figure): HTMLElement {
    const owned = this.collection.isOwned(f.charId, f.variantId);
    const wished = this.collection.isWishlisted(f.charId, f.variantId);

    const card = document.createElement('div');
    card.className = owned ? 'cat-card owned' : 'cat-card';

    const art = figureThumb(f);
    if (!owned) art.classList.add('dim');
    card.appendChild(art);

    const body = document.createElement('div');
    body.className = 'cat-body';
    const name = document.createElement('div');
    name.className = 'cat-name';
    name.textContent = f.name;
    name.title = f.name;
    const sec = document.createElement('div');
    sec.className = 'cat-section';
    sec.textContent = f.section;
    body.append(name, sec);

    const foot = document.createElement('div');
    foot.className = 'cat-foot';
    const state = document.createElement('span');
    if (owned) {
      state.className = 'cat-state owned';
      state.textContent = 'Owned';
    } else {
      state.className = 'cat-state';
      state.textContent = 'Missing';
    }
    foot.appendChild(state);

    if (!owned) {
      const wishBtn = document.createElement('button');
      wishBtn.type = 'button';
      wishBtn.className = wished ? 'wish-btn on' : 'wish-btn';
      wishBtn.textContent = wished ? '★ Wishlisted' : '☆ Wishlist';
      wishBtn.addEventListener('click', async () => {
        await this.collection.toggleWishlist(f);
        this.render();
        this.onChange();
      });
      foot.appendChild(wishBtn);
    }

    body.appendChild(foot);
    card.appendChild(body);
    return card;
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let t: number | undefined;
  return ((...args: never[]) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  }) as T;
}
