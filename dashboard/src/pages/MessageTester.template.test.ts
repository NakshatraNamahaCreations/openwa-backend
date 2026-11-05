// Render test for the Message Tester's template send type, on the MessageTester.test.ts harness
// (jsdom loader hooks, providers, a fetch stub). The backend has carried POST /messages/send-template
// since templates shipped, but nothing in the dashboard called it; these cover the wiring.
import '../test-helpers/register-hooks.ts';
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type RTL = typeof import('@testing-library/react');

let rtl: RTL;
let MessageTester: typeof import('./MessageTester.tsx').MessageTester;
let RoleProvider: typeof import('../components/RoleProvider.tsx').RoleProvider;
let emptyFetch: typeof fetch;

const SESSION = { id: 's1', name: 'Main', status: 'ready', phone: '15550000000' };

const TEMPLATES = [
  {
    id: 't-order',
    sessionId: 's1',
    name: 'order-confirmation',
    header: 'OpenWA Store',
    body: 'Hi {{customer}}, order {{orderId}} ships on {{date}}.',
    footer: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 't-plain',
    sessionId: 's1',
    name: 'no-placeholders',
    header: null,
    body: 'We are closed today.',
    footer: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

before(async () => {
  const { installJsdomGlobals } = await import('../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  emptyFetch = ((): Promise<Response> =>
    Promise.resolve(new Response('[]', { headers: { 'Content-Type': 'application/json' } }))) as typeof fetch;
  globalThis.fetch = emptyFetch;
  const { i18nReady } = await import('../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  ({ RoleProvider } = await import('../components/RoleProvider.tsx'));
  ({ MessageTester } = await import('./MessageTester.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  globalThis.fetch = emptyFetch;
  window.sessionStorage.removeItem('openwa_user_role');
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

interface TemplateSendBody {
  chatId: string;
  templateId?: string;
  templateName?: string;
  vars?: Record<string, string>;
}

/** Stub the three calls a template send makes: sessions, the template list, and the send itself. */
function stubGateway(templates: unknown = TEMPLATES): { sent: TemplateSendBody[]; urls: string[] } {
  const sent: TemplateSendBody[] = [];
  const urls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url.endsWith('/sessions')) return Promise.resolve(jsonResponse([SESSION]));
    if (url.endsWith('/templates')) return Promise.resolve(jsonResponse(templates));
    if (url.endsWith('/messages/send-template')) {
      sent.push(JSON.parse(String(init?.body)) as TemplateSendBody);
      return Promise.resolve(jsonResponse({ messageId: 'true_1@c.us_ABC', timestamp: 1 }, 201));
    }
    // A bare recipient is resolved through check-number before any send.
    if (url.includes('/contacts/check')) {
      return Promise.resolve(jsonResponse({ number: '15551234567', exists: true, whatsappId: '15551234567@c.us' }));
    }
    return Promise.resolve(jsonResponse([]));
  }) as typeof fetch;
  return { sent, urls };
}

/** Render as a writer, switch to the Template type, and wait for the session list to settle. */
async function renderTemplateAsWriter(): Promise<HTMLElement> {
  window.sessionStorage.setItem('openwa_user_role', 'admin');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  const { container } = rtl.render(
    createElement(QueryClientProvider, { client }, createElement(RoleProvider, null, createElement(MessageTester))),
  );
  rtl.fireEvent.click(await rtl.screen.findByRole('button', { name: 'Template' }));
  await rtl.screen.findByRole('option', { name: /Main/ });
  return container;
}

function set(container: HTMLElement, selector: string, value: string): void {
  const element = container.querySelector(selector);
  assert.ok(element, `expected ${selector}`);
  rtl.fireEvent.change(element, { target: { value } });
}

function sendButton(): HTMLButtonElement {
  return rtl.screen.getByRole('button', { name: 'Send Message' }) as HTMLButtonElement;
}

test('a template send posts the chosen template id and the values typed for its placeholders', async () => {
  const { sent } = stubGateway();
  const container = await renderTemplateAsWriter();

  // The picker lists the session's templates by name.
  await rtl.screen.findByRole('option', { name: 'order-confirmation' });
  set(container, '#mt-template', 't-order');

  // One row per placeholder, sorted, read with the gateway's own pattern.
  const tokens = [...container.querySelectorAll('.template-var-token')].map(node => node.textContent);
  assert.deepEqual(tokens, ['{{customer}}', '{{date}}', '{{orderId}}']);

  set(container, '#mt-var-customer', 'Priya');
  set(container, '#mt-var-orderId', 'A-4821');
  // `date` deliberately left blank: the gateway keeps an unfilled placeholder literal.
  set(container, '#mt-13', '15551234567');

  await rtl.waitFor(() => assert.equal(sendButton().disabled, false));
  rtl.fireEvent.click(sendButton());

  await rtl.waitFor(() => assert.equal(sent.length, 1));
  assert.equal(sent[0].templateId, 't-order');
  // Addressed by id, never by name: the name may be edited between picking it and the send.
  assert.equal(sent[0].templateName, undefined);
  // The blank one is dropped rather than sent as '', which would blank the placeholder instead.
  assert.deepEqual(sent[0].vars, { customer: 'Priya', orderId: 'A-4821' });
});

test('a template with no placeholders sends without a vars object', async () => {
  const { sent } = stubGateway();
  const container = await renderTemplateAsWriter();

  await rtl.screen.findByRole('option', { name: 'no-placeholders' });
  set(container, '#mt-template', 't-plain');
  assert.equal(container.querySelectorAll('.template-var-token').length, 0);
  rtl.screen.getByText('This template has no placeholders.');

  set(container, '#mt-13', '15551234567');
  await rtl.waitFor(() => assert.equal(sendButton().disabled, false));
  rtl.fireEvent.click(sendButton());

  await rtl.waitFor(() => assert.equal(sent.length, 1));
  assert.equal(sent[0].templateId, 't-plain');
  assert.equal(sent[0].vars, undefined);
});

test('the send stays disabled until a template is chosen', async () => {
  stubGateway();
  await renderTemplateAsWriter();
  await rtl.screen.findByRole('option', { name: 'order-confirmation' });
  // A recipient alone is not enough — there is nothing to render yet.
  assert.equal(sendButton().disabled, true);
});

test('a session with no templates says so instead of offering an empty picker', async () => {
  stubGateway([]);
  const container = await renderTemplateAsWriter();
  await rtl.screen.findByText('Create one on the Templates page first.');
  const picker = container.querySelector<HTMLSelectElement>('#mt-template');
  assert.ok(picker);
  assert.equal(picker.disabled, true);
});

test('switching away from the template type stops fetching the template list', async () => {
  const { urls } = stubGateway();
  await renderTemplateAsWriter();
  await rtl.screen.findByRole('option', { name: 'order-confirmation' });
  const before = urls.filter(url => url.endsWith('/templates')).length;
  assert.ok(before > 0, 'the list is fetched while composing a template send');

  rtl.fireEvent.click(rtl.screen.getByRole('button', { name: 'Text' }));
  await rtl.waitFor(() => assert.equal(document.querySelector('#mt-template'), null));
  assert.equal(urls.filter(url => url.endsWith('/templates')).length, before);
});
