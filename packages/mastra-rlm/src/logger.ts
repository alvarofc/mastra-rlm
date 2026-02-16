import type { WorkspaceFilesystem } from '@mastra/core/workspace';

import type { RlmEvent } from './types';
import { dirname } from './path-utils';

export class RlmEventLogger {
  private readonly fs: WorkspaceFilesystem;
  private readonly eventsPath: string;
  private queue: RlmEvent[] = [];
  private waiters: Array<() => void> = [];
  private done = false;

  constructor(fs: WorkspaceFilesystem, eventsPath: string) {
    this.fs = fs;
    this.eventsPath = eventsPath;
  }

  get path(): string {
    return this.eventsPath;
  }

  async init(): Promise<void> {
    await this.fs.mkdir(dirname(this.eventsPath), { recursive: true });
    await this.fs.writeFile(this.eventsPath, '', { overwrite: true, recursive: true });
  }

  async emit(event: RlmEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    await this.fs.appendFile(this.eventsPath, line);
    this.queue.push(event);
    this.flushWaiters();
  }

  finish(): void {
    this.done = true;
    this.flushWaiters();
  }

  async *stream(): AsyncGenerator<RlmEvent> {
    while (!this.done || this.queue.length > 0) {
      if (this.queue.length === 0) {
        await new Promise<void>(resolve => {
          this.waiters.push(resolve);
        });
        continue;
      }

      const next = this.queue.shift();
      if (next) {
        yield next;
      }
    }
  }

  private flushWaiters(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
