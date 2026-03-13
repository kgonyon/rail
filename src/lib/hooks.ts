import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { parse } from 'yaml';
import { getConfigPath, getLocalConfigPath, getUserConfigPath, resolveRelativePath } from './paths';
import { runCommand } from './script';
import { HOOK_EVENTS } from '../types/hooks';
import type { HookEvent, HookConfig } from '../types/hooks';
import type { ScriptContext } from './script';

/** @internal */
export function isHookEvent(key: string): key is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(key);
}

/** @internal */
export function validateHookConfig(raw: unknown, configDir: string): HookConfig {
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
        command: resolveRelativePath(entry.command, configDir),
      });
    }
  }

  return result;
}

function loadHooksFromFile(filePath: string, configDir: string): HookConfig {
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, 'utf-8');
  const parsed = parse(raw);

  return validateHookConfig(parsed?.hooks ?? [], configDir);
}

/** @internal */
export function mergeHookConfigs(...configs: HookConfig[]): HookConfig {
  return configs.flat();
}

export function loadAllHooks(root: string): HookConfig {
  const railDir = join(root, '.rail');
  const projectHooks = loadHooksFromFile(getConfigPath(root), railDir);
  const localHooks = loadHooksFromFile(getLocalConfigPath(root), railDir);
  const userHooks = loadHooksFromFile(getUserConfigPath(), dirname(getUserConfigPath()));

  return mergeHookConfigs(projectHooks, localHooks, userHooks);
}

export async function runHooks(
  event: HookEvent,
  context: ScriptContext,
  cwd?: string,
): Promise<void> {
  const hooks = loadAllHooks(context.root);
  const entries = hooks.filter((h) => h.event === event);

  if (entries.length === 0) return;

  for (const entry of entries) {
    await runCommand(entry.command, context, cwd ?? (context.featureDir || context.root));
  }
}
