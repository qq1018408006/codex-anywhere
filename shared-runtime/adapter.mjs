import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
const require = createRequire(import.meta.url);
const WebSocket = require('./vendor/ws');

export async function rpc(socketPath) {
  const ws = new WebSocket('ws://localhost/rpc', {
    createConnection: () => net.createConnection(socketPath),
    perMessageDeflate: false,
    maxPayload: 100 * 1024 * 1024,
  });
  const pending = new Map();
  const events = [];
  let nextId = 0;
  ws.on('message', data => {
    const message = JSON.parse(String(data));
    if (!message.method && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(item.timer);
      message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result);
    } else events.push(message);
  });
  ws.on('close', () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(Error('app-server disconnected'));
    }
    pending.clear();
  });
  await new Promise((resolve, reject) => {ws.once('open', resolve); ws.once('error', reject);});
  // Keep an error listener after initialization as well.
  ws.on('error', () => {});
  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {pending.delete(id); reject(Error(`RPC timeout: ${method}`));}, 15000);
      pending.set(id, {resolve, reject, timer});
      ws.send(JSON.stringify({id, method, params}));
    });
  }
  const initialize = await request('initialize', {
    clientInfo: {name: 'codex_runtime_share', version: '0.1.1'},
    capabilities: {experimentalApi: true},
  });
  ws.send(JSON.stringify({method: 'initialized'}));
  return {ws, request, events, initialize};
}

export async function inspect(socketPath) {
  const client = await rpc(socketPath);
  try {
    const threads = [];
    let cursor;
    do {
      const response = await client.request('thread/loaded/list', {limit: 100, ...(cursor ? {cursor} : {})});
      for (const id of response.data) {
        const {thread} = await client.request('thread/read', {threadId: id, includeTurns: false});
        threads.push({id, status: thread.status?.type ?? thread.status});
      }
      cursor = response.nextCursor;
    } while (cursor);
    return {userAgent: client.initialize.userAgent, threads, busy: threads.filter(t => !['idle', 'notLoaded'].includes(t.status))};
  } finally {client.ws.close();}
}

async function featureValues(client, names) {
  const features = {};
  let cursor;
  do {
    const response = await client.request('experimentalFeature/list', {limit: 100, ...(cursor ? {cursor} : {})});
    for (const item of response.data) {
      if (names.includes(item.name)) features[item.name] = item.enabled;
    }
    cursor = response.nextCursor;
  } while (cursor);
  return features;
}

export async function reconcileFeatures(socketPath, policy) {
  const supported = ['api_key_model_discovery', 'auth_elicitation', 'code_mode_host', 'mcp_oauth_refresh_coordination'];
  const names = Object.keys(policy);
  if (!names.length || names.some(name => !supported.includes(name) || typeof policy[name] !== 'boolean')) {
    throw Error('Invalid shared feature policy');
  }
  const client = await rpc(socketPath);
  try {
    const before = await featureValues(client, names);
    const missing = names.filter(name => !(name in before));
    if (missing.length) throw Error('Daemon cannot report shared feature settings: ' + missing.join(', '));
    const changed = Object.fromEntries(names.filter(name => before[name] !== policy[name]).map(name => [name, policy[name]]));
    // Only these compatibility flags have an official live update implementation.
    // Never restart a daemon to change process-scoped features in this monitor.
    const unsupported = Object.keys(changed).filter(name => !['api_key_model_discovery', 'auth_elicitation'].includes(name));
    if (unsupported.length) throw Error('Shared features require an idle version/config alignment; runtime was left running: ' + unsupported.join(', '));
    if (Object.keys(changed).length) {
      const response = await client.request('experimentalFeature/enablement/set', {enablement: changed});
      if (Object.keys(changed).some(name => response.enablement?.[name] !== changed[name])) {
        throw Error('Daemon did not accept shared feature settings');
      }
    }
    const after = Object.keys(changed).length ? await featureValues(client, names) : before;
    if (names.some(name => after[name] !== policy[name])) throw Error('Shared feature readback does not match CLI policy');
    return {policy, before, changed, after};
  } finally {client.ws.close();}
}

function stdioProxy(socketPath) {
  const limit = 100 * 1024 * 1024;
  const ws = new WebSocket('ws://localhost/rpc', {
    createConnection: () => net.createConnection(socketPath),
    perMessageDeflate: false, maxPayload: limit,
  });
  let partial = '';
  const queue = [];
  let queuedBytes = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    partial += chunk;
    if (Buffer.byteLength(partial) > limit) {console.error('Proxy input exceeds message limit'); ws.terminate(); return;}
    let newline;
    while ((newline = partial.indexOf('\n')) !== -1) {
      const line = partial.slice(0, newline).replace(/\r$/, '');
      partial = partial.slice(newline + 1);
      if (!line) continue;
      if (ws.readyState === WebSocket.OPEN) ws.send(line);
      else {
        queuedBytes += Buffer.byteLength(line);
        if (queuedBytes > limit) {console.error('Proxy startup queue exceeds limit'); ws.terminate(); return;}
        queue.push(line);
      }
    }
  });
  ws.on('open', () => {for (const line of queue) ws.send(line); queue.length = 0; queuedBytes = 0;});
  ws.on('message', data => {if (!process.stdout.write(String(data) + '\n')) ws.pause();});
  process.stdout.on('drain', () => ws.resume());
  process.stdin.on('end', () => ws.close());
  ws.on('error', e => {console.error('Shared runtime proxy:', e.message); process.exitCode = 1;});
  ws.on('close', () => {process.stdin.destroy();});
  process.once('SIGTERM', () => {ws.terminate(); process.stdin.destroy();});
  process.once('SIGINT', () => {ws.terminate(); process.stdin.destroy();});
}

async function gateway(config) {
  const metadata = [];
  const clients = new Map();
  const activeSockets = new Set();
  let sequence = 0;
  const server = http.createServer(async (req, res) => {
    if (req.headers.origin || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(403).end(); return;
    }
    if (req.url !== '/healthz') {res.writeHead(404).end(); return;}
    try {
      const runtime = await inspect(config.socket);
      const toolTarget = fs.existsSync(config.toolsPipe) ? fs.realpathSync(config.toolsPipe) : null;
      res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify({runtime, clients: [...clients.values()], appToolsConnected: Boolean(toolTarget),
        desktopToolsConnected: Boolean(toolTarget?.startsWith('/tmp/codex-browser-use/')),
        toolProvider: !toolTarget ? null : toolTarget === config.planAToolsPipe ? 'plan-a' : 'desktop', metadata}));
    } catch (e) {res.writeHead(503, {'Content-Type': 'application/json'}).end(JSON.stringify({error: e.message}));}
  });
  const wss = new WebSocket.Server({noServer: true, maxPayload: 100 * 1024 * 1024, perMessageDeflate: false});
  server.on('upgrade', (req, socket, head) => {
    if (req.headers.origin) {socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;}
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', incoming => {
    const id = ++sequence;
    const outgoing = new WebSocket('ws://localhost/rpc', {
      createConnection: () => net.createConnection(config.socket),
      perMessageDeflate: false,
      maxPayload: 100 * 1024 * 1024,
    });
    const info = {id, name: 'initializing'};
    clients.set(id, info);
    activeSockets.add(incoming); activeSockets.add(outgoing);
    const queue = [];
    let queuedBytes = 0;
    function record(data, direction) {
      try {
        const m = JSON.parse(String(data));
        if (direction === 'client_to_runtime' && m.method === 'initialize') info.name = m.params?.clientInfo?.name ?? 'unknown';
        const entry = {at: new Date().toISOString(), client: info.name, direction, id: m.id, method: m.method,
          threadId: m.params?.threadId, turnId: m.params?.turnId ?? m.params?.turn?.id,
          decision: m.result?.decision};
        metadata.push(entry);
        if (metadata.length > 1000) metadata.shift();
      } catch { /* The runtime owns protocol validation. */ }
    }
    incoming.on('message', (data, binary) => {
      record(data, 'client_to_runtime');
      if (outgoing.readyState === WebSocket.OPEN) outgoing.send(data, {binary});
      else {
        queuedBytes += data.length;
        if (queuedBytes > 100 * 1024 * 1024) {incoming.close(1009); outgoing.terminate(); return;}
        queue.push([data, binary]);
      }
    });
    outgoing.on('open', () => {for (const [data, binary] of queue) outgoing.send(data, {binary}); queue.length = 0;});
    outgoing.on('message', (data, binary) => {record(data, 'runtime_to_client'); if (incoming.readyState === WebSocket.OPEN) incoming.send(data, {binary});});
    incoming.on('error', () => outgoing.terminate());
    outgoing.on('error', () => incoming.close(1011, 'Shared runtime unavailable'));
    incoming.on('close', () => {clients.delete(id); outgoing.close(); activeSockets.delete(incoming);});
    outgoing.on('close', () => {incoming.close(); activeSockets.delete(outgoing);});
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve);});
  console.log(`Shared runtime gateway listening on 127.0.0.1:${config.port}`);
  let stopping = false;
  let probing = false;
  const monitor = setInterval(async () => {
    if (stopping || probing) return;
    probing = true;
    try {
      await new Promise(resolve => {
        execFile(config.python, [config.package + '/manager.py', 'ensure', '--state', config.state],
          {timeout: 60000}, (error, stdout, stderr) => {
            if (error) console.error('Daemon check:', stderr.trim() || error.message);
            resolve();
          });
      });
    } finally {probing = false;}
  }, 10000);
  function stop() {
    if (stopping) return; stopping = true;
    clearInterval(monitor);
    for (const socket of activeSockets) socket.terminate();
    wss.close(); server.close();
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [command, argument, policy] = process.argv.slice(2);
  try {
    if (command === 'inspect') console.log(JSON.stringify(await inspect(argument)));
    else if (command === 'features') console.log(JSON.stringify(await reconcileFeatures(argument, JSON.parse(policy))));
    else if (command === 'proxy') stdioProxy(argument);
    else if (command === 'serve') await gateway(JSON.parse(fs.readFileSync(argument, 'utf8')));
    else throw Error('Usage: adapter.mjs inspect SOCKET | features SOCKET POLICY_JSON | proxy SOCKET | serve CONFIG');
  } catch (e) {console.error(e.message); process.exitCode = 1;}
}
