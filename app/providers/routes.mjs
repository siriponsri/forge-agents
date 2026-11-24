import { fail } from './common.mjs';
const pinned='https://github.com/pingdotgg/t3code/blob/59651c1761f6c63e9b6056839067066968e6a406/';
// These are setup contracts, never a static model list or an inference runtime.
export const routes = [
  {id:'codex-managed',brand:'Codex',driver:'codex',authRoute:'managed-chatgpt',mode:'native',docs:pinned+'docs/user/providers-codex.md'},
  {id:'codex-local',brand:'Codex',driver:'codex',authRoute:'fresh-local-login',mode:'native',docs:pinned+'docs/user/providers-codex.md'},
  {id:'claude',brand:'Claude',driver:'claudeAgent',authRoute:'fresh-local-login',mode:'native',docs:'https://code.claude.com/docs/en/authentication'},
  {id:'opencode',brand:'OpenCode',driver:'opencode',authRoute:'fresh-local-login',mode:'native',docs:'https://opencode.ai/docs/providers/'},
  ...[
    ['gemini','Gemini','gemini',['--acp'],'https://geminicli.com/docs/cli/acp/'],
    ['grok','Grok','grok',['agent','stdio'],'https://docs.x.ai/grok-build/overview'],
    ['kimi','Kimi','kimi',['acp'],'https://github.com/MoonshotAI/kimi-code'],
    ['qwen','Qwen','qwen',['--acp'],'https://qwenlm.github.io/qwen-code-docs/en/users/features/acp/'],
    ['deepseek','DeepSeek','dsh',['--profile','acp'],'https://github.com/deepseek-ai/DeepSeek-Harness'],
  ].map(([id,brand,command,args,docs])=>({id,brand,driver:'acpRegistry',authRoute:'agent-owned-fresh-home',mode:'acp-local',command,args,docs,
    limitations:'External executable required. ACP account isolation and subprocess cancellation require route-specific qualification. Google consumer eligibility differs from API/enterprise access.'})),
  {id:'custom-acp',brand:'Custom',driver:'acpRegistry',authRoute:'agent-owned-fresh-home',mode:'acp-local',docs:pinned+'docs/user/providers-acp.md'},
  ...[
    ['openrouter','OpenRouter','https://openrouter.ai/api/v1','openrouter','https://openrouter.ai/docs/quickstart'],
    ['gemini-api','Gemini','https://generativelanguage.googleapis.com/v1beta/openai/','chat-completions','https://ai.google.dev/gemini-api/docs/openai'],
    ['grok-api','Grok','https://api.x.ai/v1','responses','https://docs.x.ai/docs/api-reference'],
    ['kimi-api','Kimi','https://api.moonshot.ai/v1','chat-completions','https://platform.kimi.ai/docs/guide/migrating-from-openai-to-kimi'],
    ['deepseek-api','DeepSeek','https://api.deepseek.com/v1','chat-completions','https://api-docs.deepseek.com/'],
    ['qwen-api','Qwen',null,'chat-completions','https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope'],
    ['maxplus','MaxPlus',null,null,'https://maxplus-ai.cc/docs/api'],
    ['custom-api','Custom',null,null,'https://opencode.ai/docs/providers/'],
  ].map(([id,brand,baseURL,apiFamily,docs])=>({id,brand,driver:'opencode',authRoute:'machine-env-api-key',mode:'opencode-api',baseURL,apiFamily,docs,requiresRuntime:'OpenCode 2.x; T3 0.1.11 detects v1/v2 separately',limitations:'Configuration adapter only until observed catalog and actual T3 request. Tool support, account eligibility, cancellation and each custom endpoint require live qualification.'})),
  ...['kob'].map(id=>({
    id,brand:({openrouter:'OpenRouter','gemini-api':'Gemini','grok-api':'Grok','kimi-api':'Kimi','qwen-api':'Qwen','deepseek-api':'DeepSeek',maxplus:'MaxPlus',kob:'KOB','custom-api':'Custom'})[id],
    mode:'model-api',implemented:false,
    blocker:id==='kob'?'KOB endpoint-path and CLI-license conflict; no qualified T3 harness contract.':id==='maxplus'?'Pool/protocol/account contract requires qualification; no universal compatibility assumption.':'Use a configured OpenCode instance and its observed models. Direct model API execution is not a T3 coding harness.',
    docs:id==='openrouter'?'https://openrouter.ai/docs/quickstart':'https://opencode.ai/docs/providers/',
  })),
];
export function routeById(id){const route=routes.find(r=>r.id===id);if(!route)fail('ROUTE_UNAVAILABLE','Choose a documented provider setup route',409);if(route.implemented===false)fail('UNSUPPORTED_ROUTE',route.blocker,409);return route;}
export const envName = value => typeof value==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(value);
