import type {
  RecursiveCallTrace,
  ReplContextPayload,
  RlmRunInput,
  RlmRunSummary,
  RlmTrajectoryEntry,
} from '../types';

export function buildRunSummary(params: {
  runId: string;
  input: RlmRunInput;
  outputPath: string;
  terminatedBy: RlmRunSummary['terminatedBy'];
  iterations: number;
  maxIterations: number;
  maxCalls: number;
  maxDepth: number;
  maxOutputChars: number;
  callsUsed: number;
  context: ReplContextPayload;
  trajectory: RlmTrajectoryEntry[];
  recursiveCalls: RecursiveCallTrace[];
}): RlmRunSummary {
  const documentCharLengths = params.context.documents.map(document => document.content.length);
  const totalChars = documentCharLengths.reduce((sum, value) => sum + value, 0);

  return {
    runId: params.runId,
    task: params.input.task,
    sources: params.input.sources,
    outputPath: params.outputPath,
    terminatedBy: params.terminatedBy,
    iterations: params.iterations,
    budgets: {
      maxIterations: params.maxIterations,
      maxCalls: params.maxCalls,
      maxDepth: params.maxDepth,
      maxOutputChars: params.maxOutputChars,
    },
    usage: {
      subLlmCalls: params.callsUsed,
    },
    context: {
      documentCount: params.context.documents.length,
      totalChars,
      documentCharLengths,
    },
    trajectory: params.trajectory,
    recursiveCalls: params.recursiveCalls,
  };
}
