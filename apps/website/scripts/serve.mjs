// Local-only static review server; production uses Pages and has no server code.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function serve(port=0) {
  const root=resolve('dist');
  const headers=await readFile(resolve(root,'_headers'),'utf8');
  const csp=headers.match(/Content-Security-Policy: (.*)/)[1];
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json','.xml':'application/xml','.txt':'text/plain'};
  const server=createServer(async(req,res)=>{
    try {
      let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname==='/'){res.writeHead(302,{Location:'/th/'}).end();return}
      const file=resolve(root,'.'+pathname);
      if(file!==root&&!file.startsWith(root+sep))throw new Error('Invalid path');
      let target=file,status=200;
      try{const s=await stat(file);if(s.isDirectory())target=resolve(file,'index.html');await stat(target)}catch{target=resolve(root,'404.html');status=404}
      const body=await readFile(target);
      const responseHeaders={'Content-Type':types[extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY'};
      // Match the production exception for the native browser image viewer.
      if(pathname!=='/forge-workbench.png')responseHeaders['Content-Security-Policy']=csp;
      res.writeHead(status,responseHeaders);res.end(body);
    }catch{res.writeHead(400).end('Bad request')}
  });
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  return {server,url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const app=await serve(Number(process.env.PORT||4179));console.log(`FORGE public site local review: ${app.url}`)}
