export type Scene = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  accent: string;
  backdrop: string;
};

export const scenes: Scene[] = [
  {
    id: 'hot-dog-stand',
    name: 'Hot Dog Stand',
    description: 'A curbside classic with mustard-yellow swagger.',
    emoji: '🌭',
    accent: 'oklch(78% 0.16 82)',
    backdrop: 'oklch(28% 0.07 72)',
  },
  {
    id: 'subway',
    name: 'Subway Platform',
    description: 'Tiled walls, express trains, main-character energy.',
    emoji: '🚇',
    accent: 'oklch(74% 0.13 220)',
    backdrop: 'oklch(24% 0.045 230)',
  },
  {
    id: 'central-park',
    name: 'Central Park',
    description: 'Bow Bridge, leafy shadows, and skyline peeks.',
    emoji: '🌳',
    accent: 'oklch(72% 0.14 145)',
    backdrop: 'oklch(25% 0.05 145)',
  },
  {
    id: 'broadway',
    name: 'Broadway',
    description: 'Opening-night lights under a glowing marquee.',
    emoji: '🎭',
    accent: 'oklch(73% 0.18 25)',
    backdrop: 'oklch(25% 0.07 18)',
  },
  {
    id: 'times-square',
    name: 'Times Square',
    description: 'Big screens, bright color, and midnight motion.',
    emoji: '🌆',
    accent: 'oklch(72% 0.19 325)',
    backdrop: 'oklch(24% 0.075 315)',
  },
  {
    id: 'brooklyn-bridge',
    name: 'Brooklyn Bridge',
    description: 'Stone arches, cable lines, and Manhattan behind you.',
    emoji: '🌉',
    accent: 'oklch(76% 0.13 48)',
    backdrop: 'oklch(26% 0.045 46)',
  },
];
