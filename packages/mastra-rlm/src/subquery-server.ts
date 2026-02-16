import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { RecursiveCallTrace, RlmEvent, RlmSubModelAdapter } from './types';

type SubqueryServerOptions = {
  adapter: RlmSubModelAdapter;
  defaultModelId: string;
  maxCalls: number;
  maxDepth: number;
  emit: (event: RlmEvent) => Promise<void>;
};

export class SubqueryServer {
  private readonly options: SubqueryServerOptions;
  private readonly server = createServer((req, res) => {
    this.handle(req, res).catch(error => {
      this.sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  private started = false;
  private endpointUrl = '';
  private callCount = 0;
  private trace: RecursiveCallTrace[] = [];

  constructor(options: SubqueryServerOptions) {
    this.options = options;
  }

  get endpoint(): string {
    if (!this.started) {
      throw new Error('SubqueryServer has not been started');
    }
    return this.endpointUrl;
  }

  get callsUsed(): number {
    return this.callCount;
  }

  get recursionTrace(): RecursiveCallTrace[] {
    return [...this.trace];
  }

  async start(): Promise<void> {
    if (this.started) return;

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo | null;
    if (!address || typeof address.port !== 'number') {
      throw new Error('Failed to bind subquery server');
    }

    this.endpointUrl = `http://127.0.0.1:${address.port}/subquery`;
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    await new Promise<void>((resolve, reject) => {
      this.server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
    this.started = false;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      this.sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }

    if (req.url !== '/subquery') {
      this.sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    const payload = await this.readJsonBody(req);
    if (!payload || typeof payload.kind !== 'string') {
      this.sendJson(res, 400, { ok: false, error: 'Invalid request payload' });
      return;
    }

    const depth = Number(payload.depth ?? 1);
    const iteration = Number(payload.iteration ?? 0);
    const modelId = typeof payload.model === 'string' && payload.model.trim() ? payload.model : this.options.defaultModelId;

    if (depth > this.options.maxDepth) {
      this.sendJson(res, 200, {
        ok: false,
        error: `RLM depth limit exceeded: ${depth} > ${this.options.maxDepth}`,
      });
      return;
    }

    if (payload.kind === 'single') {
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
      if (!prompt.trim()) {
        this.sendJson(res, 200, { ok: false, error: 'prompt cannot be empty' });
        return;
      }

      const budgetError = this.reserveCallBudget(1);
      if (budgetError) {
        this.sendJson(res, 200, { ok: false, error: budgetError });
        return;
      }

      await this.recordTrace({
        iteration,
        depth,
        modelId,
        batched: false,
        promptCount: 1,
        promptPreview: truncate(prompt, 400),
      });

      try {
        const answer = await this.options.adapter.query({
          prompt,
          modelId,
          depth,
        });
        this.sendJson(res, 200, { ok: true, answer });
      } catch (error) {
        this.sendJson(res, 200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (payload.kind === 'batch') {
      const prompts = Array.isArray(payload.prompts)
        ? payload.prompts.filter((value: unknown) => typeof value === 'string')
        : [];

      if (prompts.length === 0) {
        this.sendJson(res, 200, { ok: true, answers: [] });
        return;
      }

      const budgetError = this.reserveCallBudget(prompts.length);
      if (budgetError) {
        this.sendJson(res, 200, { ok: false, error: budgetError });
        return;
      }

      await this.recordTrace({
        iteration,
        depth,
        modelId,
        batched: true,
        promptCount: prompts.length,
        promptPreview: truncate(prompts[0] ?? '', 400),
      });

      try {
        const answers = await this.options.adapter.queryBatched({
          prompts,
          modelId,
          depth,
        });
        this.sendJson(res, 200, { ok: true, answers });
      } catch (error) {
        this.sendJson(res, 200, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    this.sendJson(res, 400, { ok: false, error: `Unsupported kind: ${String(payload.kind)}` });
  }

  private reserveCallBudget(requestedCalls: number): string | null {
    if (this.callCount + requestedCalls > this.options.maxCalls) {
      return `LLM call limit exceeded: ${this.callCount} + ${requestedCalls} > ${this.options.maxCalls}. Use Python code for aggregation instead of making more LLM calls.`;
    }

    this.callCount += requestedCalls;
    return null;
  }

  private async recordTrace(params: Omit<RecursiveCallTrace, 'call'>): Promise<void> {
    const call = this.callCount;
    const node: RecursiveCallTrace = {
      call,
      ...params,
    };

    this.trace.push(node);
    await this.options.emit({
      type: 'subquery.call',
      iteration: params.iteration,
      call,
      depth: params.depth,
      modelId: params.modelId,
      batched: params.batched,
      promptCount: params.promptCount,
    });
  }

  private async readJsonBody(req: IncomingMessage): Promise<Record<string, any> | null> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, any>;
    } catch {
      return null;
    }
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}
