import { FRONTEND_TOOL, META_KEY, NATIVE_TOOL_NAME, TOOL_NAME, argumentsFor, fail, identifier, sdkResult, typedResult } from './contract.mjs';

// NEW private native hook source, not installed into the Guarded derivative.
// Install this Info through the SUPERVISED OpenCode Tool.Service.transform
// editor.add seam. Dependency injection uses that graph's exact Effect/Tool.Error
// identities. The SDK client holds a run-specific transient bearer privately.
export function makeOpenCodeFrontendTool({ Effect, ToolError, client, binding, assertCurrent }) {
  if (!Effect?.tryPromise || typeof ToolError !== 'function' || typeof client?.callTool !== 'function' || typeof assertCurrent !== 'function') throw new TypeError('Matching native Effect, Tool.Error, private SDK client and turn authority required');
  const bound = Object.freeze(structuredClone(binding));
  identifier(bound.nativeSessionId); identifier(bound.nativeTurnId);
  function check(context) {
    if (assertCurrent(bound, context) !== true || context?.sessionID !== bound.nativeSessionId || context.codemode || context.background || context.delegated || context.parentCallId) fail('FRONTEND_NATIVE_CONTEXT');
    // Tool.Context.id is the actual native call ID at the pinned source seam.
    // MCP's JSON-RPC request ID and T3 pending-request IDs are unrelated.
    return { sessionId: identifier(context.sessionID), turnId: bound.nativeTurnId, callId: identifier(context.id), messageId: identifier(context.messageID) };
  }
  return Object.freeze({
    name: TOOL_NAME, description: FRONTEND_TOOL.description,
    options: { namespace: 'forge_frontend', codemode: false },
    input: structuredClone(FRONTEND_TOOL.inputSchema), output: {},
    execute(input, context) {
      const task = Effect.tryPromise({
        try: async signal => {
          const native = check(context), args = argumentsFor(input);
          const result = await client.callTool({ name: TOOL_NAME, arguments: args, _meta: { [META_KEY]: native } }, undefined, { signal, timeout: 125000 });
          check(context);
          const source = result.structuredContent;
          if (source?.source !== 'owner-frontend-selection') fail('FRONTEND_RESULT_CONTRACT');
          const { source: _source, ...raw } = source;
          const value = typedResult(raw, { arguments: args });
          const expected = sdkResult(value);
          if (JSON.stringify(result.content) !== JSON.stringify(expected.content) || Boolean(result.isError) !== Boolean(expected.isError)) fail('FRONTEND_RESULT_CONTRACT');
          if (value.status === 'error') throw new Error(`FRONTEND_${value.error.code}`);
          return { output: source, content: result.content };
        },
        catch: error => new ToolError({ message: typeof error?.message === 'string' && /^FRONTEND_[A-Z_]+$/.test(error.message) ? error.message : 'FRONTEND_OUTCOME_UNKNOWN' }),
      });
      // OpenCode awaits this same effect and lowers its actual result into its
      // existing tool-call/result lifecycle. Honour the native cancel effect too.
      return context.cancel ? Effect.raceFirst(task, Effect.flatMap(context.cancel, () => Effect.fail(new ToolError({ message: 'FRONTEND_OUTCOME_UNKNOWN' })))) : task;
    },
  });
}
export { NATIVE_TOOL_NAME };
