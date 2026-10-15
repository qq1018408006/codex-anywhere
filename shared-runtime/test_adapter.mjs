import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {reconcileFeatures} from './adapter.mjs';
const require = createRequire(import.meta.url);
const WebSocket = require('./vendor/ws');
const adapter = fileURLToPath(new URL('./adapter.mjs', import.meta.url));

test('stdio adapter preserves string IDs, Unicode and multiple JSON lines over a real Unix WebSocket', {timeout: 10000}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-share-proxy-test-'));
  const socket = path.join(root, 'runtime.sock');
  const server = http.createServer();
  const wss = new WebSocket.Server({server});
  const requests = [];
  wss.on('connection', ws => ws.on('message', data => {
    const message = JSON.parse(String(data)); requests.push(message);
    ws.send(JSON.stringify({id: message.id, result: message.params}));
  }));
  server.listen(socket); await once(server, 'listening');
  const child = spawn(process.execPath, [adapter, 'proxy', socket], {stdio: ['pipe', 'pipe', 'pipe']});
  let output = ''; let error = '';
  child.stdout.on('data', data => {output += data;});
  child.stderr.on('data', data => {error += data;});
  const payloads = [{id: '__codex_initialize__', method: 'initialize', params: {text: '中文\nnext line'}},
    {id: 7, method: 'thread/read', params: {threadId: 'same-runtime'}}];
  child.stdin.write(payloads.map(m => JSON.stringify(m)).join('\n') + '\n');
  try {
    const deadline = Date.now() + 5000;
    while (output.trim().split('\n').length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(requests, payloads);
    assert.deepEqual(output.trim().split('\n').map(JSON.parse), payloads.map(m => ({id: m.id, result: m.params})));
    assert.equal(error, '');
  } finally {
    child.kill(); await once(child, 'close');
    for (const ws of wss.clients) ws.terminate();
    await new Promise(r => wss.close(r)); await new Promise(r => server.close(r));
    fs.rmSync(root, {recursive: true});
  }
});

test('unavailable daemon makes the adapter fail instead of starting another runtime', {timeout: 10000}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-share-proxy-test-'));
  const child = spawn(process.execPath, [adapter, 'proxy', path.join(root, 'absent.sock')], {stdio: ['pipe', 'pipe', 'pipe']});
  let error = '';
  child.stderr.on('data', data => {error += data;});
  const [code] = await once(child, 'close');
  assert.equal(code, 1); assert.match(error, /Shared runtime proxy/);
  assert.deepEqual(fs.readdirSync(root), []);
  fs.rmdirSync(root);
});

async function withFeatureServer(features, callback, accept = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-share-feature-test-'));
  const socket = path.join(root, 'runtime.sock');
  const server = http.createServer();
  const wss = new WebSocket.Server({server});
  const mutations = [];
  wss.on('connection', ws => ws.on('message', data => {
    const message = JSON.parse(String(data));
    if (message.id === undefined) return;
    let result;
    if (message.method === 'initialize') result = {userAgent: 'test-runtime'};
    else if (message.method === 'experimentalFeature/list') {
      // Place API discovery on the second page, as real releases may do.
      const page = message.params.cursor ? ['api_key_model_discovery', 'mcp_oauth_refresh_coordination'] : ['auth_elicitation', 'code_mode_host'];
      result = {data: page.map(name => ({name, enabled: features[name]})), nextCursor: message.params.cursor ? null : 'second-page'};
    } else if (message.method === 'experimentalFeature/enablement/set') {
      mutations.push(message.params);
      if (accept) Object.assign(features, message.params.enablement);
      result = {enablement: accept ? message.params.enablement : {}};
    } else throw Error('Unexpected RPC: ' + message.method);
    ws.send(JSON.stringify({id: message.id, result}));
  }));
  server.listen(socket); await once(server, 'listening');
  try {await callback(socket, mutations);}
  finally {
    for (const ws of wss.clients) ws.terminate();
    await new Promise(r => wss.close(r)); await new Promise(r => server.close(r));
    fs.rmSync(root, {recursive: true});
  }
}

const featurePolicy = {api_key_model_discovery: false, auth_elicitation: true, code_mode_host: true, mcp_oauth_refresh_coordination: false};

test('live alignment handles pagination and avoids rewriting settings that already match', {timeout: 10000}, async () => {
  await withFeatureServer({...featurePolicy, api_key_model_discovery: true}, async (socket, mutations) => {
    const result = await reconcileFeatures(socket, featurePolicy);
    assert.deepEqual(result.changed, {api_key_model_discovery: false});
    assert.deepEqual(result.after, featurePolicy);
    assert.deepEqual(mutations, [{enablement: {api_key_model_discovery: false}}]);
    assert.deepEqual((await reconcileFeatures(socket, featurePolicy)).changed, {});
    assert.equal(mutations.length, 1);
  });
});

test('process-scoped mismatch is reported before making any live feature changes', {timeout: 10000}, async () => {
  await withFeatureServer({...featurePolicy, api_key_model_discovery: true, code_mode_host: false}, async (socket, mutations) => {
    await assert.rejects(reconcileFeatures(socket, featurePolicy), /runtime was left running: code_mode_host/);
    assert.deepEqual(mutations, []);
  });
});

test('a daemon rejecting live enablement cannot be reported as successfully aligned', {timeout: 10000}, async () => {
  await withFeatureServer({...featurePolicy, api_key_model_discovery: true}, async (socket) => {
    await assert.rejects(reconcileFeatures(socket, featurePolicy), /did not accept/);
  }, false);
});
