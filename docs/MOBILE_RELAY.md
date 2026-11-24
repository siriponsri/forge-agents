# Mobile Owner relay

Owner addition 2026-11-24: FORGE must report progress/results to Hermess and
OpenClaw for delivery to the Owner's mobile channels, and receive work through
those intermediaries. This augments the complete-product scope.

Confirmed: Hermess means NousResearch Hermes Agent. New mobile work first enters
an approval inbox; the Owner approves starting it in the same originating mobile
channel. Receiving a message alone must never dispatch a run.

Implementation tasks:

- Pin the exact upstream versions and inspect their authenticated gateway,
  webhook and delivery contracts. Candidate primary sources:
  https://github.com/NousResearch/hermes-agent and
  https://docs.openclaw.ai/automation/cron-jobs/webhooks .
- Add separately configured relay connections, Owner/channel binding and setup
  health in GUI. Secrets stay machine-local. No public FORGE listener or cloud
  deployment is authorized by this addition.
- Send project/task/run/attempt-linked progress and final summaries through a
  durable outbox, with delivery receipts and truthful failed/unknown states.
- Receive authenticated, deduplicated, scoped work into existing task/run
  authorities. Preserve plan approval, tool policy, Stop and bounded execution.
- Reply through the originating authorized Owner channel; attachments remain
  scoped verified artifacts. Do not transmit credentials or full private state.
- Verify retries, disconnect/restart, duplicate messages, forged identity,
  cross-project routing and unknown delivery using contract fixtures; qualify
  each real relay/mobile separately with the Owner's configured service.

Status: IMPLEMENTATION_INCOMPLETE. Research/questions are not delivery evidence.
LIVE_HERMES_NOT_RUN / LIVE_OPENCLAW_NOT_RUN / HOME_UAT_NOT_RUN.
