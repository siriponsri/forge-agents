# Routing

Native execution is the default. AO is selectable only when all conditions hold:

1. `ao_limited_enabled` is true.
2. The route explicitly requests `execution_backend: ao`.
3. The work is a worker task, never planning or approval work.
4. The provider has a complete, loopback-only daemon boundary.

Fallback to native is permitted only when explicitly requested and before an AO
session is created. Post-session failures fail closed and require cleanup
evidence.
