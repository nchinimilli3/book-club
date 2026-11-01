import type { Phase } from './model';

export const phaseLabel: Record<Phase, string> = {
  setup: 'Getting started',
  choosing: 'Choosing the next book',
  acquiring: 'Getting copies',
  reading: 'Reading now',
  planning_meeting: 'Planning the meeting',
  meeting: 'Meeting soon',
  rating: 'Rating the book',
  archived: 'Archived',
  paused: 'Paused',
};

export function clubInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || 'BC';
}
