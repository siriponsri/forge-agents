// Lead-owned shared bridge edit expressed as NEW patch source. Returns text;
// never modifies app/guarded-runtime/t3-host.mjs itself or replaces a live host.
export function extendT3HostSource(source) {
  const parameters = 'installT3GuardedHost({resolveThread,assertCurrent,runtimeDirectory,resolveConnection})';
  const property = '    directory:runtimeDirectory,';
  if (source.split(parameters).length !== 2 || source.split(property).length !== 2) throw Error('FRONTEND_ROOT_HOST_SEAM_CHANGED');
  return source.replace(parameters, 'installT3GuardedHost({resolveThread,assertCurrent,runtimeDirectory,resolveConnection,toolNames})').replace(property,
    property + '\n    ...(toolNames?{toolNames(handle){\n      if(!seen.has(handle))fail("PRIVATE_PROFILE_REQUIRED");\n      const p=assertCurrent(handle);if(!p||p.then)fail("PRIVATE_PROFILE_REQUIRED");\n      const names=toolNames(handle,p);if(names?.then)fail("SYNCHRONOUS_ROUTE_OBSERVATION_REQUIRED");\n      if(names!==undefined&&(p.purpose!=="supervised-frontend-v1"||JSON.stringify(names)!==JSON.stringify(["forge_frontend_selection_read"])))fail("PRIVATE_TOOL_PROFILE_REQUIRED");\n      return names;\n    }}:{}),');
}

export function purposeSeparatedToolNames(_handle, currentProfile) {
  return currentProfile?.purpose === 'supervised-frontend-v1' ? ['forge_frontend_selection_read'] : undefined;
}
