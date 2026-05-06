export type AvatarId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const AVATARS: Record<AvatarId, { emoji: string; bg: string }> = {
  1: { emoji: '🐱', bg: '#fde68a' },
  2: { emoji: '🐶', bg: '#bfdbfe' },
  3: { emoji: '🦊', bg: '#fdba74' },
  4: { emoji: '🐼', bg: '#e5e7eb' },
  5: { emoji: '🦄', bg: '#f5d0fe' },
  6: { emoji: '🦁', bg: '#fde68a' },
  7: { emoji: '🐸', bg: '#bbf7d0' },
  8: { emoji: '🐙', bg: '#c4b5fd' },
};

export const AVATAR_IDS: AvatarId[] = [1, 2, 3, 4, 5, 6, 7, 8];
