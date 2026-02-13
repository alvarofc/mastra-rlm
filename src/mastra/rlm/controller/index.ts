import { Agent } from '@mastra/core/agent';
import type { z } from 'zod';

import {
  buildActionPrompt,
  buildDraftPrompt,
  buildRevisePrompt,
  buildVerifyPrompt,
  controllerSystemPrompt,
} from './prompts';
import { controllerActionSchema, draftOutputSchema, verifyOutputSchema } from './schemas';
import type { ControllerAdapter, ControllerContext, DraftOutput, ModelRef, VerifyOutput } from '../types';

export function createControllerAdapter(model: ModelRef): ControllerAdapter {
  const agent = new Agent({
    id: `rlm-controller-${randomSuffix()}`,
    name: 'RLM Controller',
    instructions: controllerSystemPrompt(),
    model: model.id,
  });

  return {
    async decideNextAction(context: ControllerContext) {
      return generateWithSchema(agent, buildActionPrompt(context), controllerActionSchema);
    },
    async draft(context: ControllerContext): Promise<DraftOutput> {
      return generateWithSchema(agent, buildDraftPrompt(context), draftOutputSchema);
    },
    async verify(context: ControllerContext): Promise<VerifyOutput> {
      return generateWithSchema(agent, buildVerifyPrompt(context), verifyOutputSchema);
    },
    async revise(context: ControllerContext): Promise<DraftOutput> {
      return generateWithSchema(agent, buildRevisePrompt(context), draftOutputSchema);
    },
  };
}

async function generateWithSchema<TSchema extends z.ZodTypeAny>(
  agent: Agent,
  prompt: string,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const result = await agent.generate(prompt, {
    structuredOutput: {
      schema,
      jsonPromptInjection: true,
    },
  });

  return schema.parse(result.object);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
