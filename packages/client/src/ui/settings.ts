/** Player settings shown on the encounter screen, kept apart from the components so the UI hot-reloads cleanly. */
export const SPEEDS = [
  { value: 0, label: 'Instant' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
  { value: 4, label: '4×' },
] as const;

/** Sound volumes (#158). */
export const SOUND_LEVELS = [
  { value: 0, label: 'Off' },
  { value: 0.25, label: 'Low' },
  { value: 0.5, label: 'Medium' },
  { value: 1, label: 'High' },
] as const;
export const DEFAULT_SOUND_LEVEL = 0.5;

/** How big the board is drawn: beside the panels at page width, across a wide window, or filling the screen. */
export type ViewMode = 'standard' | 'wide' | 'full';
export const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full screen' },
];
