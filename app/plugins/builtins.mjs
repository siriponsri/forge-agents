import { fail } from './contracts.mjs';

const id = {type:'string',maxLength:200};
const form = (properties, required = []) => ({type:'object',additionalProperties:false,properties,required});
const ids = {type:'array',items:id,maxItems:32};
// All strings here are IDs/enums, never auth, native prompts or provider context.
export const BUILTIN_CONTRACTS = {
  models:{name:'Models',description:'Observed provider model capabilities',config:form({providerInstanceId:id}),methods:{catalog:form({providerInstanceId:id})}},
  provider:{name:'Provider harness',description:'Dispatch through the owned T3 provider runtime',config:form({providerInstanceId:id}),methods:{dispatch:form({taskId:id},['taskId']),stop:form({runId:id},['runId'])}},
  mcp:{name:'MCP tools',description:'Scoped MCP discovery and governed tool calls',config:form({connectionId:id}),methods:{discover:form({connectionId:id},['connectionId']),call:form({connectionId:id,name:id,arguments:{type:'json'}},['connectionId','name','arguments'])}},
  skills:{name:'Skills',description:'Versioned skill selection for task requirements',config:form({skillIds:ids}),methods:{select:form({taskId:id,skillIds:ids},['taskId'])}},
  environment:{name:'Execution environment',description:'Project-qualified compute environments',config:form({connectionId:id}),methods:{inspect:form({connectionId:id},['connectionId'])}},
  desktop:{name:'Desktop control',description:'Target identity and controller-aware native actions',config:form({targetId:id}),methods:{inspect:form({targetId:id},['targetId']),stop:form({targetId:id,controllerId:id},['targetId','controllerId'])}},
  browser:{name:'Browser',description:'Browser capability with an explicitly selected target',config:form({targetId:id}),methods:{inspect:form({targetId:id},['targetId'])}},
};

/**
 * @typedef {{health:(context:object)=>Promise<{status:'ready'|'degraded'|'unavailable',code?:string}>,invoke:(method:string,args:object,context:object)=>Promise<any>,dispose?:(context:object)=>Promise<void>}} NativeAdapter
 * NativeAdapter context = {scope:Context, config:object, signal:AbortSignal}.
 * Trusted adapters own their native auth and runtime. They must enforce their
 * operation-specific policies and validate remote output; registry auth is extra.
 */
export function createBuiltinPlugins(adapters = {}) {
  return Object.entries(BUILTIN_CONTRACTS).map(([capability,contract]) => ({
    id:`forge.${capability}`,name:contract.name,description:contract.description,version:'1.0.0',requiresHost:'^1.0.0',
    provides:[{capability,version:'1.0.0',methods:contract.methods}],consumes:[],configSchema:contract.config,
    available:!!adapters[capability],
    async create(ctx) {
      const adapter = adapters[capability];
      if (!adapter || typeof adapter.health !== 'function' || typeof adapter.invoke !== 'function') fail('ADAPTER_MISSING', `Register the native ${capability} adapter`, 409);
      return {
        services:{[capability]:Object.fromEntries(Object.keys(contract.methods).map(method => [method,args => adapter.invoke(method,args,ctx)]))},
        health:() => adapter.health(ctx),
        dispose:() => adapter.dispose?.(ctx),
      };
    },
  }));
}
