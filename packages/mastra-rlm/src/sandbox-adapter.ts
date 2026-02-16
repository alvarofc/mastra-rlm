import { resolve } from 'node:path';

import type { Workspace } from '@mastra/core/workspace';

import type { RlmSandboxAdapter, SandboxCommandResult } from './types';

export const defaultSandboxAdapter: RlmSandboxAdapter = {
  resolveRootPath(workspace: Workspace): string {
    const sandbox = workspace.sandbox as { workingDirectory?: string } | undefined;
    const configuredWorkingDir = sandbox?.workingDirectory ?? process.cwd();
    return resolve(process.cwd(), configuredWorkingDir);
  },

  async executeCommand(
    workspace: Workspace,
    command: string,
    args: string[],
    options?: { timeout?: number },
  ): Promise<SandboxCommandResult> {
    const sandbox = workspace.sandbox;
    if (!sandbox?.executeCommand) {
      throw new Error('Workspace sandbox executeCommand is not available');
    }

    const result = await sandbox.executeCommand(command, args, options);

    return {
      exitCode: result.exitCode,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  },
};
