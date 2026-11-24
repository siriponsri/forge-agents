// Trusted engineering adapters + real FORGE SQLite. No LLM or account traffic.
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore} from '../app/server/store.mjs';
import {createPluginService} from '../app/plugins/index.mjs';

// Plain domain-shaped fixture records avoid importing optional Office engines.
const entity = (data,projectId) => ({...data,id:randomUUID(),...(projectId ? {projectId} : {}),revision:1,createdAt:new Date().toISOString()});

export const form = (properties = {},required = []) => ({type:'object',additionalProperties:false,properties,required});
export const id = {type:'string',maxLength:200};
export const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r;}); return {resolve,promise}; };
export function trustedPlugin(capability = 'fixture',options = {}) {
  const calls = options.calls ?? [], configSchema = options.configSchema ?? form({mode:{type:'string',enum:['one','two']}});
  return {id:`fixture.${capability}`,name:capability,version:'1.0.0',requiresHost:'^1.0.0',configSchema,
    provides:[{capability,version:options.serviceVersion ?? '1.0.0',methods:options.methods ?? {inspect:form({value:{type:'string',maxLength:1000}})}}],consumes:options.consumes ?? [],
    async create(ctx) {
      calls.push(['create',capability,ctx]);
      return {services:{[capability]:Object.fromEntries(Object.keys(options.methods ?? {inspect:1}).map(method => [method,async args => { calls.push(['invoke',capability,args,ctx]); return options.invoke ? options.invoke(args,ctx) : {observed:ctx.config.mode ?? 'one'}; }]))},
        health:async () => { calls.push(['health',capability]); return options.health ? options.health(ctx) : {status:'ready'}; },
        dispose:async () => { calls.push(['dispose',capability]); if (options.dispose) await options.dispose(ctx); },
      };
    },
  };
}
export async function fixture(t,options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(),'forge-plugin-')); let store = await openStore(dir);
  const p=entity({name:'Plugin engineering fixture'}), other=entity({name:'Other scope'}), bot=entity({name:'Agent'},p.id), bot2=entity({name:'Agent 2'},p.id), task=entity({title:'Fixture task',botId:bot.id},p.id), session=entity({name:'Private',botId:bot.id},p.id), foreign=entity({title:'Foreign'},other.id);
  const connection=entity({name:'Fixture transport'},p.id), target=entity({name:'Fixture target'},p.id);
  await store.transaction(s => {s.projects.push(p,other);s.bots.push(bot,bot2);s.tasks.push(task,foreign);s.conversations.push(session);s.connections.push(connection);s.desktopTargets.push(target);});
  const calls=[], builtins=options.builtins ?? [trustedPlugin('fixture',{calls,...options})];
  let service=createPluginService({store,builtins,authorize:options.authorize ?? (() => true)});
  const f={p,other,bot,bot2,task,session,foreign,connection,target,calls,dir,
    get store(){return store;},get service(){return service;},
    input:extra => ({operationId:randomUUID(),projectId:p.id,...extra}),
    binding:extra => ({operationId:randomUUID(),projectId:p.id,pluginId:'fixture.fixture',expectedRevision:0,...extra}),
    async enable(extra){return service.enable(f.binding(extra));},
    async resolve(extra){return service.resolve(f.input({requires:[{capability:'fixture',version:'^1.0.0'}],...extra}));},
    async invoke(extra){return service.invoke(f.input({capability:'fixture',method:'inspect',arguments:{},...extra}));},
    async restart(){await service.close();await store.close();store=await openStore(dir);service=createPluginService({store,builtins,authorize:options.authorize ?? (() => true)});await service.recover();},
  };
  t.after(async () => {await service.close().catch(()=>{});await store.close();await rm(dir,{recursive:true,force:true});});
  return f;
}
