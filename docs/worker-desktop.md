# FORGE A16/A17 target-driver handoff

Implementation worker, 2026-11-24. Base `09fc17ef2e56d2bff7af7f260ea2e43396e39143`, branch `t3/desktop-target-drivers`, isolated T3 worktree. Runtime-declared exact model **gpt-6.1-sol**, reasoning **xhigh**; no model switch, Astra or 6.2 execution claimed.

Assigned changes are confined to new `app/desktop/**`, `tests/desktop*.test.mjs` and this note. No shared contracts, migrations, manifests/lockfiles, central progress, main/server/control/domain/web, legacy paths, push or PR changed by this worker. Lead integrates the API and GUI. All test windows/browser processes were disposable and owned by this worker; existing owner windows were only enumerated, never selected for input.

## Implementation and qualification

| Target | Implementation | Developer qualification | External qualification |
| --- | --- | --- | --- |
| Main Windows | IMPLEMENTED: selected HWND/PID/process-start/session, UI Automation inspection, ValuePattern/InvokePattern where the app supplies them, targeted native Edit/Button fallbacks, scoped key input, PrintWindow screenshot, driver-process cancellation | PASSED on Windows NT 10.0.26200.0, interactive session 60, own standard Win32 Edit/Button controls in a disposable WinForms host | HOME_UAT_NOT_RUN; application/provider-specific patterns and elevated/protected surfaces require their own qualification |
| Browser | IMPLEMENTED: actual Playwright Chromium, distinct owned browser/context/page per target, typed actions, isolated lifecycle | PASSED: real headless Chromium 1.65.1 library flow, Unicode input and observed postcondition, blocked-input Stop, fresh context, takeover | HOME_UAT_NOT_RUN; no existing-profile/CDP attachment is shipped |
| Separate guest | IMPLEMENTED: authenticated, agent/target-pinned `forge-desktop/1` client, loopback guest agent, remote controller lease and cancellation | PASSED: local authenticated protocol/transport fixture and remote lease revocation. This is deliberately **not VM evidence** | **REAL_GUEST_LIVE_NOT_RUN**: no separately provisioned VM, guest interactive session, guest secret or authenticated tunnel is available. Run the executable inside that guest before qualifying A17 native guest |

The desktop itself is not a security sandbox. One FORGE application service owns admission and serializes leases across aliases of the same physical desktop; the guest service enforces ownership independently. This does not block human input or unrelated third-party automation. Windows control is conditional on a supported UIA/native control, a live interactive session and compatible process integrity. Browser capability never qualifies native Windows or a guest.

## Integration API

```js
import { createDesktopService } from '../desktop/index.mjs';
const desktop = createDesktopService({ dataDir, store });
```

The service uses the existing `desktopTargets`, `receipts` and `artifacts` domain collections. It adds fields to those records without changing the schema or domain command owner. **Do not use `desktopTarget.create` as a substitute for setup**: it cannot create the machine-local connection file. Existing catalog-only targets return `SETUP_REQUIRED` until configured. Expose all routes only inside the existing authenticated localhost application boundary. Call `shutdown()` before closing the store.

The six core method schemas are:

```ts
setup({
  projectId: string, targetId?: string, name: string,
  kind: 'windows' | 'browser' | 'guest',
  config: WindowsConfig | BrowserConfig | GuestConfig
}): Promise<DesktopTarget>

health({ projectId, targetId }): Promise<{
  targetId, kind, ready: boolean, capabilities: string[],
  identity?: object, limitations?: string[],
  blocker?: { code, message, action?: 'installBrowser' }
}>

listWindows({ projectId, targetId }): Promise<{
  targetId, windows: Array<{ id: string, title: string, identity: object }>
}>

acquire({
  projectId, targetId, controllerId: string, windowId: string,
  attemptId: string, runId?: string, ttlMs?: number // 1000..900000, default 120000
}): Promise<{
  targetId, controllerId, leaseId: string, generation: string,
  attemptId, runId?, windowId, expiresAt: string
}>

action({
  projectId, targetId, controllerId, leaseId, attemptId,
  operationId: string, name: string, arguments?: object
}): Promise<{
  projectId, targetId, attemptId, operationId, name, at: string,
  status: 'completed' | 'cancelled' | 'failed' | 'unknown',
  result?: object, error?: {code, message},
  replayed?: boolean, resultUnavailable?: boolean
}>

stop({
  projectId, targetId, controllerId?, leaseId?, takeover?: boolean
}): Promise<{
  targetId, controlState: 'stopped' | 'human_control' | 'reconciliation_required',
  revokedLeaseId: string | null, interrupted: string[], reconciliation: string
}>
```

`stop` requires the current controller/lease unless `takeover:true` was explicitly selected. `takeover({projectId,targetId})` is its explicit human-control alias. `release({...lease,projectId})` stops/revokes the current lease. Every subsequent input requires a new acquire; idle time never reacquires automatically. A second acquire, even by the same controller, fails while the first lease exists. A different attempt requires a new lease. No input queue is admitted. Lease expiry cancels the in-flight operation. A client disconnect does not undo a dispatched action; call Stop explicitly and reconcile.

Additional methods:

```ts
installBrowser({projectId,targetId}): Promise<{installed:true}>
screenshot({projectId,targetId,artifactId}): Promise<{path:string,mimeType:'image/png'}>
shutdown(): Promise<void>
```

`installBrowser` is an actual bounded fixed Playwright CLI install action, with no caller-controlled executable/arguments. Setup also accepts browser `config.installBrowser:true`. Missing browser errors identify this install control, rather than requiring users to type a command. Installation has a 180-second process deadline and returns a structured failure on network/disk errors. **Lead packaging task:** move the already pinned Playwright `1.65.1` from development to runtime dependencies and retain its Apache-2.0 notices; ship or acquire the Chromium build. This worker did not edit root dependencies. Existing Chromium acquisition was verified by invoking the actual install method and observing `{installed:true}`.

The screenshot action returns `{artifactId,mimeType,size,sha256}` rather than embedding pixels in state/events. Serve it through `screenshot(...)` under a desktop-target authenticated download route; this checks project, target, type, file size and SHA-256. The generic workspace artifact download route does not own these files. They live under machine-local `dataDir/desktop/screenshots`. Screenshot records contain target and attempt lineage and no absolute path in portable domain state. Read errors are not successful artifact registration.

## Settings and bounded action schemas

```js
// Main Windows. Setup/health/list do not focus or type into any window.
{ kind: 'windows', config: {} }

// Dedicated browser. Headed mode only when explicitly selected.
{ kind: 'browser', config: { mode: 'owned', headless: true, installBrowser: false } }

// Guest connection configuration, saved only on this machine.
{
  kind: 'guest',
  config: {
    endpoint: 'http://127.0.0.1:47831', // authenticated loopback tunnel, or HTTPS origin
    tokenEnv: 'FORGE_GUEST_TOKEN',    // secret reference only; never a token value
    agentId: 'owner-selected-stable-agent-id',
    remoteTargetId: 'guest-desktop'
  }
}
```

Config files are allowlisted, stored only under `dataDir/desktop/config/<targetId>.json`, and never put in domain snapshots. Token values are read from the referenced environment secret at dispatch, not stored or logged. HTTPS/loopback URLs reject embedded credentials, query strings and fragments. HTTP on a non-loopback host is refused. The guest listener itself binds **only 127.0.0.1**; use an already authorized tunnel or authenticated TLS termination to reach a remote guest. The adapter never creates a VM, buys compute, moves credentials or opens a public listener.

All actions take optional `timeoutMs:100..30000`. Every input string and output is bounded. No normal action evaluates JavaScript, invokes a shell, launches an app, runs arbitrary executable arguments, sends system shortcuts or performs arbitrary screen-coordinate input.

| Action | Windows arguments / result | Browser arguments / result |
| --- | --- | --- |
| `inspect` | `{}` → `{identity,title,elements:[{elementId,name,automationId,controlType,enabled,password,patterns,nativeClass,nativeActions,value?}]}`; at most 251 elements | `{}` → `{title,url,tree}` accessibility snapshot, max 60000 chars |
| `type` | `{elementId,text}`; replace text, UIA ValuePattern or native descendant Edit WM_SETTEXT; verifies the read-back | `{selector,text}`; Playwright `fill`, replace text |
| `click` | `{elementId}`; UIA InvokePattern or native descendant Button BM_CLICK | `{selector}`; exactly one element, Playwright click |
| `key` | `{elementId,key}`; selected descendant native Edit HWND only | `{selector,key}`; selected locator only |
| `focus` | `{}`; selected top-level window via SetForegroundWindow, which Windows may refuse | `{}`; owned page bringToFront |
| `screenshot` | `{}`; selected window PrintWindow, max 4096×4096 and 6 MiB; protected surfaces may be blank | `{}`; owned viewport PNG |
| `navigate` | Unsupported | `{url:'http(s)://...'}`; credentials in URL refused |
| `wait` | `{ms:0..30000}`; abortable wait | Same |

Selectors must use `css=` or `role=` and select exactly one element. Keys are allowlisted: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Home`, `End`. Each application's Edit semantics still apply; these targeted messages do not emulate arbitrary global keyboard entry. Text limit is 10000 characters. Native password controls and read-only edits are excluded.

The GUI can enable native text/click actions from `patterns` **or** `nativeActions`. On this development Windows build the managed UIA bridge reported standard fixture controls as Pane with no patterns; the test consequently exercised documented Win32 fallbacks. There is no claim that unexercised third-party applications expose UIA patterns. Element IDs must come from a fresh inspection. The helper rechecks top-level HWND, PID, process-start ticks and interactive session before each operation and enforces descendant handles for native messages. A vanished or replaced window refuses input.

## Stop, uncertainty and recovery

Revocation removes admission before teardown. The old lease/controller/attempt cannot enqueue more input. A native action runs in its own fixed PowerShell helper with JSON stdin, bounded output and a 35-second outer deadline; Stop kills only the helper, never the selected owner application. No global key/mouse buttons are held. Browser Stop closes only the FORGE-owned browser, aborting pending Playwright calls; the next acquire creates a fresh context/page. Guest Stop authenticates a separate request and revokes the actual remote lease after local fetch cancellation.

If input might already have been delivered, an interrupted action is `unknown`, not success or an invented rollback. If a native handler is already executing inside the selected application, killing its helper cannot undo that handler. The live delayed-click test explicitly observes this case. A stopped read/wait before a mutating dispatch is `cancelled`; a failed read/unsupported operation is `failed`. A false text verification is `unknown`. Inspect and reconcile before deciding whether to issue a different operation.

Durable `desktop.action` receipts are created before dispatch, include the exact target/lease/attempt fingerprint and terminal status, and never contain typed text or inspection content. Reusing an operation ID with different scope/input fails. A same-operation repeat cannot repeat its side effect; same-process cached results may be returned. After restart, receipt-only results carry `resultUnavailable:true`; a previously running receipt remains unknown. A restart does not resurrect an old lease. Inspect before acquiring a new attempt. Shutdown revokes input before store closure.

If remote stop is unconfirmed, the resource stays `reconciliation_required` and cannot be acquired through another target alias. Restore the authenticated connection and explicitly retry Take over; only a successful teardown frees the reservation. Completed effects are never reported as undone. The service requires the product's single application lifecycle owner; it is not an OS-wide lock against unrelated controller programs.

## Executable guest agent and home check

`node app/desktop/guest-agent.mjs --help` displays required configuration. Install the ordinary FORGE source/runtime dependencies **inside a separately provisioned Windows guest**, start from its interactive unlocked user session, and set machine-local environment references using the supported local secret mechanism:

- `FORGE_GUEST_DATA_DIR`: absolute machine-local state folder outside source/portable payload.
- `FORGE_GUEST_TOKEN`: 32..512 character secret, supplied locally; never put its value in a handoff or domain record.
- `FORGE_GUEST_AGENT_ID`: stable explicit identity, matched by the main-machine connection.
- `FORGE_GUEST_PORT`: optional loopback port, default `47831`.
- `FORGE_GUEST_KIND`: `windows` by default, or `browser` for a separately qualified guest browser target.

Run `node app/desktop/guest-agent.mjs`. It exports fixed target `guest-desktop` using the same service/lease contract. The agent allows only health/windows/acquire/action/stop/screenshot methods; requests cannot choose local projects, arbitrary target IDs or commands. All requests require constant-time bearer authentication plus matching `agentId` and `targetId`. Responses carry the protocol and both pinned identities. No secret values are printed. Stop the guest with Ctrl+C to revoke leases and close owned drivers.

For real guest qualification, connect the owner-selected authenticated tunnel, configure the guest target in FORGE, check that `health.identity.remote` identifies the guest Windows session, select a harmless guest-owned fixture, run text/click/screenshot, and Stop/Take over during an action. Verify that main-machine windows remain untouched. Record the real guest identity and evidence independently of the local protocol fixture. This remains **NOT_RUN**, along with all owner home UAT.

## Executed verification and evidence

Commands executed in this worker checkout:

```powershell
node --test tests/desktop.test.mjs
$env:FORGE_DESKTOP_LIVE_BROWSER='1'
$env:FORGE_DESKTOP_LIVE_NATIVE='1'
$env:FORGE_DESKTOP_KEEP_EVIDENCE='1'
node --test --test-concurrency=1 tests/desktop*.test.mjs
node app/desktop/guest-agent.mjs --help
git diff --check
```

Final full run: **10/10 PASSED**, zero failures or skips, duration 17.17 seconds. Eight contract checks cover scope/identity, Stop/Take over, receipts, expiry, partial/unverified outcomes across restart, failed teardown retaining ownership until successful Take over retry, machine settings and authenticated guest protocol. Two real live checks cover the owned native and browser flows. All new JavaScript modules passed `node --check`; `git diff --check` passed. Default test runs skip visible native/browser flows unless the explicit environment flags are set; the contract suite uses labelled engineering fixtures only. Dependency resolution during verification used an ignored junction under `app/desktop/node_modules` pointing at the existing checkout's installed runtime; no dependency or lockfile changed.

Retained latest inspected evidence from the 8/8 live run (machine-local, not portable artifacts):

- Native: `%TEMP%/forge-native-evidence-1kv6Dn/evidence.json`, screenshot `desktop/screenshots/5a847161-aee3-447e-9c39-4477e221dbcf.png`. Actual native modes: `targeted Edit WM_SETTEXT replace`, `targeted Button BM_CLICK`; text and click postconditions observed. Take over cancelled the wait; Stop terminated the helper after the fixture confirmed a dispatched delayed window handler. Native screenshot was visually inspected and shows the exact labelled disposable native fixture with Thai/English text and “Fixture clicked”.
- Browser: `%TEMP%/forge-browser-evidence-iYpdng/evidence.json`, screenshot `desktop/screenshots/b5bbf9ba-d2e7-4c84-be4e-0b626bebf5d3.png`. Visually inspected: Unicode input and matching clicked output in the owned local test page. Stop during the disabled-button wait returned under 3 seconds and the blocked click was unknown; a fresh lease opened `about:blank`.
- No real VM/remote desktop or owner credentials were exercised. Native fixture processes and owned browser processes were closed by the harness; no owner process was closed.

The final 10/10 rerun retained equivalent evidence in `%TEMP%/forge-native-evidence-efMbsy/evidence.json` (screenshot `desktop/screenshots/ed96cc2e-8e9f-43b9-b2f8-98003197355e.png`) and `%TEMP%/forge-browser-evidence-UpRFGq/evidence.json` (screenshot `desktop/screenshots/19b4ee5c-ed86-4f6f-ad39-89bddb1c3cc2.png`).

## Primary contracts consulted

The handoff's COMPUTER_USE_MCP_RESEARCH recommends Cua/Windows-MCP candidates, but none is presumed installed or reused under an unverified license. This bounded implementation uses the documented Microsoft OS adapter boundary already present on Windows and the existing pinned Playwright runtime, avoiding an additional desktop daemon/credential migration. It does not claim that the Cua MCP implementation has been integrated.

- [Microsoft UI Automation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview), [ValuePattern.SetValue](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.valuepattern.setvalue), [client-side provider behavior](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/client-side-ui-automation-provider-implementation).
- [WM_SETTEXT](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settext), [WM_GETTEXT](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-gettext), [BM_CLICK](https://learn.microsoft.com/en-us/windows/win32/controls/bm-click), [SendMessageTimeoutW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw), [PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow). These documented calls can block or depend on the selected application; a bounded helper and truthful uncertainty are required.
- [Playwright Browser lifecycle](https://playwright.dev/docs/api/class-browser), installed manifest `playwright` version `1.65.1`, license `Apache-2.0`. Only owned lifecycle is used; no owner browser attachment or generic JS evaluator is exposed.
