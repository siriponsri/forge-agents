import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationGraph, graphTone} from '../app/web/src/agent-graph.mjs';

const fixture = () => ({conversations: [{id: 'room', projectId: 'project', name: 'Engineering fixture'}], bots: [{id: 'bot', projectId: 'project', name: 'Executor'}], runs: [{id: 'run', projectId: 'project', conversationId: 'room', botId: 'bot', status: 'running', connection: {status: 'connected'}, attemptId: 'attempt'}], tasks: [], artifacts: []});
test('graph uses only room-bound runs in the exact project and never promotes message text to execution', () => {
  const state = fixture();
  state.conversations[0].messages = [{text: 'I delegated to Security and finished everything', botId: 'fictional'}];
  state.runs.push({id: 'foreign', projectId: 'elsewhere', conversationId: 'room', botId: 'bot'}, {id: 'other-room', projectId: 'project', conversationId: 'other'});
  const graph = createConversationGraph(state, 'project', 'room');
  assert.deepEqual(graph.runs.map(run => run.id), ['run']);
  assert.deepEqual(graph.nodes.filter(node => node.kind === 'bot').map(node => node.title), ['Executor']);
  assert.equal(graph.edges.some(edge => edge.kind === 'delegation'), false);
  assert.equal(createConversationGraph(state, 'elsewhere', 'room').nodes.length, 0);
});
test('argument completion or a terminal tool without an observed result does not become success', () => {
  const state = fixture();
  state.runs[0].toolObservations = {first: {id: 'first', name: 'read', status: 'completed', argumentsComplete: true, resultObserved: false}, denied: {id: 'denied', name: 'write', status: 'completed', nonExecutionKind: 'denied'}, failed: {id: 'failed', status: 'completed', resultObserved: true, outputIndicatesFailure: true}};
  const graph = createConversationGraph(state, 'project', 'room');
  const tools = graph.nodes.filter(node => node.kind === 'tool');
  assert.equal(tools.find(node => node.sourceId === 'first').status, 'unknown');
  assert.equal(tools.find(node => node.sourceId === 'denied').status, 'not-executed');
  assert.equal(tools.find(node => node.sourceId === 'failed').status, 'failed');
  assert.equal(graphTone('unknown'), 'attention');
});
test('tool IDs are attempt scoped and artifact references do not cross project boundaries', () => {
  const state = fixture();
  state.runs[0].toolObservations = {same: {id: 'same', status: 'running'}};
  state.runs[0].artifactIds = ['local', 'foreign', 'local'];
  state.artifacts.push({id: 'local', projectId: 'project', status: 'verified'}, {id: 'foreign', projectId: 'elsewhere', name: 'Private'});
  state.runs.push({...state.runs[0], id: 'second', parentRunId: 'run'});
  const graph = createConversationGraph(state, 'project', 'room');
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
  assert.equal(graph.nodes.some(node => node.title === 'Private'), false);
  assert.equal(graph.nodes.filter(node => node.kind === 'artifact').length, 2);
  assert.equal(graph.edges.filter(edge => edge.kind === 'delegation').length, 1);
  assert.ok(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.source) && graph.nodes.some(node => node.id === edge.target)));
});
test('pending owner input and disconnected observation stay explicit', () => {
  const state = fixture();
  state.runs[0].pendingApprovals = [{requestId: 'approval'}];
  state.runs[0].connection.status = 'disconnected';
  const node = createConversationGraph(state, 'project', 'room').nodes.find(node => node.kind === 'run');
  assert.equal(node.status, 'waiting');
  assert.equal(node.observing, false);
});
test('bounded graph prioritizes unresolved work, discloses omissions and is deterministic without mutating state', () => {
  const state = fixture();
  state.runs.push(...Array.from({length: 12}, (_, index) => ({id: `historical-${index}`, projectId: 'project', conversationId: 'room', botId: 'bot', status: 'completed', createdAt: `2026-11-${String(index + 1).padStart(2, '0')}`})));
  const before = structuredClone(state), graph = createConversationGraph(state, 'project', 'room');
  assert.equal(graph.runs.length, 8); assert.equal(graph.omittedRuns, 5);
  assert.ok(graph.runs.some(run => run.id === 'run'));
  assert.deepEqual(graph, createConversationGraph(state, 'project', 'room'));
  assert.deepEqual(state, before);
});
