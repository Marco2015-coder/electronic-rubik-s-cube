/**
 * 选魔方界面。
 */

import { PUZZLE_DEFS, PUZZLE_GROUPS, PuzzleDef } from './puzzles';

const BADGE_CLASS: Record<string, string> = {
  镜面: 'mirror',
  形状: 'shape',
};

function badgeClass(badge: string): string {
  if (badge.includes('镜面')) return BADGE_CLASS['镜面'];
  if (badge.includes('Kilominx') || badge.includes('Megaminx') || badge.includes('Pyraminx') || badge.includes('Skewb') || badge.includes('Maple')) {
    return BADGE_CLASS['形状'];
  }
  return '';
}

export function renderMenu(root: HTMLElement, onPick: (def: PuzzleDef) => void): void {
  root.innerHTML = '';

  for (const group of PUZZLE_GROUPS) {
    const defs = PUZZLE_DEFS.filter((d) => d.group === group);
    if (defs.length === 0) continue;

    const section = document.createElement('section');
    section.className = 'menu-group';

    const title = document.createElement('div');
    title.className = 'menu-group-title';
    title.textContent = group;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'card-grid';

    for (const def of defs) {
      const card = document.createElement('button');
      card.className = 'card' + (def.create ? '' : ' locked');
      card.type = 'button';

      const badge = document.createElement('span');
      badge.className = 'card-badge ' + badgeClass(def.badge);
      badge.textContent = def.badge;
      card.appendChild(badge);

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = def.name;
      card.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'card-desc';
      desc.textContent = def.desc;
      card.appendChild(desc);

      if (!def.create) {
        const soon = document.createElement('span');
        soon.className = 'card-soon';
        soon.textContent = '开发中…';
        card.appendChild(soon);
      } else {
        card.addEventListener('click', () => onPick(def));
      }
      grid.appendChild(card);
    }

    section.appendChild(grid);
    root.appendChild(section);
  }
}
