export type PaletteName = 'sunshine' | 'candy' | 'forest';

const PALETTES: Record<PaletteName, Record<string, string>> = {
  sunshine: {
    '--cream': '#FFF6E6', '--cream-2': '#FFEFD1',
    '--peach': '#FFB68A', '--peach-deep': '#FF8E5C',
    '--butter': '#FFD86B', '--butter-deep': '#F5B73D',
    '--mint': '#A8E5C8', '--mint-deep': '#5FCFA0',
    '--sky': '#A6D8FF', '--sky-deep': '#5AB7F2',
    '--rose': '#FFB3C0', '--rose-deep': '#F47A92',
  },
  candy: {
    '--cream': '#FFF4F8', '--cream-2': '#FCE7EF',
    '--peach': '#FFC2D4', '--peach-deep': '#F19BB7',
    '--butter': '#FFE3A8', '--butter-deep': '#F2C771',
    '--mint': '#C9EAD8', '--mint-deep': '#86C7A6',
    '--sky': '#D4C9FF', '--sky-deep': '#9B89E8',
    '--rose': '#FFB3C0', '--rose-deep': '#F47A92',
  },
  forest: {
    '--cream': '#FBF6E8', '--cream-2': '#F1EAD2',
    '--peach': '#E8A07A', '--peach-deep': '#C97D55',
    '--butter': '#E5C46A', '--butter-deep': '#C49E3F',
    '--mint': '#B7CFA0', '--mint-deep': '#7CA060',
    '--sky': '#B5D2D0', '--sky-deep': '#75A4A1',
    '--rose': '#E8A8A1', '--rose-deep': '#C46F66',
  },
};

export function applyPalette(name: PaletteName) {
  const p = PALETTES[name] ?? PALETTES.sunshine;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(p)) root.style.setProperty(k, v);
}

export function applyIntensity(intensity: number) {
  const root = document.documentElement;
  root.style.setProperty('--stroke', intensity >= 1.5 ? '4px' : intensity <= 0.6 ? '2px' : '3px');
  root.style.setProperty('--stroke-thick', intensity >= 1.5 ? '5px' : intensity <= 0.6 ? '3px' : '4px');
}
