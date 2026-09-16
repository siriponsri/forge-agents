# Provider Isolation

Official Codex and MaxPlus are separate security boundaries. Each provider must
have a distinct native home, AO data root, run file, loopback port and daemon
identity. Credential contents must never be read, copied, merged, exported or
switched by FORGE or AO.

Tests use fixtures and temporary empty homes. A missing login fails closed. Real
provider homes are not valid test targets.
