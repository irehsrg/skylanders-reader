// Placeholder figure art. Real images are Activision IP and intentionally not
// bundled (see CLAUDE.md); these generated tiles give each figure a stable,
// recognizable look until user-photographed or licensed images are added.
import type { Figure } from './db';

/** Up to two initials from a figure name, ignoring parenthetical variants. */
export function initials(name: string): string {
  const base = name.replace(/\(.*?\)/g, '').trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Deterministic hue from the character id so a figure always looks the same. */
export function figureHue(charId: number): number {
  // Multiply by a large prime for good spread across 0..359.
  return (charId * 137) % 360;
}

/** Build a placeholder tile element for a figure. */
export function figureTile(fig: Pick<Figure, 'name' | 'charId'>): HTMLDivElement {
  const hue = figureHue(fig.charId);
  const tile = document.createElement('div');
  tile.className = 'figure-art';
  tile.style.background = `linear-gradient(140deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 28%))`;
  const txt = document.createElement('span');
  txt.textContent = initials(fig.name);
  tile.appendChild(txt);
  return tile;
}
