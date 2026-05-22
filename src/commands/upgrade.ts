import { defineCommand } from 'citty';
import consola from 'consola';
import { upgradeRail } from '../lib/upgrade';
import { RAIL_VERSION } from '../lib/version';

export default defineCommand({
  meta: {
    name: 'upgrade',
    description: 'Upgrade rail to the latest stable release',
  },
  async run() {
    const message = await upgradeRail({ currentVersion: RAIL_VERSION });
    consola.success(message);
  },
});
