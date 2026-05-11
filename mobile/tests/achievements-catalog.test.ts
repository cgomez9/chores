import { ACHIEVEMENTS, ACHIEVEMENT_KEYS } from '../src/constants/achievements';

describe('achievements catalog', () => {
  it('every key in ACHIEVEMENT_KEYS has an ACHIEVEMENTS entry', () => {
    for (const key of ACHIEVEMENT_KEYS) {
      expect(ACHIEVEMENTS[key]).toBeDefined();
      expect(ACHIEVEMENTS[key].emoji).toBeTruthy();
      expect(ACHIEVEMENTS[key].title).toBeTruthy();
      expect(ACHIEVEMENTS[key].description).toBeTruthy();
    }
  });
});
