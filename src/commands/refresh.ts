import { defineCommand } from 'citty';
import { loadConfig } from '../lib/config';
import { getVcsDriver, gitVcsDriver } from '../lib/vcs';

export default defineCommand({
  meta: {
    name: 'refresh',
    description: 'Refresh the default parent or a specific parent target',
  },
  args: {
    target: {
      type: 'positional',
      description: 'Parent target to refresh',
      required: false,
    },
  },
  async run({ args }) {
    const root = await gitVcsDriver.resolveProjectRoot();
    const config = loadConfig(root);
    await getVcsDriver(config.vcs).refreshParent(root, args.target ?? config.default_parent);
  },
});
