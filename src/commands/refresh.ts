import { defineCommand } from 'citty';
import { getProjectRoot } from '../lib/paths';
import { refreshFromOrigin } from '../lib/git';

export default defineCommand({
  meta: {
    name: 'refresh',
    description: 'Pull latest changes from the default branch',
  },
  async run() {
    const root = await getProjectRoot();
    await refreshFromOrigin(root);
  },
});
