import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/event-service', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/event-service')>(),
  createCompleteEvent: vi.fn(),
  getCompleteEvent: vi.fn(),
  listEvents: vi.fn(),
}));

import { createEventMcpServer, handleEventMcpRequest } from '../src/lib/event-mcp';
import { createCompleteEvent, getCompleteEvent, listEvents } from '../src/lib/event-service';

const eventSummary = {
  id: 7,
  slug: 'launch-party',
  name: 'Launch Party',
  status: 'active' as const,
  createdAt: 1_800_000_000,
};

const completeEvent = {
  ...eventSummary,
  accentColor: '#ff5500',
  tagline: 'Drawn live.',
  kioskIdleSubhead: 'Tap to begin.',
  scenePickerHeading: 'Choose a scene',
  sceneStylePreamble: 'Use bold ink lines.',
  sceneConstraints: null,
  scenes: [{
    id: 'city',
    name: 'City',
    description: 'A city skyline.',
    prompt: 'Draw the guest over a city skyline.',
  }],
  watermark: null,
};

describe('event MCP server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listEvents).mockResolvedValue([eventSummary]);
    vi.mocked(getCompleteEvent).mockResolvedValue(completeEvent);
    vi.mocked(createCompleteEvent).mockResolvedValue(completeEvent);
  });

  it('initializes and advertises the event tools', async () => {
    const client = await createClient();

    const initialized = await client.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });
    expect(initialized).toMatchObject({
      serverInfo: { name: 'ai-caricature-booth-events', version: '1.0.0' },
      capabilities: { tools: {} },
    });

    await client.notify('notifications/initialized');
    const result = await client.request('tools/list');
    expect(result).toMatchObject({
      tools: [
        { name: 'list_events' },
        { name: 'get_event' },
        { name: 'create_event' },
      ],
    });

    await client.close();
  });

  it('lists events through the event service', async () => {
    const client = await initializedClient();

    const result = await client.callTool('list_events', { status: 'active' });

    expect(listEvents).toHaveBeenCalledWith(client.env.DB, 'active', { limit: 51, cursor: undefined });
    expect(result).toMatchObject({
      structuredContent: { events: [eventSummary], nextCursor: null },
    });
    await client.close();
  });

  it('returns a bounded page and cursor when more events are available', async () => {
    const olderEvent = { ...eventSummary, id: 6, slug: 'older-event', createdAt: eventSummary.createdAt - 1 };
    vi.mocked(listEvents).mockResolvedValue([eventSummary, olderEvent]);
    const client = await initializedClient();

    const result = await client.callTool('list_events', { limit: 1 });

    expect(listEvents).toHaveBeenCalledWith(client.env.DB, undefined, { limit: 2, cursor: undefined });
    expect(result).toMatchObject({
      structuredContent: {
        events: [eventSummary],
        nextCursor: { createdAt: eventSummary.createdAt, id: eventSummary.id },
      },
    });
    await client.close();
  });

  it('gets a complete event with watermark metadata', async () => {
    vi.mocked(getCompleteEvent).mockResolvedValue({
      ...completeEvent,
      watermark: {
        contentType: 'image/png',
        width: 620,
      },
    });
    const client = await initializedClient();

    const result = await client.callTool('get_event', {
      slug: 'launch-party',
    });

    expect(getCompleteEvent).toHaveBeenCalledWith(client.env.DB, 'launch-party');
    expect(result).toMatchObject({
      structuredContent: {
        event: {
          watermark: {
            contentType: 'image/png',
            width: 620,
          },
        },
      },
    });
    await client.close();
  });

  it('creates a complete event without binary asset handling', async () => {
    const client = await initializedClient();
    const input = {
      name: 'Launch Party',
      slug: 'launch-party',
      status: 'active',
      accentColor: '#ff5500',
      tagline: 'Drawn live.',
      kioskIdleSubhead: 'Tap to begin.',
      scenePickerHeading: 'Choose a scene',
      sceneStylePreamble: null,
      sceneConstraints: null,
      scenes: completeEvent.scenes,
    };

    const result = await client.callTool('create_event', input);

    expect(createCompleteEvent).toHaveBeenCalledWith({
      database: client.env.DB,
      createdBy: 'mcp-event-tools',
    }, input);
    expect(result).toMatchObject({ structuredContent: { event: completeEvent } });
    await client.close();
  });

  it('returns validation and not-found failures as safe tool errors', async () => {
    const client = await initializedClient();

    const invalid = await client.callTool('list_events', { status: 'invalid' });
    expect(invalid).toMatchObject({ isError: true });
    expect(JSON.stringify(invalid)).not.toContain('stack');

    vi.mocked(getCompleteEvent).mockResolvedValue(null);
    const missing = await client.callTool('get_event', { slug: 'missing-event' });
    expect(missing).toMatchObject({ isError: true });
    expect(JSON.stringify(missing)).toContain('Event not found');
    await client.close();
  });

  it('rejects watermark input instead of silently discarding it', async () => {
    const client = await initializedClient();

    const result = await client.callTool('create_event', {
      name: 'Launch Party',
      slug: 'launch-party',
      accentColor: '#ff5500',
      tagline: 'Drawn live.',
      kioskIdleSubhead: 'Tap to begin.',
      scenePickerHeading: 'Choose a scene',
      scenes: [],
      watermark: { dataBase64: 'iVBORw==', width: 620 },
    });

    expect(result).toMatchObject({ isError: true });
    expect(createCompleteEvent).not.toHaveBeenCalled();
    await client.close();
  });

  it('does not expose unexpected service errors', async () => {
    vi.mocked(listEvents).mockRejectedValue(new Error('database password leaked'));
    const client = await initializedClient();

    const result = await client.callTool('list_events', {});

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain('The event operation failed.');
    expect(JSON.stringify(result)).not.toContain('database password leaked');
    await client.close();
  });

  it('initializes through the real stateless HTTP handler', async () => {
    const response = await handleEventMcpRequest(
      new Request('https://booth.test/mcp', {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'http-test-client', version: '1.0.0' },
          },
        }),
      }),
      { DB: {} as D1Database },
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    const data = body.split('\n').find(line => line.startsWith('data: '));
    expect(data).toBeDefined();
    expect(JSON.parse(data!.slice(6))).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { serverInfo: { name: 'ai-caricature-booth-events', version: '1.0.0' } },
    });
  });
});

async function createClient() {
  const env = { DB: {} as D1Database };
  const server = createEventMcpServer(env);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let nextId = 1;
  const responses = new Map<number, (message: JSONRPCMessage) => void>();
  clientTransport.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') responses.get(message.id)?.(message);
  };
  await Promise.all([clientTransport.start(), server.connect(serverTransport)]);

  return {
    env,
    async request(method: string, params?: Record<string, unknown>) {
      const id = nextId++;
      const response = new Promise<JSONRPCMessage>((resolve) => responses.set(id, resolve));
      await clientTransport.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      const message = await response;
      responses.delete(id);
      if ('error' in message) throw new Error(message.error.message);
      if (!('result' in message)) throw new Error(`MCP request ${method} returned no result.`);
      return message.result;
    },
    async notify(method: string, params?: Record<string, unknown>) {
      await clientTransport.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
    },
    async callTool(name: string, args: Record<string, unknown>) {
      return this.request('tools/call', { name, arguments: args });
    },
    async close() {
      await Promise.all([clientTransport.close(), server.close()]);
    },
  };
}

async function initializedClient() {
  const client = await createClient();
  await client.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });
  await client.notify('notifications/initialized');
  return client;
}
