import type { Workspace } from '@mastra/core/workspace';

export type ModelRef = {
  id: string;
};

export type SourceRef = {
  path: string;
  type?: 'file' | 'folder';
};

export type RlmRunInput = {
  task: string;
  sources: SourceRef[];
  output: {
    format: 'md' | 'json';
    path: string;
  };
  budgets?: {
    maxIterations?: number;
    maxCalls?: number;
    maxDepth?: number;
    maxOutputChars?: number;
  };
};

export type ReplContextDocument = {
  docId: string;
  sourcePath: string;
  content: string;
};

export type ReplContextPayload = {
  task: string;
  documents: ReplContextDocument[];
};

export type ReplVariableInfo = {
  name: string;
  typeName: string;
  totalLength: number;
  preview: string;
};

export type ReplExecutionResult = {
  stdout: string;
  stderr: string;
  variables: ReplVariableInfo[];
  droppedVariables: string[];
  finalSignal: FinalSignal | null;
};

export type FinalSignal =
  | { type: 'FINAL'; answer: string }
  | { type: 'FINAL_VAR'; varName: string };

export type RlmMessage = {
  role: 'system' | 'assistant' | 'user';
  content: string;
};

export type RlmTrajectoryEntry = {
  iteration: number;
  code: string;
  output: string;
};

export type RecursiveCallTrace = {
  call: number;
  iteration: number;
  depth: number;
  modelId: string;
  batched: boolean;
  promptCount: number;
  promptPreview: string;
};

export type RlmRunSummary = {
  runId: string;
  task: string;
  sources: SourceRef[];
  outputPath: string;
  terminatedBy: 'FINAL' | 'FINAL_VAR' | 'MAX_ITERATIONS';
  iterations: number;
  budgets: {
    maxIterations: number;
    maxCalls: number;
    maxDepth: number;
    maxOutputChars: number;
  };
  usage: {
    subLlmCalls: number;
  };
  context: {
    documentCount: number;
    totalChars: number;
    documentCharLengths: number[];
  };
  trajectory: RlmTrajectoryEntry[];
  recursiveCalls: RecursiveCallTrace[];
};

export type RlmEvent =
  | { type: 'run.start'; runId: string; input: RlmRunInput }
  | { type: 'ingest.start'; sources: SourceRef[] }
  | { type: 'ingest.done'; docCount: number; contextChars: number }
  | { type: 'iteration.start'; iteration: number }
  | { type: 'root.prompt'; iteration: number; messageCount: number }
  | { type: 'root.response'; iteration: number; text: string }
  | { type: 'repl.code'; iteration: number; blockIndex: number; code: string }
  | {
      type: 'repl.result';
      iteration: number;
      blockIndex: number;
      stdout: string;
      stderr: string;
      variables: string[];
      droppedVariables: string[];
    }
  | {
      type: 'subquery.call';
      iteration: number;
      call: number;
      depth: number;
      modelId: string;
      batched: boolean;
      promptCount: number;
    }
  | {
      type: 'run.final';
      outputPath: string;
      auditPath: string;
      recursionPath: string;
      reason: 'FINAL' | 'FINAL_VAR' | 'MAX_ITERATIONS';
    }
  | { type: 'run.error'; error: string };

export type RlmRunResult = {
  outputPath: string;
  auditPath: string;
  eventsPath: string;
  recursionPath: string;
  runId: string;
};

export type NormalizedRlmConfig = {
  maxIterations: number;
  maxCalls: number;
  maxDepth: number;
  maxOutputChars: number;
};

export type RlmRootModelAdapter = {
  generate(messages: RlmMessage[]): Promise<string>;
};

export type RlmSubModelAdapter = {
  query(input: { prompt: string; modelId?: string; depth: number }): Promise<string>;
  queryBatched(input: { prompts: string[]; modelId?: string; depth: number }): Promise<string[]>;
};

export type SandboxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RlmSandboxAdapter = {
  resolveRootPath(workspace: Workspace): string;
  executeCommand(
    workspace: Workspace,
    command: string,
    args: string[],
    options?: { timeout?: number },
  ): Promise<SandboxCommandResult>;
};

export type RlmRunnerOptions = {
  workspace: Workspace;
  rootModel?: ModelRef;
  subModel?: ModelRef;
  sandboxAdapter?: RlmSandboxAdapter;
  logger?: { jsonlPath?: string };
  adapters?: {
    root?: RlmRootModelAdapter;
    sub?: RlmSubModelAdapter;
  };
};

export type IngestionResult = {
  sourceFiles: Array<{
    docId: string;
    originalPath: string;
    copiedPath: string;
    extractedPath: string;
    text: string;
    charLength: number;
  }>;
  context: ReplContextPayload;
};
