export const VAST_MCP=Object.freeze({
  repository:'https://github.com/siriponsri/vast-mcp-test',
  revision:'ef116f4700a4a880dd4651210b9923f8e6a4201f',
  tools:Object.freeze(['health','search_gpu_offers','estimate_run_cost']),
  readiness:'LOCAL_MOCK',liveSearch:'BLOCKED_UNVERIFIED_VAST_SEARCH_SCOPE',
});

// A prepared external server, not a new compute/runtime owner. Literal argv
// keeps a folder containing spaces out of shell parsing. No client registration,
// key migration, Vast rental or global environment mutation is performed.
export function vastMcpConfiguration({directory,projectId,operationId}){
  if(typeof directory!=='string'||!directory.trim()||/[\r\n\0]/.test(directory)||!directory.isWellFormed()||!/^([A-Za-z]:[\\/]|\/(?!\/))/.test(directory))throw new Error('Select the absolute folder of the prepared Vast MCP checkout.');
  return {projectId,operationId,name:'Vast MCP · synthetic offers',route:'stdio',command:'uv',args:['--directory',directory,'run','--locked','ptp-vast-mcp'],envRefs:[]};
}
