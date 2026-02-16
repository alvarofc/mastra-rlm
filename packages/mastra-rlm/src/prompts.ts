import type { ReplContextPayload, ReplVariableInfo } from './types';

export function buildSystemPrompt(): string {
  return [
    'You are a Recursive Language Model (RLM) controller operating through a Python REPL.',
    'Solve tasks iteratively by writing code, observing outputs, and refining the next step.',
    'Use a DSPy-style loop discipline: reason -> code -> observe -> iterate -> finalize.',
    'Context is stored externally in REPL variable `context`; the full text is not shown in prompts.',
    '',
    'Response format every iteration:',
    '[[ ## reasoning ## ]]',
    '<short step-by-step plan>',
    '[[ ## code ## ]]',
    '```repl',
    '<python code>',
    '```',
    '[[ ## completed ## ]]',
    '',
    'Available helper functions in REPL:',
    '- llm_query(prompt, model=None)',
    '- llm_query_batched(prompts, model=None)',
    '- chunk_text(text, chunk_size=20000, overlap=1000)',
    '- map_chunks_batched(text, prompt_template, chunk_size=20000, overlap=1000, model=None)',
    '- majority_vote(values)',
    '- regex_search(pattern, text, flags="")',
    '- regex_findall(pattern, text, flags="")',
    '- SHOW_VARS()',
    '- FINAL(value)',
    '- FINAL_VAR(variable_name)',
    '',
    'Execution policy:',
    '1) Explore first: inspect structure/samples before committing to an extraction strategy.',
    '2) Iterate with small executable steps; state persists between iterations.',
    '3) Use regex/string logic for deterministic span extraction and counting.',
    '4) Use llm_query / llm_query_batched for semantic extraction and chunk-level synthesis.',
    '5) For large contexts (>100k chars) or aggregation-heavy tasks (count/percentage/first/last/most/least), prefer map-reduce:',
    '   split into chunks -> llm_query_batched on chunks -> aggregate in Python -> verify -> finalize.',
    '6) Prefer llm_query_batched over many single calls when processing many chunks.',
    '7) If code errors, change strategy next step; do not repeat the same failing code.',
    '8) Use standard-library Python only. Do not install packages or use third-party modules.',
    '9) Finalize only inside code via FINAL(...) or FINAL_VAR(...). No plain-text final answer.',
    '10) Never return raw context dictionaries or call FINAL_VAR(context).',
    '',
    'Suggested mini-template for long tasks:',
    '```repl',
    'doc = context["documents"][0]["content"]',
    'template = "Extract evidence for: <subtask>.\\nChunk {index}/{total}:\\n{chunk}"',
    'chunk_answers = map_chunks_batched(doc, template, chunk_size=18000, overlap=800)',
    'combined = "\\n".join(chunk_answers)',
    '# aggregate + verify deterministically in Python',
    'final_answer = "..."',
    'FINAL_VAR("final_answer")',
    '```',
    '',
    'Keep code minimal, transparent, and grounded in observed outputs.',
  ].join('\n');
}

export function buildContextMetadataPrompt(context: ReplContextPayload): string {
  const lengths = context.documents.map(document => document.content.length);
  const totalChars = lengths.reduce((sum, value) => sum + value, 0);
  const summarizedLengths =
    lengths.length > 40 ? `${JSON.stringify(lengths.slice(0, 40))} ...` : JSON.stringify(lengths);

  return [
    '[[ ## variables_info ## ]]',
    '[1] <<<',
    '    Variable: `context` (access it in your code)',
    '    Type: dict',
    `    Total length: ${JSON.stringify(context).length} characters`,
    '    Preview:',
    '    ```',
    '{"task": "...", "documents": [{"docId": "...", "sourcePath": "...", "content": "<external>"}, ...]}',
    '    ```',
    '>>>',
    '[2] <<<',
    '    Variable: `context["task"]`',
    '    Type: str',
    `    Total length: ${context.task.length} characters`,
    '    Preview:',
    '    ```',
    truncateText(context.task, 400),
    '    ```',
    '>>>',
    '[3] <<<',
    '    Variable: `context["documents"]`',
    '    Type: list[dict]',
    `    Document count: ${context.documents.length}`,
    `    Total characters across all documents: ${totalChars}`,
    `    Per-document character lengths: ${summarizedLengths}`,
    '    Preview:',
    '    ```',
    '[{"docId": str, "sourcePath": str, "content": str}, ...]',
    '    ```',
    '>>>',
    '',
    '[[ ## repl_history ## ]]',
    'You have not interacted with the REPL environment yet.',
    '',
    'Access full document text only inside REPL code using context["documents"][i]["content"].',
  ].join('\n');
}

export function buildIterationUserPrompt(params: {
  task: string;
  iteration: number;
  maxIterations: number;
  documentCount: number;
  totalContextChars: number;
  maxCalls: number;
  callsUsed: number;
  variables: ReplVariableInfo[];
}): string {
  const callsRemaining = Math.max(0, params.maxCalls - params.callsUsed);
  const subqueryHint = buildSubqueryHint(
    params.task,
    params.totalContextChars,
    params.callsUsed,
    params.iteration,
  );

  return [
    '[[ ## task ## ]]',
    params.task,
    '',
    '[[ ## iteration ## ]]',
    `${params.iteration + 1}/${params.maxIterations}`,
    '',
    '[[ ## budgets ## ]]',
    `Sub-LLM calls used: ${params.callsUsed}/${params.maxCalls} (remaining ${callsRemaining})`,
    '',
    '[[ ## context_stats ## ]]',
    `Documents: ${params.documentCount}`,
    `Total context characters: ${params.totalContextChars}`,
    '',
    '[[ ## strategy_hint ## ]]',
    subqueryHint,
    '',
    '[[ ## variables_info ## ]]',
    formatVariables(params.variables),
    '',
    'Respond with [[ ## reasoning ## ]], [[ ## code ## ]], [[ ## completed ## ]].',
    'Keep reasoning concise and put executable Python inside ```repl ... ```.',
    'If enough evidence exists, finalize in code using FINAL(...) or FINAL_VAR(...).',
  ].join('\n');
}

export function buildExtractPrompt(task: string, variables: ReplVariableInfo[]): string {
  return [
    `Max iterations reached for task: "${task}".`,
    'Produce the best final answer now using one REPL code block.',
    'If a final answer variable already exists, return exactly FINAL_VAR(variable_name).',
    'Otherwise assign final_answer and call FINAL_VAR("final_answer").',
    'Do not return raw context objects or raw dict dumps.',
    `Current REPL variables:\n${formatVariables(variables)}`,
  ].join('\n\n');
}

export function formatReplResultForHistory(params: {
  code: string;
  stdout: string;
  stderr: string;
  maxOutputChars: number;
  variables: ReplVariableInfo[];
  droppedVariables: string[];
}): string {
  const outputParts: string[] = [];
  if (params.stdout.trim()) outputParts.push(`STDOUT:\n${params.stdout.trim()}`);
  if (params.stderr.trim()) outputParts.push(`STDERR:\n${params.stderr.trim()}`);

  const joined = outputParts.length > 0 ? outputParts.join('\n\n') : '(no output - did you forget to print?)';
  const output = truncateText(joined, params.maxOutputChars);

  const variableLines = formatVariables(params.variables);
  const dropped =
    params.droppedVariables.length > 0
      ? `Dropped non-serializable variables: ${JSON.stringify(params.droppedVariables)}`
      : 'Dropped non-serializable variables: []';

  return [
    `Code executed:\n\`\`\`python\n${params.code}\n\`\`\``,
    `REPL output:\n${output}`,
    `Variables after execution:\n${variableLines}`,
    dropped,
  ].join('\n\n');
}

function formatVariables(variables: ReplVariableInfo[]): string {
  if (variables.length === 0) return '(none)';
  return variables
    .map((variable, index) => {
      return [
        `[${index + 1}] <<<`,
        `    Variable: \`${variable.name}\``,
        `    Type: ${variable.typeName}`,
        `    Total length: ${variable.totalLength} characters`,
        '    Preview:',
        '    ```',
        truncateText(String(variable.preview), 600),
        '    ```',
        '>>>',
      ].join('\n');
    })
    .join('\n');
}

function buildSubqueryHint(
  task: string,
  totalContextChars: number,
  callsUsed: number,
  iteration: number,
): string {
  const lowerTask = task.toLowerCase();
  const aggregationSignals = [
    'count',
    'percentage',
    'sum',
    'total',
    'first',
    'last',
    'most',
    'least',
    'compare',
    'across',
    'aggregate',
  ];

  const isAggregationTask = aggregationSignals.some(signal => lowerTask.includes(signal));
  const isLargeContext = totalContextChars >= 100_000;

  if (isLargeContext || isAggregationTask) {
    if (callsUsed === 0 && iteration >= 1) {
      return [
        'Important: you still have 0 recursive subquery calls on a long or aggregation-heavy task.',
        'Switch now to map-reduce: split context into chunks, run llm_query_batched over chunks, and aggregate results in Python.',
        'Use regex as a verifier, not as the only extraction strategy.',
      ].join(' ');
    }

    return [
      'Strong recommendation: use recursive subqueries.',
      'Suggested pattern: split documents into chunks, run llm_query_batched on chunks, then aggregate in Python.',
      'Use local regex parsing mainly for deterministic span extraction and final verification.',
    ].join(' ');
  }

  return [
    'Use adaptive strategy.',
    'Local parsing is acceptable for simple deterministic extraction.',
    'Use llm_query / llm_query_batched when semantic interpretation or multi-fragment synthesis is needed.',
  ].join(' ');
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const half = Math.max(1, Math.floor(maxChars / 2));
  const omitted = value.length - maxChars;
  return `${value.slice(0, half)}\n\n... (${omitted} characters omitted) ...\n\n${value.slice(-half)}`;
}
