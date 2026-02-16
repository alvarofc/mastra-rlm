import { Agent } from '@mastra/core/agent';

import type { ModelRef, RlmMessage, RlmRootModelAdapter, RlmSubModelAdapter } from './types';

export function createRootModelAdapter(model: ModelRef): RlmRootModelAdapter {
  const agent = createAgent(model.id, 'RLM Root Model');

  return {
    async generate(messages: RlmMessage[]): Promise<string> {
      const result = await agent.generate(
        messages.map(message => ({
          role: message.role,
          content: message.content,
        })) as any,
      );
      return result.text;
    },
  };
}

export function createSubModelAdapter(defaultModel: ModelRef): RlmSubModelAdapter {
  const agents = new Map<string, Agent>();

  const getAgent = (modelId?: string): Agent => {
    const resolvedModel = modelId ?? defaultModel.id;
    const cached = agents.get(resolvedModel);
    if (cached) return cached;

    const created = createAgent(resolvedModel, 'RLM Sub Model');
    agents.set(resolvedModel, created);
    return created;
  };

  return {
    async query(input): Promise<string> {
      const agent = getAgent(input.modelId);
      const result = await agent.generate(String(input.prompt));
      return result.text;
    },

    async queryBatched(input): Promise<string[]> {
      if (input.prompts.length === 0) return [];
      const agent = getAgent(input.modelId);

      return Promise.all(
        input.prompts.map(async prompt => {
          const result = await agent.generate(String(prompt));
          return result.text;
        }),
      );
    },
  };
}

function createAgent(modelId: string, name: string): Agent {
  return new Agent({
    id: `${name.toLowerCase().replace(/\s+/g, '-')}-${randomSuffix()}`,
    name,
    model: modelId,
    instructions: 'You are a model in a recursive language model (RLM) execution loop. Follow the prompt strictly.',
  });
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
