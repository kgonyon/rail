import { defineCommand } from 'citty';
import { loadConfig } from '../lib/config';
import { gitVcsDriver } from '../lib/vcs';

export default defineCommand({
  meta: {
    name: 'refresh',
    description: 'Pull latest changes from the default branch',
  },
  async run() {
    const root = await gitVcsDriver.resolveProjectRoot();
    const config = loadConfig(root);
    await gitVcsDriver.refreshParent(root, config.default_parent);
  },
});
