"""Short-lived Mem0 OSS worker. stdin/stdout JSON; never an authority store.

No default OpenAI credentials, telemetry, model downloads, or remote vector DB.
The fixture embedding is deterministic engineering evidence, not a quality model.
"""
import hashlib
import json
import os
from pathlib import Path
import sys

os.environ['MEM0_TELEMETRY'] = 'false'
os.environ['DO_NOT_TRACK'] = '1'


def main(request):
    root = Path(request['dataDir']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    os.environ['MEM0_DIR'] = str(root / 'mem0-private')
    from mem0 import Memory
    from mem0.utils.factory import EmbedderFactory, LlmFactory
    from mem0.embeddings.base import EmbeddingBase

    cfg = request['config']
    fixture = request.get('fixtureMode', False)

    class FixtureEmbedding(EmbeddingBase):
        def embed(self, text, memory_action=None):
            # Explicit test-only hash vector. No inference or external request.
            out = [0.0] * cfg['dimensions']
            for word in text.lower().split():
                idx = int.from_bytes(hashlib.sha256(word.encode()).digest()[:4], 'big') % len(out)
                out[idx] += 1.0
            return out

    class NoInference:
        def __init__(self, config):
            pass

        def generate_response(self, **kwargs):
            raise RuntimeError('LLM inference is forbidden in fixture qualification')

    class LocalEmbedding(EmbeddingBase):
        def __init__(self, config):
            super().__init__(config)
            from ollama import Client
            self.client = Client(host=cfg['ollamaUrl'], timeout=15)
            names = {m.model for m in self.client.list().models}
            wanted = cfg['embeddingModel']
            if wanted not in names and wanted + ':latest' not in names:
                raise RuntimeError('Embedding model not installed; automatic downloads disabled')

        def embed(self, text, memory_action=None):
            result = self.client.embed(model=cfg['embeddingModel'], input=text).embeddings[0]
            if len(result) != cfg['dimensions']:
                raise RuntimeError('Configured embedding dimensions do not match local model')
            return result

    # Register narrow local providers via the real Mem0 factory. Never patch Memory
    # or Qdrant. No stock Ollama embedder auto-pull behavior is inherited.
    globals()['ForgeEmbedding'] = FixtureEmbedding if fixture else LocalEmbedding
    globals()['ForgeNoInference'] = NoInference
    EmbedderFactory.provider_to_class['ollama'] = '__main__.ForgeEmbedding'
    if fixture:
        LlmFactory.register_provider('ollama', '__main__.ForgeNoInference')
    config = {
        'vector_store': {'provider': 'qdrant', 'config': {
            'collection_name': 'forge_memory',
            'path': ':memory:' if cfg['vectorStore'] == 'qdrant-local-memory' else str(root / 'qdrant'),
            'embedding_model_dims': cfg['dimensions'],
            'on_disk': cfg['vectorStore'] == 'qdrant-local-disk',
        }},
        'embedder': {'provider': 'ollama', 'config': {'embedding_dims': cfg['dimensions']}},
        'llm': {'provider': 'ollama', 'config': {}} if fixture else {
            'provider': 'ollama', 'config': {'model': cfg['extractionModel'], 'ollama_base_url': cfg['ollamaUrl']}},
        'history_db_path': str(root / 'history.sqlite'),
    }
    memory = Memory.from_config(config)
    try:
        action = request['action']
        if action == 'health':
            from importlib.metadata import version
            return {'status': 'ready', 'mem0': version('mem0ai'), 'qdrantClient': version('qdrant-client'), 'fixture': fixture, 'inference': 'not-run'}
        if action == 'replace':
            # Rebuild the entire dedicated derived collection AND Mem0 history;
            # delete_all alone retains text-bearing history in the SDK database.
            memory.reset()
            count = 0
            for row in request['records']:
                metadata = {'forge_id': row['id'], 'forge_revision': row['revision'],
                            'forge_scope': json.dumps(row['scope'], sort_keys=True),
                            'forge_shares': [json.dumps(s, sort_keys=True) for s in row['shares']]}
                memory.add(row['content'], user_id='forge', metadata=metadata, infer=False)
                count += 1
            memory.db.reset()
            return {'indexed': count, 'authority': False, 'inference': 'disabled'}
        if action == 'search':
            # Scope-filter before retrieval, then canonical service rechecks every hit.
            key = json.dumps(request['scope'], sort_keys=True)
            results = memory.search(request['query'], filters={'user_id': 'forge',
                'OR': [{'forge_scope': key}, {'forge_shares': {'contains': key}}]}, limit=request.get('limit', 30))
            return [{'id': r.get('metadata', {}).get('forge_id'),
                     'revision': r.get('metadata', {}).get('forge_revision'),
                     'score': r.get('score')} for r in results['results']]
        if action == 'extract-draft':
            # Isolate extraction scratch from the authoritative projection collection.
            # This operation is constructor-only and not exposed as a native write API.
            result = memory.add(request['text'], user_id='forge-draft', infer=True)
            memory.delete_all(user_id='forge-draft')
            memory.db.reset()
            return {'drafts': result['results'], 'trust': 'untrusted-data', 'executable': False}
        raise ValueError('Unsupported worker action')
    finally:
        memory.close()


if __name__ == '__main__':
    try:
        result = main(json.load(sys.stdin))
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Never emit raw model content, credentials, environment or stack in protocol.
        print('Optional local memory worker unavailable', file=sys.stderr)
        sys.exit(1)
