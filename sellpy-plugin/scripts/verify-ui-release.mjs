import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

// Check an already built/deployed UI patch without repeating native marketplace
// searches or modifying saved research. No private endpoint enters the receipt.
const connection = JSON.parse(await readFile(process.env.SELLPY_CONNECTION_FILE ?? 'artifacts/private/connection.json', 'utf8'));
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const html = await readFile('ui/generated/gallery.html', 'utf8');
const digest = text => createHash('sha256').update(text).digest('hex');
const report = { checked_at: new Date().toISOString(), version, outcome: 'running' };
const client = new Client({ name: 'sellpy-ui-release-verification', version }, { versionNegotiation: { mode: 'auto' } });
try {
  const origin = new URL(connection.endpoint).origin;
  assert.equal((await (await fetch(`${origin}/health`)).json()).version, version);
  assert.equal((await fetch(`${origin}/mcp`)).status, 401);
  await client.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint)));
  assert.equal(client.getServerVersion()?.version, version);
  assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 27);
  assert.deepEqual(tools.find(tool => tool.name === 'browse_collection')?._meta?.ui?.visibility, ['app']);
  const resourceUri = tools.find(tool => tool.name === 'present_items')?._meta?.ui?.resourceUri;
  assert.equal(resourceUri, 'ui://sellpy/gallery-v4.html');
  const resources = [];
  for (const uri of [resourceUri, 'ui://sellpy/gallery-v3.html', 'ui://sellpy/gallery-v2.html']) {
    const resource = await client.readResource({ uri });
    assert.equal(resource.contents.length, 1);
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.equal(resource.contents[0].text, html);
    resources.push({ uri, bytes: Buffer.byteLength(html), sha256: digest(html) });
  }
  Object.assign(report, { outcome: 'passed', protocol: client.getNegotiatedProtocolVersion(), tools: tools.length,
    model_tools: 26, app_only_tools: 1, private_auth_preserved: true, resources, completed_at: new Date().toISOString() });
} catch (error) {
  report.outcome = 'failed';
  report.error = String(error).replaceAll(connection.endpoint, '[private endpoint]').replaceAll(connection.token, '[private token]');
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  await writeFile('artifacts/private/ui-release-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
