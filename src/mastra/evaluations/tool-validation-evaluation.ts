import { validationScorers } from '../scorers/tool-validation-scorer';

// Test cases for workspace tool validation
export const toolValidationTests = [
  {
    name: 'List files with all parameters',
    input: 'List the files in the root directory',
    expectedTool: 'mastra_workspace_list_files',
    expectedParams: {
      path: '/',
      maxDepth: 3,
      showHidden: false,
      dirsOnly: false,
    },
  },
  {
    name: 'List directories only',
    input: 'Show me only directories in the src folder',
    expectedTool: 'mastra_workspace_list_files',
    expectedParams: {
      path: '/src',
      maxDepth: 3,
      showHidden: false,
      dirsOnly: true,
    },
  },
  {
    name: 'File operation request',
    input: 'Read the package.json file',
    expectedTool: 'mastra_workspace_read_file',
    expectedParams: {
      path: '/package.json',
    },
  },
];

// Helper function to validate tool calls
export async function validateToolCalls(agentInput: string, agentOutput: string) {
  const results = {};
  
  for (const [name, scorer] of Object.entries(validationScorers)) {
    try {
      const score = await scorer.evaluate({
        input: agentInput,
        output: agentOutput,
        expected: 'Proper workspace tool usage with correct parameters',
      });
      results[name] = score;
    } catch (error) {
      console.error(`Scorer ${name} failed:`, error);
      results[name] = { score: 0, reason: `Scorer error: ${error.message}` };
    }
  }
  
  return results;
}

export { validationScorers };