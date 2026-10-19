"""Local multilingual vector prefilter for Albatros.

The first start downloads sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
into the user's Hugging Face cache. Afterwards this server has no network dependency.
It only listens on 127.0.0.1 and receives article text from the desktop app.
"""

from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from threading import Lock

import torch
from sentence_transformers import SentenceTransformer

HOST = "127.0.0.1"
PORT = int(os.environ.get("ALBATROS_VECTOR_PORT", "7861"))
MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
THREADS = max(1, int(os.environ.get("ALBATROS_VECTOR_THREADS", "1")))

# The vector filter runs alongside Laya and Electron. Its work is cheap and
# concurrent at the request level, so one CPU thread keeps the interface
# responsive instead of competing with the classifier for every core.
torch.set_num_threads(THREADS)
torch.set_num_interop_threads(1)

# Kept in process for the lifetime of the application; embeddings are L2
# normalized, so a dot product is cosine similarity.
model = SentenceTransformer(MODEL_ID, device="cpu")

# Folder prompts change rarely but were previously re-encoded for every post.
# Keeping this small LRU cache means each request only embeds the incoming post
# after the first pass, cutting most vector-prefilter CPU work.
candidate_cache = OrderedDict()
cache_lock = Lock()
CACHE_LIMIT = 512


def get_candidate_vectors(candidates):
    missing = []
    with cache_lock:
        for candidate in candidates:
            if candidate not in candidate_cache:
                missing.append(candidate)
            else:
                candidate_cache.move_to_end(candidate)

    if missing:
        encoded = model.encode(missing, normalize_embeddings=True, show_progress_bar=False)
        with cache_lock:
            for candidate, vector in zip(missing, encoded):
                candidate_cache[candidate] = vector
                candidate_cache.move_to_end(candidate)
            while len(candidate_cache) > CACHE_LIMIT:
                candidate_cache.popitem(last=False)

    with cache_lock:
        return [candidate_cache[candidate] for candidate in candidates]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def respond(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"ready": True, "model": MODEL_ID})
        else:
            self.respond(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/candidates":
            self.respond(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(data.get("text", ""))
            candidates = [str(value) for value in data.get("candidates", [])]
            if not text or not candidates:
                self.respond(200, {"scores": []})
                return
            article = model.encode(text, normalize_embeddings=True, show_progress_bar=False)
            vectors = get_candidate_vectors(candidates)
            scores = [round(float(article.dot(vector)), 6) for vector in vectors]
            self.respond(200, {"scores": scores})
        except Exception as error:
            self.respond(500, {"error": str(error)})


ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
