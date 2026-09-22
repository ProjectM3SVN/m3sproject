import os
import sys
import json
import torch
from http.server import HTTPServer, BaseHTTPRequestHandler
from transformers import LlamaConfig, LlamaForCausalLM, PreTrainedTokenizerFast

MODEL_DIR = "/opt/data/workspace/m3s_105m_model_v2"
PORT = int(os.environ.get("COMMANDER_PORT", 28550))

print(f"[M3S 105M COMMANDER] Loading model from {MODEL_DIR}...")
tokenizer = PreTrainedTokenizerFast.from_pretrained(MODEL_DIR)
config = LlamaConfig.from_pretrained(MODEL_DIR)
model = LlamaForCausalLM.from_pretrained(MODEL_DIR, config=config, torch_dtype=torch.float32)
model.eval()
print(f"[M3S 105M COMMANDER] Model ready! Listening on HTTP port {PORT}...")

class CommanderHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/decide":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                sit_prompt = data.get("sit", "")
                if not sit_prompt.startswith("<BOS>"):
                    sit_prompt = f"<BOS>{sit_prompt}"

                inp = torch.tensor([tokenizer.encode(sit_prompt)]).to(model.device)
                with torch.no_grad():
                    out = model.generate(inp, max_new_tokens=45, eos_token_id=3, pad_token_id=0, do_sample=False)
                raw_out = tokenizer.decode(out[0])
                
                # Parse THK and ACT
                thk = ""
                act = ""
                parts = raw_out.replace("<BOS>", "").replace("<EOS>", "").strip().split(" ")
                for p in parts:
                    if p.startswith("THK:"):
                        thk = p
                    elif p.startswith("ACT:"):
                        act = p

                resp_data = {
                    "raw": raw_out,
                    "thk": thk,
                    "act": act,
                    "status": "OK"
                }
                
                resp_bytes = json.dumps(resp_data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp_bytes)))
                self.end_headers()
                self.wfile.write(resp_bytes)
            except Exception as e:
                err_bytes = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err_bytes)))
                self.end_headers()
                self.wfile.write(err_bytes)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Silent logging for speed
        pass

if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), CommanderHandler)
    server.serve_forever()
