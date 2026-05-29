import { defineCommand } from 'citty';
import { gitVcsDriver } from '../lib/vcs';

export default defineCommand({
  meta: {
    name: 'refresh',
    description: 'Pull latest changes from the default branch',
  },
  async run() {
    const root = await gitVcsDriver.resolveProjectRoot();
    await gitVcsDriver.refreshParent(root);
  },
});
