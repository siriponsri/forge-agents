/** Keep last known selections usable when a provider catalog is slow or fails. */
export function createCatalogService({load,timeoutMs=10000,clock=()=>Date.now()}){
  let last,checkedAt,error,inFlight;
  const state=()=>({catalog:last??null,source:'FORGE isolated T3 provider instance',checkedAt:checkedAt??null,error:error??null,refreshing:!!inFlight,stale:!checkedAt||clock()-checkedAt>300000});
  return {
    read:state,
    async refresh(){
      if(!inFlight){inFlight=Promise.resolve().then(load).then(value=>{last=value;checkedAt=clock();error=null;return value;},e=>{error=e.message;throw e;}).finally(()=>{inFlight=null;});inFlight.catch(()=>{});}
      let timer;
      try{await Promise.race([inFlight,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Catalog refresh is still pending; keeping the last known catalog and model selection.')),timeoutMs);})]);}catch(e){error=e.message;}finally{clearTimeout(timer);}
      return state();
    },
  };
}
