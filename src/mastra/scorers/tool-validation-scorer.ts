import { z } from 'zod';
import { createScorer } from '@mastra/core/evals';
import {
  getAssistantMessageFromRunOutput,
  getUserMessageFromRunInput,
} from '@mastra/evals/scorers/utils';

// Tool parameter schemas for validation
const workspaceToolSchemas = {
  'mastra_workspace_list_files': z.object({
    path: z.string().optional().default('/'),
    maxDepth: z.number().optional().default(3),
    showHidden: z.boolean().optional().default(false),
    dirsOnly: z.boolean().optional().default(false),
    exclude: z.union([z.string(), z.array(z.string())]).optional(),
    extension: z.union([z.string(), z.array(z.string())]).optional(),
  }),
};

export const toolCallValidationScorer = createScorer({
  id: 'tool-call-validation-scorer',
  name: 'Tool Call Validation',
  description: 'Validates that tool calls include all required parameters with correct types',
  type: 'agent',
  judge: {
    model: 'groq/llama-3.3-70b-versatile',
    instructions: 'You are an expert at validating tool call parameters. Check that all required parameters are provided and have the correct types.',
  },
})
  .preprocess(({ run }) => {
    const userText = getUserMessageFromRunInput(run.input) || '';
    const assistantText = getAssistantMessageFromRunOutput(run.output) || '';
    return { userText, assistantText };
  })
  .analyze({
    description: 'Extract and validate tool call parameters',
    outputSchema: z.object({
      hasToolCalls: z.boolean(),
      invalidCalls: z.array(z.object({
        toolName: z.string(),
        missingParams: z.array(z.string()),
        invalidTypes: z.array(z.string()),
        errors: z.array(z.string()),
      })),
      validCalls: z.number(),
      totalCalls: z.number(),
      confidence: z.number().min(0).max(1).default(1),
      explanation: z.string().default(''),
    }),
    createPrompt: ({ results }) => `
      You are validating tool calls in an AI agent's response.
      
      User request:
      """
      ${results.preprocessStepResult.userText}
      """
      
      Assistant response:
      """
      ${results.preprocessStepResult.assistantText}
      """
      
      Look for tool calls in the format: mastra_workspace_*
      
      For each tool call found:
      1. Check if it's a known workspace tool: ${Object.keys(workspaceToolSchemas).join(', ')}
      2. Validate parameters against the schema:
         - mastra_workspace_list_files requires: path (string), maxDepth (number), showHidden (boolean), dirsOnly (boolean)
         - Optional: exclude (string|array), extension (string|array)
      
      Return JSON with:
      {
        "hasToolCalls": boolean,
        "invalidCalls": [
          {
            "toolName": "tool_name",
            "missingParams": ["param1", "param2"],
            "invalidTypes": ["param3: expected number, got string"],
            "errors": ["error description"]
          }
        ],
        "validCalls": number,
        "totalCalls": number,
        "confidence": number,
        "explanation": "detailed explanation of validation results"
      }
    `,
  })
  .generateScore(({ results }) => {
    const r = (results as any)?.analyzeStepResult || {};
    if (!r.hasToolCalls) return 1; // No tool calls to validate
    if (r.totalCalls === 0) return 1; // No tool calls made
    if (r.invalidCalls.length === 0) return 1; // All calls valid
    
    // Score based on ratio of valid calls
    const validRatio = r.validCalls / r.totalCalls;
    return validRatio;
  })
  .generateReason(({ results, score }) => {
    const r = (results as any)?.analyzeStepResult || {};
    if (!r.hasToolCalls) return 'No tool calls to validate';
    return `Tool validation: ${r.validCalls}/${r.totalCalls} calls valid. ${r.invalidCalls.length} invalid calls. Score=${score}. ${r.explanation}`;
  });

export const workspaceToolScorer = createScorer({
  id: 'workspace-tool-usage-scorer',
  name: 'Workspace Tool Usage',
  description: 'Evaluates appropriate use of workspace tools for file operations',
  type: 'agent',
  judge: {
    model: 'groq/llama-3.3-70b-versatile',
    instructions: 'You are an expert at evaluating whether workspace tools are used appropriately for file system operations.',
  },
})
  .preprocess(({ run }) => {
    const userText = getUserMessageFromRunInput(run.input) || '';
    const assistantText = getAssistantMessageFromRunOutput(run.output) || '';
    return { userText, assistantText };
  })
  .analyze({
    description: 'Evaluate appropriateness of workspace tool usage',
    outputSchema: z.object({
      requestedFileSystemOp: z.boolean(),
      usedWorkspaceTools: z.boolean(),
      appropriateTool: z.boolean(),
      correctParameters: z.boolean(),
      confidence: z.number().min(0).max(1).default(1),
      explanation: z.string().default(''),
    }),
    createPrompt: ({ results }) => `
      You are evaluating if the assistant appropriately used workspace tools for file system operations.
      
      User request:
      """
      ${results.preprocessStepResult.userText}
      """
      
      Assistant response:
      """
      ${results.preprocessStepResult.assistantText}
      """
      
      Analyze:
      1. Did the user request a file system operation? (list, read, write, delete files)
      2. Did the assistant use workspace tools (mastra_workspace_*)?
      3. Was the chosen tool appropriate for the task?
      4. Were the tool parameters correct?
      
      Return JSON:
      {
        "requestedFileSystemOp": boolean,
        "usedWorkspaceTools": boolean,
        "appropriateTool": boolean,
        "correctParameters": boolean,
        "confidence": number,
        "explanation": "detailed explanation of tool usage evaluation"
      }
    `,
  })
  .generateScore(({ results }) => {
    const r = (results as any)?.analyzeStepResult || {};
    if (!r.requestedFileSystemOp) return 1; // No file operation requested
    if (!r.usedWorkspaceTools) return 0; // File operation requested but no workspace tools used
    if (!r.appropriateTool) return 0.5; // Used tools but wrong one
    if (!r.correctParameters) return 0.7; // Right tool but wrong parameters
    return 1; // Perfect usage
  })
  .generateReason(({ results, score }) => {
    const r = (results as any)?.analyzeStepResult || {};
    if (!r.requestedFileSystemOp) return 'No file system operation requested';
    return `Workspace tool evaluation: requested=${r.requestedFileSystemOp}, used=${r.usedWorkspaceTools}, appropriate=${r.appropriateTool}, correct=${r.correctParameters}. Score=${score}. ${r.explanation}`;
  });

export const validationScorers = {
  toolCallValidationScorer,
  workspaceToolScorer,
};