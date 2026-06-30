import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { parse } from 'yaml';
import { getConfigPath, getLocalConfigPath, getUserConfigPath, resolveRelativePathWithFallback } from './paths';
import { runCommand } from './script';
import { HOOK_EVENTS } from '../types/hooks';
import type { HookEvent, HookConfig } from '../types/hooks';
import type { ScriptContext } from './script';

/** @internal */
export function isHookEvent(key: string): key is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(key);
}

/** @internal */
export function validateHookConfig(raw: unknown, configDir: string, fallbackConfigDir?: string): HookConfig {
  if (!Array.isArray(raw)) return [];

  const result: HookConfig = [];

  for (const entry of raw) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.event === 'string' &&
      typeof entry.command === 'string' &&
      isHookEvent(entry.event)
    ) {
      result.push({
        event: entry.event,
        command: resolveRelativePathWithFallback(entry.command, configDir, fallbackConfigDir),
      });
    }
  }

  return result;
}

function loadHooksFromFile(filePath: string, configDir: string, fallbackConfigDir?: string): HookConfig {
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parse(raw);

  return validateHookConfig(parsed?.hooks ?? [], configDir, fallbackConfigDir);
}

/** @internal */
export function mergeHookConfigs(...configs: HookConfig[]): HookConfig {
  return configs.flat();
}

export function loadAllHooks(root: string, railDir = join(root, '.rail'), parentRailDir = railDir): HookConfig {
  const configRoot = railDir.replace(/\/\.rail$/, '');
  const projectHooks = loadHooksFromFile(getConfigPath(configRoot), railDir, parentRailDir);
  const localHooks = loadHooksFromFile(getLocalConfigPath(configRoot), railDir, parentRailDir);
  const userHooks = loadHooksFromFile(getUserConfigPath(), dirname(getUserConfigPath()));

  return mergeHookConfigs(projectHooks, localHooks, userHooks);
}

export async function runHooks(
  event: HookEvent,
  context: ScriptContext,
  cwd?: string,
): Promise<void> {
  const hooks = loadAllHooks(context.root, context.railDir, context.parentRailDir);
  const entries = hooks.filter((h) => h.event === event);

  if (entries.length === 0) return;

  for (const entry of entries) {
    await runCommand(entry.command, context, cwd ?? (context.featureDir || context.workspaceRoot || context.root));
  }
}
