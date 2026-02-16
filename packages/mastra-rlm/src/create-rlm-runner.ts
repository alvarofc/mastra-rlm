import { RlmRunner } from './runner';
import type { RlmRunnerOptions } from './types';

export function createRlmRunner(options: RlmRunnerOptions): RlmRunner {
  return new RlmRunner(options);
}
