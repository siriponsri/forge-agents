# T3 Code source reuse

Source: pingdotgg/t3code release v0.1.11, commit
59651c1761f6c63e9b6056839067066968e6a406. MIT; LICENSE retained.
`bin/t3.mjs` and `package.json` copied from published `t3@0.1.11` npm archive,
SHA1 a3a6b2cfcc733754ebb84aeb37be807433c8e4e8.

FORGE modifies only `publish`: bounded atomic rename retry after executable
validation on Windows EPERM/EBUSY/EACCES. This resolves an observed transient
Windows install failure without bypassing release SHA256SUMS or version checks.
The matching release GUI and provider/thread server are downloaded as a single
upstream distribution into FORGE's isolated machine-local T3 home. No upstream
binary or runtime state is committed. Developer T3 sessions are never imported.

The new FORGE shell currently opens that actual coding surface at its loopback
URL. Unified T3-derived navigation remains a tracked A01 implementation gap;
using the same release GUI/server is real reuse, not proof of full shell integration.
