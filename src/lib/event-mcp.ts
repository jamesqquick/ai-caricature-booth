import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import {
  createCompleteEvent,
  getCompleteEvent,
  listEvents,
} from './event-service';
import {
  CompleteEventValidationError,
  EventSlugConflictError,
} from './event-validation';
type EventMcpEnv = Pick<Env, 'DB'>;

const eventStatusSchema = z.enum(['draft', 'active', 'archived']);
const eventSummarySchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  name: z.string(),
  status: eventStatusSchema,
  createdAt: z.number().int(),
});
const sceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
});
const watermarkOutputSchema = z.object({
  contentType: z.literal('image/png'),
  width: z.number().int().nullable(),
});
const completeEventSchema = eventSummarySchema.extend({
  accentColor: z.string(),
  tagline: z.string(),
  kioskIdleSubhead: z.string(),
  scenePickerHeading: z.string(),
  sceneStylePreamble: z.string().nullable(),
  sceneConstraints: z.string().nullable(),
  scenes: z.array(sceneSchema),
  watermark: watermarkOutputSchema.nullable(),
});
const eventCursorSchema = z.object({
  createdAt: z.number().int().nonnegative(),
  id: z.number().int().positive(),
});

export function createEventMcpServer(env: EventMcpEnv) {
  const server = new McpServer({ name: 'ai-caricature-booth-events', version: '1.0.0' });

  server.registerTool(
    'list_events',
    {
      description: 'List caricature booth events, optionally filtered by status.',
      inputSchema: z.object({
        status: eventStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).optional().default(50),
        cursor: eventCursorSchema.optional(),
      }),
      outputSchema: z.object({
        events: z.array(eventSummarySchema),
        nextCursor: eventCursorSchema.nullable(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ status, limit, cursor }) => safeToolResult(async () => {
      const events = await listEvents(env.DB, status, { limit: limit + 1, cursor });
      const hasNextPage = events.length > limit;
      const page = hasNextPage ? events.slice(0, limit) : events;
      const lastEvent = page.at(-1);
      return {
        events: page,
        nextCursor: hasNextPage && lastEvent
          ? { createdAt: lastEvent.createdAt, id: lastEvent.id }
          : null,
      };
    }),
  );

  server.registerTool(
    'get_event',
    {
      description: 'Get an event with its branding, prompts, scenes, and watermark metadata.',
      inputSchema: z.object({
        slug: z.string().min(1),
      }),
      outputSchema: z.object({ event: completeEventSchema }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ slug }) => safeToolResult(async () => {
      const event = await getCompleteEvent(env.DB, slug);
      if (!event) throw new EventNotFoundError(slug);
      return { event };
    }),
  );

  server.registerTool(
    'create_event',
    {
      description: 'Create a complete event with branding, prompts, and scenes. Add watermark images through the admin application.',
      inputSchema: z.object({
        name: z.string(),
        slug: z.string(),
        status: eventStatusSchema.optional().default('draft'),
        accentColor: z.string(),
        tagline: z.string(),
        kioskIdleSubhead: z.string(),
        scenePickerHeading: z.string(),
        sceneStylePreamble: z.string().nullable().optional().default(null),
        sceneConstraints: z.string().nullable().optional().default(null),
        scenes: z.array(sceneSchema),
      }).strict(),
      outputSchema: z.object({ event: completeEventSchema }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => safeToolResult(async () => {
      const event = await createCompleteEvent(
        { database: env.DB, createdBy: 'mcp-event-tools' },
        input,
      );
      return { event };
    }),
  );

  return server;
}

export function handleEventMcpRequest(request: Request, env: EventMcpEnv, context: ExecutionContext) {
  const handler = createMcpHandler(() => createEventMcpServer(env), { route: '/mcp' });
  return handler(request, env, context);
}

class EventNotFoundError extends Error {
  name = 'EventNotFoundError';

  constructor(public readonly slug: string) {
    super(`Event not found: ${slug}`);
  }
}

async function safeToolResult<T extends Record<string, unknown>>(operation: () => Promise<T>) {
  try {
    const structuredContent = await operation();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }],
      structuredContent,
    };
  } catch (error) {
    const message = safeErrorMessage(error);
    return {
      content: [{ type: 'text' as const, text: message }],
      isError: true,
    };
  }
}

function safeErrorMessage(error: unknown) {
  if (error instanceof CompleteEventValidationError) {
    return `Event configuration is invalid: ${JSON.stringify(error.fields)}`;
  }
  if (error instanceof EventSlugConflictError) return error.message;
  if (error instanceof EventNotFoundError) return error.message;
  return 'The event operation failed.';
}
