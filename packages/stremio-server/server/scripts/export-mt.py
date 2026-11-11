"""Exporta o Helsinki-NLP/opus-mt-tc-big-itc-itc oficial para ONNX int8 (uso: setup-mt.sh).

    python export-mt.py <pasta-do-modelo> [--lines lines.json] [--keep-fp32]

Gera em <pasta-do-modelo>:
  encoder_model.onnx            input_ids, attention_mask -> last_hidden_state
  decoder_model.onnx            1º passo: input_ids, encoder_hidden_states, encoder_attention_mask
                                -> logits, present.{i}.(decoder|encoder).(key|value)
  decoder_with_past_model.onnx  passos seguintes: input_ids, encoder_attention_mask,
                                past_key_values.{i}.(decoder|encoder).(key|value) -> logits, present.{i}.decoder.*
  config.json, vocab.json       do repositório oficial
  spm-pieces.json               peças + scores do source.spm (tokenizador Unigram em JS)
  tokenizer-fixture.json        ids do MarianTokenizer e traduções gulosas do ONNX int8 (teste de paridade)
  linguetta-mt.json             manifesto: modelo, revisão, idiomas de origem, data

O optimum não exporta aqui (optimum 2.x + optimum-onnx 0.1 quebram com o transformers 4.57 e o
optimum-cli quebra no Python 3.14), então o export é direto com torch.onnx.export (exportador
TorchScript) sobre módulos que embrulham o encoder e o decoder do MarianMTModel.
"""

import argparse
import json
import re
import os
import shutil
import sys
import time
from datetime import datetime, timezone

import numpy as np
import torch
from torch import nn

MODEL_ID = "Helsinki-NLP/opus-mt-tc-big-itc-itc"
# Idiomas de origem do card oficial (campo `language`). O alvo vem dos tokens >>xxx<< do vocab.json.
SOURCE_LANGUAGES = ["ast", "ca", "es", "fr", "gl", "it", "lad", "oc", "pms", "pt", "ro"]
MAX_NEW_TOKENS = 128

# Falas extras da fixture: acentos, apóstrofos, números, espaços repetidos, NFKC, caractere sem peça.
EXTRA_LINES = [
    "Ciao.",
    "L'anno scorso è andato tutto storto, perché nessuno ascoltava.",
    "  Spazi   ripetuti\te tab  ",
    "Ho 42 anni e 3,5 milioni di debiti.",
    "ﬁne della storia… ½ porzione",
    "¿Dónde está la estación de tren?",
    "Je ne sais pas où il est allé hier soir.",
    "Não sei o que dizer, sinceramente.",
    "Nu știu ce să fac acum.",
    "Ok 😀 andiamo — subito!",
    "„Citazione“ «tra» \"virgolette\"",
    "ÉTAIT-CE VRAIMENT NÉCESSAIRE ?",
]


def log(*a):
    print("[export-mt]", *a, file=sys.stderr, flush=True)


class Encoder(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.encoder = model.get_encoder()

    def forward(self, input_ids, attention_mask):
        return self.encoder(input_ids=input_ids, attention_mask=attention_mask, return_dict=True).last_hidden_state


def flat_cache(cache, n_layers, with_cross):
    out = []
    for i in range(n_layers):
        sa = cache.self_attention_cache.layers[i]
        out += [sa.keys, sa.values]
        if with_cross:
            ca = cache.cross_attention_cache.layers[i]
            out += [ca.keys, ca.values]
    return out


class DecoderFirst(nn.Module):
    """Passo 0: sem passado; devolve o cache de self-attention e o de cross-attention."""

    def __init__(self, model):
        super().__init__()
        self.decoder = model.get_decoder()
        self.lm_head = model.lm_head
        self.register_buffer("bias", model.final_logits_bias.clone())
        self.n = model.config.decoder_layers

    def forward(self, input_ids, encoder_hidden_states, encoder_attention_mask):
        from transformers.cache_utils import DynamicCache, EncoderDecoderCache

        cache = EncoderDecoderCache(DynamicCache(), DynamicCache())
        out = self.decoder(
            input_ids=input_ids,
            encoder_hidden_states=encoder_hidden_states,
            encoder_attention_mask=encoder_attention_mask,
            past_key_values=cache,
            use_cache=True,
            return_dict=True,
        )
        logits = self.lm_head(out.last_hidden_state) + self.bias
        return (logits, *flat_cache(out.past_key_values, self.n, True))


class DecoderWithPast(nn.Module):
    """Passos 1..n: recebe o passado; o cache de cross-attention entra pronto (is_updated)."""

    def __init__(self, model):
        super().__init__()
        self.decoder = model.get_decoder()
        self.lm_head = model.lm_head
        self.register_buffer("bias", model.final_logits_bias.clone())
        self.n = model.config.decoder_layers
        self.d = model.config.d_model

    def forward(self, input_ids, encoder_attention_mask, *past):
        from transformers.cache_utils import EncoderDecoderCache

        legacy = tuple(tuple(past[4 * i : 4 * i + 4]) for i in range(self.n))
        cache = EncoderDecoderCache.from_legacy_cache(legacy)
        # O decoder só roda a cross-attention se encoder_hidden_states existir; como as chaves e
        # valores já estão no cache, o tensor não é lido (vira constante morta no grafo).
        dummy = torch.zeros(input_ids.shape[0], 1, self.d, dtype=past[0].dtype)
        out = self.decoder(
            input_ids=input_ids,
            encoder_hidden_states=dummy,
            encoder_attention_mask=encoder_attention_mask,
            past_key_values=cache,
            use_cache=True,
            return_dict=True,
        )
        logits = self.lm_head(out.last_hidden_state) + self.bias
        return (logits, *flat_cache(out.past_key_values, self.n, False))


def kv_names(prefix, n, with_cross):
    names = []
    for i in range(n):
        names += [f"{prefix}.{i}.decoder.key", f"{prefix}.{i}.decoder.value"]
        if with_cross:
            names += [f"{prefix}.{i}.encoder.key", f"{prefix}.{i}.encoder.value"]
    return names


def export(model, out_dir):
    cfg = model.config
    n = cfg.decoder_layers
    heads = cfg.decoder_attention_heads
    hd = cfg.d_model // heads
    ids = torch.tensor([[10, 20, 30, 40, 50, 60, cfg.eos_token_id]], dtype=torch.long)
    mask = torch.ones_like(ids)
    kw = dict(opset_version=17, do_constant_folding=True, dynamo=False)

    with torch.inference_mode():
        log("exportando encoder…")
        torch.onnx.export(
            Encoder(model).eval(), (ids, mask), f"{out_dir}/encoder_model.onnx",
            input_names=["input_ids", "attention_mask"], output_names=["last_hidden_state"],
            dynamic_axes={"input_ids": {0: "b", 1: "src"}, "attention_mask": {0: "b", 1: "src"},
                          "last_hidden_state": {0: "b", 1: "src"}},
            **kw,
        )
        enc = model.get_encoder()(input_ids=ids, attention_mask=mask).last_hidden_state

        log("exportando decoder (passo 0)…")
        start = torch.tensor([[cfg.decoder_start_token_id]], dtype=torch.long)
        present0 = kv_names("present", n, True)
        dyn = {"input_ids": {0: "b", 1: "tgt"}, "encoder_hidden_states": {0: "b", 1: "src"},
               "encoder_attention_mask": {0: "b", 1: "src"}, "logits": {0: "b", 1: "tgt"}}
        for name in present0:
            dyn[name] = {0: "b", 2: "src" if ".encoder." in name else "tgt"}
        torch.onnx.export(
            DecoderFirst(model).eval(), (start, enc, mask), f"{out_dir}/decoder_model.onnx",
            input_names=["input_ids", "encoder_hidden_states", "encoder_attention_mask"],
            output_names=["logits", *present0], dynamic_axes=dyn, **kw,
        )

        log("exportando decoder com passado…")
        past_len = 3
        past = []
        for _ in range(n):
            past += [torch.randn(1, heads, past_len, hd), torch.randn(1, heads, past_len, hd),
                     torch.randn(1, heads, ids.shape[1], hd), torch.randn(1, heads, ids.shape[1], hd)]
        past_in = kv_names("past_key_values", n, True)
        present = kv_names("present", n, False)
        dyn = {"input_ids": {0: "b", 1: "tgt"}, "encoder_attention_mask": {0: "b", 1: "src"},
               "logits": {0: "b", 1: "tgt"}}
        for name in past_in:
            dyn[name] = {0: "b", 2: "src" if ".encoder." in name else "past"}
        for name in present:
            dyn[name] = {0: "b", 2: "past+1"}
        torch.onnx.export(
            DecoderWithPast(model).eval(), (start, mask, *past), f"{out_dir}/decoder_with_past_model.onnx",
            input_names=["input_ids", "encoder_attention_mask", *past_in],
            output_names=["logits", *present], dynamic_axes=dyn, **kw,
        )


def quantize(fp32_dir, out_dir):
    from onnxruntime.quantization import QuantType, quantize_dynamic

    for name in ["encoder_model", "decoder_model", "decoder_with_past_model"]:
        log(f"quantizando {name} (int8)…")
        quantize_dynamic(f"{fp32_dir}/{name}.onnx", f"{out_dir}/{name}.onnx", weight_type=QuantType.QInt8)


def export_pieces(spm_path, out_path):
    import sentencepiece as spm

    sp = spm.SentencePieceProcessor(model_file=spm_path)
    from sentencepiece import sentencepiece_model_pb2 as pb

    proto = pb.ModelProto()
    proto.ParseFromString(open(spm_path, "rb").read())
    ns = proto.normalizer_spec
    ts = proto.trainer_spec
    if ts.model_type != pb.TrainerSpec.UNIGRAM:
        raise SystemExit(f"source.spm não é Unigram (model_type={ts.model_type})")
    pieces = []
    for i in range(sp.get_piece_size()):
        # tipo: 1 normal, 2 unknown, 3 control, 4 user_defined, 5 unused, 6 byte
        pieces.append([sp.id_to_piece(i), sp.get_score(i), proto.pieces[i].type])
    json.dump(
        {
            "normalizer": ns.name,
            "addDummyPrefix": ns.add_dummy_prefix,
            "removeExtraWhitespaces": ns.remove_extra_whitespaces,
            "escapeWhitespaces": ns.escape_whitespaces,
            "byteFallback": ts.byte_fallback,
            "unkPiece": ts.unk_piece,
            "pieces": pieces,
        },
        open(out_path, "w"),
        ensure_ascii=False,
    )
    if ns.name != "nmt_nfkc" or not ns.add_dummy_prefix or not ns.remove_extra_whitespaces or ts.byte_fallback:
        log(f"AVISO: normalizador inesperado ({ns.name}, byte_fallback={ts.byte_fallback}); o tokenizador JS assume nmt_nfkc")


class OrtGreedy:
    """Decodificação gulosa com onnxruntime (a mesma lógica do src/mt/opus-mt.js)."""

    def __init__(self, d, cfg, threads=4):
        import onnxruntime as ort

        o = ort.SessionOptions()
        o.intra_op_num_threads = threads
        self.enc = ort.InferenceSession(f"{d}/encoder_model.onnx", o, providers=["CPUExecutionProvider"])
        self.dec0 = ort.InferenceSession(f"{d}/decoder_model.onnx", o, providers=["CPUExecutionProvider"])
        self.decp = ort.InferenceSession(f"{d}/decoder_with_past_model.onnx", o, providers=["CPUExecutionProvider"])
        self.cfg = cfg
        self.out0 = [x.name for x in self.dec0.get_outputs()]
        self.outp = [x.name for x in self.decp.get_outputs()]

    def __call__(self, ids):
        cfg = self.cfg
        ids = np.array([ids], dtype=np.int64)
        mask = np.ones_like(ids)
        (h,) = self.enc.run(None, {"input_ids": ids, "attention_mask": mask})
        res = dict(zip(self.out0, self.dec0.run(None, {
            "input_ids": np.array([[cfg.decoder_start_token_id]], dtype=np.int64),
            "encoder_hidden_states": h, "encoder_attention_mask": mask})))
        enc_kv = {k.replace("present", "past_key_values"): v for k, v in res.items() if ".encoder." in k}
        gen = []
        for _ in range(MAX_NEW_TOKENS):
            logits = res["logits"][0, -1].copy()
            logits[cfg.pad_token_id] = -np.inf
            nxt = int(logits.argmax())
            if nxt == cfg.eos_token_id:
                break
            gen.append(nxt)
            feeds = {"input_ids": np.array([[nxt]], dtype=np.int64), "encoder_attention_mask": mask, **enc_kv}
            for k, v in res.items():
                if ".decoder." in k:
                    feeds[k.replace("present", "past_key_values")] = v
            res = dict(zip(self.outp, self.decp.run(None, feeds)))
        return gen


def torch_greedy(model, ids):
    with torch.inference_mode():
        out = model.generate(
            input_ids=torch.tensor([ids]), attention_mask=torch.ones(1, len(ids), dtype=torch.long),
            num_beams=1, do_sample=False, max_new_tokens=MAX_NEW_TOKENS,
        )
    return [t for t in out[0].tolist() if t not in (model.config.decoder_start_token_id, model.config.eos_token_id)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--lines", help="JSON com uma lista de falas para verificar e para a fixture")
    ap.add_argument("--keep-fp32", action="store_true")
    ap.add_argument("--revision", default="main")
    a = ap.parse_args()

    from huggingface_hub import snapshot_download
    from transformers import MarianMTModel, MarianTokenizer

    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    log(f"baixando {MODEL_ID}@{a.revision}…")
    snap = snapshot_download(MODEL_ID, revision=a.revision,
                             allow_patterns=["*.json", "*.spm", "model.safetensors", "README.md"])
    revision = os.path.basename(snap.rstrip("/"))
    tok = MarianTokenizer.from_pretrained(snap)
    model = MarianMTModel.from_pretrained(snap, attn_implementation="eager").eval()
    cfg = model.config

    fp32 = os.path.join(out, "fp32")
    os.makedirs(fp32, exist_ok=True)
    t0 = time.time()
    export(model, fp32)
    # Os embrulhos nascem em modo treino e o torch.onnx.export restaura esse modo nos submódulos
    # compartilhados: sem isto o dropout fica ligado na referência PyTorch.
    model.eval()
    quantize(fp32, out)
    log(f"export + quantização: {time.time() - t0:.0f} s")

    for f in ["config.json", "vocab.json", "generation_config.json", "README.md"]:
        if os.path.exists(f"{snap}/{f}"):
            shutil.copy(f"{snap}/{f}", f"{out}/{f}" if f != "README.md" else f"{out}/MODEL_CARD.md")
    export_pieces(f"{snap}/source.spm", f"{out}/spm-pieces.json")

    lines = json.load(open(a.lines)) if a.lines else []
    lines = lines + EXTRA_LINES
    # Verificação: ONNX fp32 e int8 (guloso) contra o PyTorch (guloso) nas mesmas falas, alvo PT-BR.
    lang_tok = ">>pob<<"
    runs = {"fp32": OrtGreedy(fp32, cfg), "int8": OrtGreedy(out, cfg)}
    fixture = {"model": MODEL_ID, "revision": revision, "cases": []}
    same = {"fp32": 0, "int8": 0}
    times = []
    for line in lines:
        # Como o src/mt/opus-mt.js: " / " (quebra de linha da legenda) vira espaço antes de traduzir.
        ids = tok(f"{lang_tok} {re.sub(r'\s+/\s+', ' ', line)}").input_ids
        ref = torch_greedy(model, ids)
        res = {}
        for k, run in runs.items():
            t = time.perf_counter()
            res[k] = run(ids)
            if k == "int8":
                times.append((time.perf_counter() - t) * 1000)
            same[k] += res[k] == ref
        decode = lambda g: tok.decode(g, skip_special_tokens=True)
        if res["int8"] != ref:
            log(f"int8 ≠ torch: {line!r}\n    torch: {decode(ref)}\n    int8:  {decode(res['int8'])}")
        if res["fp32"] != ref:
            log(f"fp32 ≠ torch: {line!r}\n    torch: {decode(ref)}\n    fp32:  {decode(res['fp32'])}")
        fixture["cases"].append({
            "text": line, "langToken": lang_tok,
            "encoded": tok(line).input_ids,  # texto cru, sem token de idioma
            "output": res["int8"], "translation": decode(res["int8"]),
        })
    times.sort()
    report = {
        "lines": len(lines), "fp32_equal_torch": same["fp32"], "int8_equal_torch": same["int8"],
        "int8_median_ms": round(times[len(times) // 2]), "int8_max_ms": round(times[-1]),
    }
    log("verificação:", json.dumps(report))
    if same["fp32"] != len(lines):
        raise SystemExit("ONNX fp32 diverge do PyTorch: o export está errado")
    json.dump(fixture, open(f"{out}/tokenizer-fixture.json", "w"), ensure_ascii=False, indent=1)
    json.dump({
        "model": MODEL_ID, "revision": revision, "license": "CC-BY-4.0",
        "credit": "Helsinki-NLP / OPUS-MT (University of Helsinki)",
        "sourceLanguages": SOURCE_LANGUAGES, "quantization": "int8 dinâmico (QInt8)",
        "verification": report, "exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, open(f"{out}/linguetta-mt.json", "w"), ensure_ascii=False, indent=1)
    if not a.keep_fp32:
        shutil.rmtree(fp32)
    log(f"pronto: {out}")


if __name__ == "__main__":
    main()
