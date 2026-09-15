/**
 * The model, behind an interface (doc 17 §10).
 *
 * Two providers ship. Which one runs is configuration, and the answer says
 * which one produced it — a facility reading an insight should never have to
 * guess whether a language model was involved.
 *
 * `DeterministicNarrator` is not a stub standing in for a real feature. It is a
 * provider that writes the summary from the retrieved figures by template. It
 * states no figure that is not in the context, because it has no way to invent
 * one, and it works with no internet and no API key — which in Isi-Uzo is not a
 * hypothetical. It is the default.
 *
 * `AnthropicProvider` calls a language model. It is selected explicitly and
 * needs a key. Its output goes through exactly the same grounding validation,
 * because the point of that check is that it does not trust the model.
 */

export interface LlmRequest {
  prompt: string;
  /** The retrieved rows, for a provider that composes rather than generates. */
  context: unknown;
  maxTokens?: number;
}

export interface LlmResponse {
  content: string;
  modelId: string;
  modelVersion: string | null;
  tokenUsage: { input: number; output: number } | null;
  /** True when a language model produced this text. */
  languageModelUsed: boolean;
}

export interface LlmProvider {
  readonly id: string;
  readonly modelId: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

// -----------------------------------------------------------------------------
// The default: no model, no network, no invention
// -----------------------------------------------------------------------------

interface NarratableFigure {
  label: string;
  value: number | string | null;
  unit?: string | null;
  note?: string | null;
}

export class DeterministicNarrator implements LlmProvider {
  readonly id = 'deterministic';
  readonly modelId = 'deterministic/narrator@v1';

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const content = narrate(request.context);

    return {
      content,
      modelId: this.modelId,
      modelVersion: 'v1',
      tokenUsage: null,
      languageModelUsed: false,
    };
  }
}

/**
 * Compose prose from the retrieved figures.
 *
 * Every line is built around a value taken directly from the context, so the
 * result passes grounding validation by construction rather than by luck.
 *
 * Note what this function must NOT do: state how many figures it is about to
 * list. "5 figures were returned" is a number the queries never produced, and
 * the validator rejects it — correctly, because a narrator that may count is a
 * narrator that may miscount. Counts are written in words or left out.
 *
 * Where a figure is absent it says so. The one thing a summary must never do is
 * quietly leave out what it could not find.
 */
function narrate(context: unknown): string {
  const figures = extractFigures(context);

  if (figures.length === 0) {
    return (
      'The approved queries returned no figures for this facility and period, so there is nothing to ' +
      'summarise. That is a statement about the records, not about the facility: it may mean nothing ' +
      'happened, or it may mean nothing was written down.'
    );
  }

  const stated = figures.filter((figure) => figure.value !== null && figure.value !== '');
  const missing = figures.filter((figure) => figure.value === null || figure.value === '');

  const lines: string[] = [];

  lines.push('Figures returned for this period:');
  lines.push('');

  for (const figure of stated) {
    lines.push(
      `  - ${figure.label}: ${figure.value}${figure.unit ? ` ${figure.unit}` : ''}` +
        (figure.note ? ` — ${figure.note}` : ''),
    );
  }

  if (stated.length === 0) {
    lines.push('  (none of them could be computed)');
  }

  if (missing.length > 0) {
    lines.push('');
    lines.push(
      'These could not be computed and are named rather than omitted: ' +
        `${missing.map((figure) => figure.label).join(', ')}. An absent figure is not a zero.`,
    );
  }

  lines.push('');
  lines.push(
    'Composed from the figures above by a fixed template. No language model was used, and nothing ' +
      'here was inferred: each line restates a value the approved queries returned.',
  );

  return lines.join('\n');
}

function extractFigures(context: unknown, into: NarratableFigure[] = []): NarratableFigure[] {
  if (Array.isArray(context)) {
    for (const item of context) extractFigures(item, into);
    return into;
  }

  if (context && typeof context === 'object') {
    const record = context as Record<string, unknown>;

    // A shape the dashboard and KPI layers already produce.
    const label = record.label ?? record.name ?? record.code;
    const hasValue = 'value' in record;

    if (typeof label === 'string' && hasValue) {
      const value = record.value;
      into.push({
        label,
        value:
          typeof value === 'number' || typeof value === 'string'
            ? value
            : value === null || value === undefined
              ? null
              : String(value),
        unit: typeof record.unit === 'string' ? record.unit : null,
        note: typeof record.note === 'string' ? record.note : null,
      });
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') extractFigures(value, into);
    }
  }

  return into;
}

// -----------------------------------------------------------------------------
// A provider that deliberately fails validation
// -----------------------------------------------------------------------------

/**
 * Returns a fixed answer containing a figure that is not in the context.
 *
 * This is not a feature and it is not a stand-in for one. It exists so that the
 * rejection path can be proved end to end against a running system: the
 * acceptance criterion is that a response containing an ungrounded figure is
 * rejected, and a criterion nobody exercises is a comment.
 *
 * The environment schema refuses it in production. It is named for what it is,
 * so nobody selects it expecting an assistant.
 */
export class UngroundedProbeProvider implements LlmProvider {
  readonly id = 'ungrounded-probe';
  readonly modelId = 'probe/ungrounded@v1';

  async generate(): Promise<LlmResponse> {
    return {
      content:
        'Attendance rose by 47% this period and revenue reached 8675309 naira, the best month on record.',
      modelId: this.modelId,
      modelVersion: 'v1',
      tokenUsage: null,
      languageModelUsed: false,
    };
  }
}

// -----------------------------------------------------------------------------
// A language model, for facilities that want one and can reach it
// -----------------------------------------------------------------------------

export interface AnthropicOptions {
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly modelId: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: AnthropicOptions) {
    if (!options.apiKey) {
      // Refused at construction rather than at the first request, so a
      // misconfigured deployment fails when it starts and not when somebody
      // asks a question.
      throw new Error(
        'The Anthropic provider was selected without an API key. Set AI_API_KEY, or leave AI_PROVIDER ' +
          'as "deterministic", which needs no key and no network.',
      );
    }

    this.apiKey = options.apiKey;
    this.modelId = options.modelId;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.modelId,
          max_tokens: request.maxTokens ?? 1024,
          // No tools, deliberately. On this path the model receives text and
          // returns text; it cannot retrieve, call or reach anything (doc 17 §5).
          messages: [{ role: 'user', content: request.prompt }],
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `The model provider returned ${response.status}. ${detail.slice(0, 300)}`.trim(),
        );
      }

      const body = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const content = (body.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim();

      return {
        content,
        modelId: this.modelId,
        modelVersion: body.model ?? null,
        tokenUsage: {
          input: body.usage?.input_tokens ?? 0,
          output: body.usage?.output_tokens ?? 0,
        },
        languageModelUsed: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
