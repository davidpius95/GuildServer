/**
 * Channel providers, with a mock transport: what each sends, what each refuses
 * to send to, and that failures never carry credentials.
 */
import { createHmac } from 'crypto';
import {
  DeliveryError,
  escapeHtml,
  sendToChannel,
  signWebhook,
  type Mailer,
  type OutgoingMessage,
  type ProviderDeps,
} from '../../src/services/notifications/providers';

const SLACK = 'https://hooks.slack.com/services/T0001/B0002/slackSecretToken123';
const DISCORD = 'https://discord.com/api/webhooks/123456789012/discord_Secret-Token';
const TG_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';

const msg = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  event: 'deployment_failed',
  title: 'shop deployment failed',
  message: 'Deployment failed: boom',
  severity: 'critical',
  url: 'https://app.example.com/dashboard/applications/1',
  occurredAt: '2026-09-11T00:00:00.000Z',
  ...over,
});

function setup(over: Partial<ProviderDeps> = {}) {
  const fetch = jest.fn().mockResolvedValue({ status: 200 });
  const deps: ProviderDeps = {
    fetch: fetch as unknown as typeof globalThis.fetch,
    mailer: null,
    env: {} as NodeJS.ProcessEnv,
    resolve: async () => [{ address: '93.184.216.34' }],
    now: () => 1_700_000_000_000,
    ...over,
  };
  return { deps, fetch: deps.fetch as unknown as jest.Mock };
}

const sentBody = (fetch: jest.Mock, call = 0) => JSON.parse(fetch.mock.calls[call][1].body);

async function failure(promise: Promise<unknown>): Promise<DeliveryError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DeliveryError);
    return error as DeliveryError;
  }
  throw new Error('expected the send to fail');
}

describe('slack', () => {
  it('posts to the webhook without following redirects, disarming Slack mentions and links', async () => {
    const { deps, fetch } = setup();
    await sendToChannel('slack', {}, { url: SLACK }, msg({ title: '<!channel> ping', message: 'see <https://evil.example|here> & more' }), deps);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(SLACK);
    expect(init.redirect).toBe('manual');
    const text = JSON.stringify(sentBody(fetch));
    expect(text).not.toContain('<!channel>');
    expect(text).not.toContain('<https://evil.example|here>');
    expect(text).toContain('&lt;!channel&gt;');
  });

  it.each([
    'https://hooks.slack.com.evil.example/services/T/B/X',
    'http://hooks.slack.com/services/T/B/X',
    'http://169.254.169.254/latest/meta-data',
    'https://example.com/services/T/B/X',
    'https://user@hooks.slack.com/services/T/B/X',
  ])('refuses %s without sending anything', async (url) => {
    const { deps, fetch } = setup();
    const error = await failure(sendToChannel('slack', {}, { url }, msg(), deps));
    expect(error.retryable).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('discord', () => {
  it('disables every mention and clips to Discord limits', async () => {
    const { deps, fetch } = setup();
    await sendToChannel('discord', {}, { url: DISCORD }, msg({ message: `@everyone ${'x'.repeat(5000)}` }), deps);
    const body = sentBody(fetch);
    expect(fetch.mock.calls[0][0]).toBe(DISCORD);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0].description.length).toBeLessThanOrEqual(4000);
  });

  it.each([
    'https://discord.com.evil.example/api/webhooks/1/x',
    'https://discord.com/api/webhooks/../../users/@me',
    'https://evil.example/api/webhooks/1/x',
  ])('refuses %s', async (url) => {
    const { deps, fetch } = setup();
    await failure(sendToChannel('discord', {}, { url }, msg(), deps));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('telegram', () => {
  it('sends plain text to the bot API for the configured chat', async () => {
    const { deps, fetch } = setup();
    await sendToChannel('telegram', { chatId: '-1001234567890' }, { botToken: TG_TOKEN }, msg(), deps);
    expect(fetch.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
    const body = sentBody(fetch);
    expect(body.chat_id).toBe('-1001234567890');
    expect(body.parse_mode).toBeUndefined();
    expect(body.text).toContain('shop deployment failed');
  });

  it.each([
    ['123:short', '-100'],
    [`${TG_TOKEN}/../../getUpdates?x=`, '-100'],
    [TG_TOKEN, 'hello world'],
    [TG_TOKEN, '@a'],
  ])('refuses token %j with chat %j', async (botToken, chatId) => {
    const { deps, fetch } = setup();
    await failure(sendToChannel('telegram', { chatId }, { botToken }, msg(), deps));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never repeats the bot token when the request fails', async () => {
    const { deps, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TG_TOKEN}/sendMessage`));
    const error = await failure(sendToChannel('telegram', { chatId: '-100123' }, { botToken: TG_TOKEN }, msg(), deps));
    expect(error.message).not.toContain(TG_TOKEN);
    expect(error.retryable).toBe(true);
  });
});

describe('webhook', () => {
  const HOOK = 'https://hooks.example.com/guildserver';

  it('signs the exact body it sends, with a timestamp', async () => {
    const { deps, fetch } = setup();
    const signingSecret = 'whsec_0123456789abcdef';
    await sendToChannel('webhook', {}, { url: HOOK, signingSecret }, msg({ data: { deploymentId: 'd1' } }), deps);

    const [, init] = fetch.mock.calls[0];
    const timestamp = init.headers['X-GuildServer-Timestamp'];
    expect(timestamp).toBe('1700000000');
    expect(init.headers['X-GuildServer-Event']).toBe('deployment_failed');
    const expected = `sha256=${createHmac('sha256', signingSecret).update(`${timestamp}.${init.body}`).digest('hex')}`;
    expect(init.headers['X-GuildServer-Signature']).toBe(expected);
    expect(signWebhook(signingSecret, timestamp, init.body)).toBe(expected);
    expect(JSON.parse(init.body)).toMatchObject({ event: 'deployment_failed', severity: 'critical', data: { deploymentId: 'd1' } });
  });

  it('sends no signature header without a signing secret', async () => {
    const { deps, fetch } = setup();
    await sendToChannel('webhook', {}, { url: HOOK }, msg(), deps);
    expect(fetch.mock.calls[0][1].headers['X-GuildServer-Signature']).toBeUndefined();
  });

  it.each([
    ['http://127.0.0.1:8080/hook', /loopback/],
    ['http://[::1]/hook', /loopback/],
    ['http://169.254.169.254/latest/meta-data', /link-local/],
    ['http://10.0.0.5/hook', /private/],
    ['file:///etc/passwd', /http or https/],
  ])('refuses %s', async (url, reason) => {
    const { deps, fetch } = setup();
    const error = await failure(sendToChannel('webhook', {}, { url }, msg(), deps));
    expect(error.message).toMatch(reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks every address a hostname resolves to', async () => {
    const { deps, fetch } = setup({ resolve: async () => [{ address: '93.184.216.34' }, { address: '169.254.169.254' }] });
    await expect(sendToChannel('webhook', {}, { url: HOOK }, msg(), deps)).rejects.toThrow(/link-local/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows private addresses only when the operator says so', async () => {
    const { deps, fetch } = setup({ resolve: async () => [{ address: '10.1.2.3' }], env: { GS_NOTIFY_ALLOW_PRIVATE_ENDPOINTS: '1' } as NodeJS.ProcessEnv });
    await sendToChannel('webhook', {}, { url: HOOK }, msg(), deps);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a short signing secret', async () => {
    const { deps } = setup();
    await expect(sendToChannel('webhook', {}, { url: HOOK, signingSecret: 'short' }, msg(), deps)).rejects.toThrow(/16 characters/);
  });
});

describe('response handling', () => {
  it.each([
    [500, true],
    [503, true],
    [429, true],
    [408, true],
    [400, false],
    [401, false],
    [404, false],
  ])('HTTP %i is retryable: %s', async (status, retryable) => {
    const { deps, fetch } = setup();
    fetch.mockResolvedValueOnce({ status });
    const error = await failure(sendToChannel('slack', {}, { url: SLACK }, msg(), deps));
    expect(error.retryable).toBe(retryable);
    expect(error.message).toContain(String(status));
    expect(error.message).not.toContain('slackSecretToken123');
  });

  it('does not follow a redirect', async () => {
    const { deps, fetch } = setup();
    fetch.mockResolvedValueOnce({ status: 302 });
    const error = await failure(sendToChannel('webhook', {}, { url: 'https://hooks.example.com/x' }, msg(), deps));
    expect(error.message).toMatch(/redirect/);
    expect(error.retryable).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a timeout as retryable', async () => {
    const { deps, fetch } = setup();
    fetch.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    const error = await failure(sendToChannel('discord', {}, { url: DISCORD }, msg(), deps));
    expect(error.message).toMatch(/timed out/);
    expect(error.retryable).toBe(true);
  });
});

describe('email', () => {
  function mailer(impl?: (options: any) => Promise<unknown>) {
    const sendMail = jest.fn(impl ?? (async () => ({ messageId: 'm1' })));
    return { mailer: { sendMail } as Mailer, sendMail };
  }

  it('escapes the title, message and link, and drops non-http links', async () => {
    const { mailer: m, sendMail } = mailer();
    const { deps } = setup({ mailer: m, env: { APP_URL: 'https://app.example.com', EMAIL_FROM: 'alerts@example.com' } as NodeJS.ProcessEnv });
    await sendToChannel(
      'email',
      { recipients: ['ops@example.com'] },
      {},
      msg({ title: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script>', url: 'javascript:alert(1)' }),
      deps,
    );
    const sent = sendMail.mock.calls[0][0];
    expect(sent.to).toEqual(['ops@example.com']);
    expect(sent.from).toBe('alerts@example.com');
    expect(sent.html).not.toMatch(/<script>|<img|javascript:/);
    expect(sent.html).toContain(escapeHtml('<script>alert(1)</script>'));
    expect(sent.html).toContain('https://app.example.com/dashboard/settings');
  });

  it('refuses when the server has no SMTP transport', async () => {
    const { deps } = setup({ mailer: null });
    await expect(sendToChannel('email', { recipients: ['ops@example.com'] }, {}, msg(), deps)).rejects.toThrow(/not configured/);
  });

  it.each([[['not-an-email']], [['a@example.com, b@example.com']], [Array.from({ length: 21 }, (_, i) => `u${i}@example.com`)]])(
    'refuses recipients %j',
    async (recipients) => {
      const { mailer: m, sendMail } = mailer();
      const { deps } = setup({ mailer: m });
      await expect(sendToChannel('email', { recipients }, {}, msg(), deps)).rejects.toThrow(/recipient/);
      expect(sendMail).not.toHaveBeenCalled();
    },
  );

  it('retries a temporary SMTP refusal but not a permanent one', async () => {
    const temporary = mailer(async () => {
      throw Object.assign(new Error('try later'), { responseCode: 451 });
    });
    const permanent = mailer(async () => {
      throw Object.assign(new Error('no such user'), { responseCode: 550 });
    });
    expect((await failure(sendToChannel('email', { recipients: ['a@example.com'] }, {}, msg(), setup({ mailer: temporary.mailer }).deps))).retryable).toBe(true);
    expect((await failure(sendToChannel('email', { recipients: ['a@example.com'] }, {}, msg(), setup({ mailer: permanent.mailer }).deps))).retryable).toBe(false);
  });
});
