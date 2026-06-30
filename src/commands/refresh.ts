import { defineCommand } from 'citty';
import { loadConfig } from '../lib/config';
import { resolveRailRuntime } from '../lib/paths';
import { getVcsDriver } from '../lib/vcs';

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
    const runtime = await resolveRailRuntime();
    const root = runtime.parentRoot;
    const config = loadConfig({ parentRoot: runtime.parentRoot, configRoot: runtime.configRoot });
    await getVcsDriver(config.vcs).refreshParent(root, args.target ?? config.default_parent);
  },
});
