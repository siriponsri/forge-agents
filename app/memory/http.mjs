import { fail } from './contracts.mjs';

const methods=new Set(['remember','recall','update','list','forget','export','configure','backend','status','rebuild','context','resolveRefs','retention','proposeLesson','setup','health']);
// Mount behind the existing loopback Host/Origin + authenticated GUI session/CSRF
// checks. resolveCaller MUST enforce those controls, including on GET. This helper
// does not create a server, issue credentials, or trust body actor fields.
export function createMemoryHttpHandler({service,resolveCaller}) {
  if(typeof resolveCaller!=='function')throw new TypeError('Trusted request authorization resolver required');
  return async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');if(!url.pathname.startsWith('/api/memory/'))return false;
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    try {
      const method=url.pathname.slice('/api/memory/'.length);if(!methods.has(method))fail('MEMORY_NOT_FOUND','Memory operation not found',404);
      if(!(req.method==='POST'||req.method==='GET'&&method==='status'))fail('MEMORY_METHOD','Use POST for memory operations',405);
      const caller=await resolveCaller(req);if(!caller)fail('MEMORY_FORBIDDEN','Authenticated caller required',403);
      let input;
      if(req.method==='GET') {if([...url.searchParams.keys()].some(k=>k!=='projectId'))fail('MEMORY_VALIDATION','Unexpected status query');const projectId=url.searchParams.get('projectId');input={projectId,scope:{projectId,kind:'project',id:projectId}};}
      else {
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))fail('MEMORY_CONTENT_TYPE','JSON body required',415);
        const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>65536)fail('MEMORY_LIMIT','Memory request exceeds 64 KiB',413);chunks.push(b);}
        try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('MEMORY_VALIDATION','Invalid JSON body');}
      }
      send(200,await service[method](input,caller));
    } catch(e) {const safe=e.code?.startsWith('MEMORY_');send(safe?e.status??400:500,{error:{code:safe?e.code:'MEMORY_INTERNAL',message:safe?e.message:'Memory request failed'}});}
    return true;
  };
}
