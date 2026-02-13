import type { Workspace } from '@mastra/core/workspace';

export type ModelRef = {
  id: string;
};

export type SourceRef = {
  path: string;
  type?: 'file' | 'folder';
};

export type GroundingConfig = {
  requireQuotes?: boolean;
  allowInference?: boolean;
  allowSynthesis?: boolean;
};

export type RlmRunInput = {
  task: string;
  taskType?: 'synthesis' | 'analysis' | 'extraction' | 'comparison' | 'review' | 'custom';
  sources: SourceRef[];
  output: {
    format: 'md' | 'json';
    path: string;
  };
  grounding?: GroundingConfig;
  budgets?: {
    maxDepth?: number;
    maxIterations?: number;
    scannerBatchSize?: number;
    scannerConcurrency?: number;
    searchTopK?: number;
  };
  contradictionPolicy?: 'fail' | 'report';
  outputCitations?: 'inline' | 'appendix' | 'both';
};

export type Chunk = {
  chunkId: string;
  docId: string;
  sourcePath: string;
  text: string;
  meta: {
    section?: string;
    page?: number;
    offsetStart?: number;
    offsetEnd?: number;
  };
};

export type ScanHit = {
  chunkId: string;
  docId: string;
  snippet: string;
  label: 'definition' | 'requirement' | 'exception' | 'deadline' | 'other';
  reason: string;
};

export type DraftOutput = {
  sectionTitle?: string;
  text: string;
  claims: Array<{
    id: string;
    text: string;
    evidence: Array<{
      docId: string;
      chunkId: string;
      quote: string;
    }>;
  }>;
};

export type VerifyOutput = {
  verdicts: Array<{
    claimId: string;
    status: 'SUPPORTED' | 'UNSUPPORTED' | 'CONTRADICTED' | 'AMBIGUOUS';
    notes: string;
    neededQueries?: string[];
  }>;
  overall: 'OK' | 'NEEDS_MORE_EVIDENCE' | 'CONTRADICTION';
};

export type Audit = {
  runId: string;
  task: string;
  sources: SourceRef[];
  finalOutputPath: string;
  claims: Array<{
    id: string;
    text: string;
    evidence: Array<{ docId: string; chunkId: string; quote: string }>;
    status: 'SUPPORTED' | 'UNSUPPORTED' | 'CONTRADICTED' | 'AMBIGUOUS';
  }>;
  stats: {
    iterations: number;
    depth: number;
    chunksUsed: number;
  };
};

export type RlmEvent =
  | { type: 'run.start'; runId: string; input: RlmRunInput }
  | { type: 'ingest.start'; sources: SourceRef[] }
  | { type: 'ingest.done'; docCount: number; chunkCount: number }
  | { type: 'iteration.start'; iteration: number; depth: number }
  | { type: 'controller.prompt'; iteration: number; content: unknown }
  | { type: 'scanner.prompt'; iteration: number; content: unknown }
  | { type: 'retrieval.result'; iteration: number; chunks: Array<Pick<Chunk, 'chunkId' | 'docId' | 'sourcePath'>> }
  | { type: 'draft.created'; iteration: number; claims: number }
  | {
      type: 'verify.result';
      iteration: number;
      supported: number;
      unsupported: number;
      contradicted: number;
    }
  | { type: 'revision.applied'; iteration: number; notes: string }
  | { type: 'run.final'; outputPath: string; auditPath: string }
  | { type: 'run.error'; error: string };

export type RlmRunResult = {
  outputPath: string;
  auditPath: string;
  runId: string;
};

export type NormalizedRlmConfig = {
  requireQuotes: boolean;
  allowInference: boolean;
  allowSynthesis: boolean;
  maxDepth: number;
  maxIterations: number;
  scannerBatchSize: number;
  scannerConcurrency: number;
  searchTopK: number;
  contradictionPolicy: 'fail' | 'report';
  outputCitations: 'inline' | 'appendix' | 'both';
};

export type ControllerAction =
  | { action: 'SEARCH'; queries: string[]; reasoning: string }
  | { action: 'SCAN'; focusQuestions: string[]; reasoning: string }
  | { action: 'DRAFT'; reasoning: string }
  | { action: 'VERIFY'; reasoning: string }
  | { action: 'REVISE'; issues: string[]; reasoning: string }
  | { action: 'FINALIZE'; reasoning: string };

export type ControllerContext = {
  input: RlmRunInput;
  iteration: number;
  depth: number;
  recentQueries: string[];
  retrievedChunks: Chunk[];
  draft: DraftOutput | null;
  verify: VerifyOutput | null;
};

export type ControllerAdapter = {
  decideNextAction(context: ControllerContext): Promise<ControllerAction>;
  draft(context: ControllerContext): Promise<DraftOutput>;
  verify(context: ControllerContext): Promise<VerifyOutput>;
  revise(context: ControllerContext): Promise<DraftOutput>;
};

export type ScannerAdapter = {
  scan(input: {
    runId: string;
    iteration: number;
    task: string;
    queries: string[];
    chunks: Chunk[];
    batchSize: number;
    concurrency: number;
  }): Promise<ScanHit[]>;
};

export type RlmRunnerOptions = {
  workspace: Workspace;
  controllerModel: ModelRef;
  scannerModel?: ModelRef;
  logger?: { jsonlPath?: string };
  adapters?: {
    controller?: ControllerAdapter;
    scanner?: ScannerAdapter;
  };
};

export type IngestionResult = {
  sourceFiles: Array<{
    docId: string;
    originalPath: string;
    copiedPath: string;
    extractedPath: string;
  }>;
  chunks: Chunk[];
  chunkById: Map<string, Chunk>;
};
