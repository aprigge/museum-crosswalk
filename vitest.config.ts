import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests read saved responses only; adapters must never hit the network here.
    env: { DATA_DIR: 'test/fixtures', MUSEUM_CROSSWALK_CONTACT: 'test@example.org' },
  },
});
