import { defineCommand } from 'citty';
import consola from 'consola';
import { basename, join } from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile, appendFile, readFile, chmod } from 'fs/promises';
import { getGitRoot, isRailProject } from '../lib/paths';

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a new rail project with boilerplate config and scripts',
  },
  async run() {
    const root = await getGitRoot();

    if (isRailProject(root)) {
      throw new Error('Project already initialized. Config exists at .rail/config.yaml');
    }

    const projectName = basename(root);

    await createDirectories(root);
    await createConfigFile(root, projectName);
    await createSetupScript(root);
    await createCleanupScript(root);
    await updateGitignore(root);

    consola.success('Initialized rail project');
    consola.box(
      [
        'Created:',
        '  .rail/config.yaml',
        '  .rail/scripts/setup.sh',
        '  .rail/scripts/cleanup.sh',
        '',
        'Next steps:',
        '  1. Edit .rail/config.yaml to match your project',
        '  2. Customize the setup and cleanup scripts',
        '  3. Run `rail up <feature>` to create your first worktree',
      ].join('\n'),
    );
  },
});

async function createDirectories(root: string): Promise<void> {
  await mkdir(join(root, '.rail', 'scripts'), { recursive: true });
}

async function createConfigFile(root: string, projectName: string): Promise<void> {
  const content = `# rail project configuration
# Docs: https://github.com/kgonyon/rail

name: ${projectName}

worktrees:
  # Directory where feature worktrees are created (relative to project root)
  dir: trees
  # Prefix for feature branches (e.g., feature/my-feature)
  branch_prefix: feature/

port:
  # Starting port number for allocations
  base: 3000
  # Number of ports allocated per feature worktree
  per_feature: 2
  # Total number of ports in the allocation pool
  max: 100

scripts:
  # Run after worktree creation and env file generation (path relative to .rail/)
  setup: scripts/setup.sh
  # Run before worktree removal (path relative to .rail/)
  cleanup: scripts/cleanup.sh

# commands:
#   - name: dev
#     command: npm run dev
#     description: Start development server
#     scope: feature

# env_files:
#   - path: .
#     source: .env.example
#     dest: .env
#     replace:
#       PORT: "\${RAIL_PORT_1}"

# hooks:
#   - event: up
#     command: echo "Ready!"
#   - event: down
#     command: echo "Tearing down..."
#   - event: run
#     command: echo "Command finished!"
`;

  await writeFile(join(root, '.rail', 'config.yaml'), content);
}

async function createSetupScript(root: string): Promise<void> {
  const content = `#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Setup script — runs after worktree creation and env file generation
# during \`rail up <feature>\`.
#
# Available environment variables:
#   RAIL_PROJECT      — Project name from config
#   RAIL_PROJECT_DIR  — Absolute path to the project root
#   RAIL_FEATURE      — Feature name (e.g., "my-feature")
#   RAIL_FEATURE_DIR  — Absolute path to the feature worktree
#   RAIL_PORT         — First allocated port (alias for RAIL_PORT_1)
#   RAIL_PORT_1       — First allocated port
#   RAIL_PORT_2       — Second allocated port
#   RAIL_PORT_N       — Nth port (up to per_feature)
#
# Working directory is set to the feature worktree.
# ------------------------------------------------------------------

echo "Setting up feature: $RAIL_FEATURE"

# Example: Install dependencies
# npm install

# Example: Run database migrations
# npm run db:migrate

# Example: Seed test data
# npm run db:seed
`;

  const scriptPath = join(root, '.rail', 'scripts', 'setup.sh');
  await writeFile(scriptPath, content);
  await chmod(scriptPath, 0o755);
}

async function createCleanupScript(root: string): Promise<void> {
  const content = `#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Cleanup script — runs before worktree removal during \`rail down\`.
#
# Available environment variables:
#   RAIL_PROJECT      — Project name from config
#   RAIL_PROJECT_DIR  — Absolute path to the project root
#   RAIL_FEATURE      — Feature name (e.g., "my-feature")
#   RAIL_FEATURE_DIR  — Absolute path to the feature worktree
#   RAIL_PORT         — First allocated port (alias for RAIL_PORT_1)
#   RAIL_PORT_1       — First allocated port
#   RAIL_PORT_2       — Second allocated port
#   RAIL_PORT_N       — Nth port (up to per_feature)
#
# Working directory is set to the feature worktree.
# ------------------------------------------------------------------

echo "Cleaning up feature: $RAIL_FEATURE"

# Example: Drop feature database
# dropdb "myapp_\${RAIL_FEATURE}" --if-exists

# Example: Remove temporary files
# rm -rf tmp/

# Example: Stop any running services
# docker compose down
`;

  const scriptPath = join(root, '.rail', 'scripts', 'cleanup.sh');
  await writeFile(scriptPath, content);
  await chmod(scriptPath, 0o755);
}

async function updateGitignore(root: string): Promise<void> {
  const gitignorePath = join(root, '.gitignore');
  const entries = ['.rail/local.yaml', '.rail/port_allocations.json'];

  const existing = existsSync(gitignorePath)
    ? await readFile(gitignorePath, 'utf-8')
    : '';

  const missing = entries.filter((entry) => !existing.includes(entry));

  if (missing.length === 0) return;

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}\n# rail local files\n${missing.join('\n')}\n`;

  await appendFile(gitignorePath, block);
}
