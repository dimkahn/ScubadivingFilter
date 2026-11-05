#!/usr/bin/env python3
"""Exporte EdgeTAM en quatre modèles ONNX pour le moteur (assets/engine/vendor).

Le dépôt d'origine n'exporte que la segmentation d'image (CoreML) : il manque la mémoire, indispensable au
suivi vidéo. Ici, chaque module est exporté avec le comportement de SAM2Base :

  edgetam_encoder   image RVB 0-1 (1, 3, N, N)            -> feat0, feat1, feat2
  edgetam_attention feat2 + mémoires + pointeurs d'objet  -> feat2 conditionné
  edgetam_decoder   feat2 + feat0/1 + points              -> 4 masques, IoU, pointeurs, score d'objet
  edgetam_memory    feat2 brut + masque basse résolution  -> mémoire (1, 512, 64)

Usage : python export.py --repo <clone EdgeTAM> --out <dossier> [--size 512]
"""
import argparse
import math
import os
import sys

import torch
import torch.nn as nn
import torch.nn.functional as F

MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
NO_OBJ_SCORE = -1024.0
IMG = 1024


def grid():
    return IMG // 16


def rope_table(dim, end_x, end_y, theta=10000.0):
    """compute_axial_cis, en cosinus et sinus plutôt qu'en nombres complexes (absents d'ONNX)."""
    freqs = 1.0 / (theta ** (torch.arange(0, dim, 4)[: dim // 4].float() / dim))
    t = torch.arange(end_x * end_y, dtype=torch.float32)
    tx, ty = t % end_x, torch.div(t, end_x, rounding_mode="floor")
    ang = torch.cat([torch.outer(tx, freqs), torch.outer(ty, freqs)], dim=-1)
    return torch.cos(ang), torch.sin(ang)


def rotate(x, cos, sin):
    """x : (B, têtes, N, C), avec C = 2 * cos.shape[-1]. Multiplication complexe, écrite en réels."""
    a, b = x[..., 0::2], x[..., 1::2]
    return torch.stack([a * cos - b * sin, a * sin + b * cos], dim=-1).flatten(-2)


def attend(self, q, k, v):
    q = self._separate_heads(q, self.num_heads)
    k = self._separate_heads(k, self.num_heads)
    v = self._separate_heads(v, self.num_heads)
    return q, k, v


def self_attn_forward(self, q, k, v, num_k_exclude_rope=0):
    q, k, v = attend(self, self.q_proj(q), self.k_proj(k), self.v_proj(v))
    q, k = rotate(q, self._cos, self._sin), rotate(k, self._cos, self._sin)
    return self.out_proj(self._recombine_heads(F.scaled_dot_product_attention(q, k, v)))


def cross_attn_forward(self, q, k, v, num_k_exclude_rope=0, rope_k_repeat=-1):
    q, k, v = attend(self, self.q_proj(q), self.k_proj(k), self.v_proj(v))
    q = rotate(q, self._cos_q, self._sin_q)
    k = rotate(k, self._cos_k, self._sin_k)
    return self.out_proj(self._recombine_heads(F.scaled_dot_product_attention(q, k, v)))


class Encoder(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m
        self.register_buffer("mean", torch.tensor(MEAN).view(1, 3, 1, 1))
        self.register_buffer("std", torch.tensor(STD).view(1, 3, 1, 1))

    def forward(self, image):
        out = self.m.forward_image((image - self.mean) / self.std)
        f = out["backbone_fpn"][-3:]
        return f[0], f[1], f[2]


class Attention(nn.Module):
    """mem : (1, S*512, 64), tpos : (S,) indice d'ancienneté, ptrs : (1, M, 64), M >= 4."""

    def __init__(self, m, curr_pos, mem_pos):
        super().__init__()
        self.ma = m.memory_attention
        self.register_buffer("tpos_table", m.maskmem_tpos_enc.detach().squeeze(1).squeeze(1))
        self.register_buffer("curr_pos", curr_pos)  # (1, grille², 256)
        self.register_buffer("mem_pos", mem_pos)  # (1, 512, 64)
        c, s = rope_table(256, grid(), grid())
        self.register_buffer("cos_q", c)
        self.register_buffer("sin_q", s)
        # Dans chaque mémoire, 256 jetons 1D sans rotation, puis 256 jetons 2D (grille 16×16).
        c, s = rope_table(256, 16, 16)
        self.register_buffer("cos_mem", torch.cat([torch.ones_like(c), c], dim=0))
        self.register_buffer("sin_mem", torch.cat([torch.zeros_like(s), s], dim=0))

    def forward(self, feat, mem, tpos, ptrs):
        b, c, h, w = feat.shape
        curr = feat.flatten(2).transpose(1, 2)
        n = mem.shape[1]
        idx = torch.arange(n) % 512
        m = ptrs.shape[1]
        cos_k = torch.cat([self.cos_mem[idx], torch.ones(m, 128)], dim=0)
        sin_k = torch.cat([self.sin_mem[idx], torch.zeros(m, 128)], dim=0)
        s_pos = self.mem_pos + self.tpos_table[tpos].unsqueeze(1)  # (S, 512, 64)
        pos = torch.cat([s_pos.reshape(1, -1, 64), torch.zeros_like(ptrs)], dim=1)
        memory = torch.cat([mem, ptrs], dim=1)
        out = curr + 0.1 * self.curr_pos
        for layer in self.ma.layers:
            layer.self_attn._cos, layer.self_attn._sin = self.cos_q, self.sin_q
            ca = layer.cross_attn_image
            ca._cos_q, ca._sin_q, ca._cos_k, ca._sin_k = self.cos_q, self.sin_q, cos_k, sin_k
            out = layer(tgt=out, memory=memory, pos=pos, query_pos=self.curr_pos,
                        num_k_exclude_rope=1, rope_k_repeat=1)
        out = self.ma.norm(out)
        return out.transpose(1, 2).reshape(b, c, h, w)


class Decoder(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m
        self.pe = m.sam_prompt_encoder
        self.register_buffer("dense_pe", self.pe.get_dense_pe().detach())

    def embed(self, points, labels):
        # _embed_points sans affectation booléenne. Le point de bourrage est ajouté comme dans l'original.
        pad_p = torch.zeros((1, 1, 2))
        pad_l = -torch.ones((1, 1), dtype=labels.dtype)
        p = torch.cat([points + 0.5, pad_p], dim=1)
        l = torch.cat([labels, pad_l], dim=1)
        e = self.pe.pe_layer._pe_encoding(p / IMG)
        on = lambda v: (l == v).unsqueeze(-1).float()
        e = e * (1 - on(-1)) + on(-1) * self.pe.not_a_point_embed.weight
        for i in range(4):
            e = e + on(i) * self.pe.point_embeddings[i].weight
        return e

    def forward(self, feat, high0, high1, points, labels, add_no_mem):
        src = feat + add_no_mem * self.m.no_mem_embed.view(1, 256, 1, 1)
        sparse = self.embed(points, labels)
        dense = self.pe.no_mask_embed.weight.reshape(1, -1, 1, 1).expand(1, -1, grid(), grid())
        masks, iou, tokens, score = self.m.sam_mask_decoder.predict_masks(
            image_embeddings=src, image_pe=self.dense_pe, sparse_prompt_embeddings=sparse,
            dense_prompt_embeddings=dense, repeat_image=False, high_res_features=[high0, high1])
        present = (score > 0).float()  # (1, 1)
        masks = torch.where(score[:, None, None] > 0, masks, torch.full_like(masks, NO_OBJ_SCORE))
        ptrs = self.m.obj_ptr_proj(tokens)
        ptrs = present.unsqueeze(-1) * ptrs + (1 - present.unsqueeze(-1)) * self.m.no_obj_ptr.view(1, 1, 256)
        return masks, iou, ptrs, score


class Memory(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, feat, low_mask):
        hi = F.interpolate(low_mask, size=(IMG, IMG), mode="bilinear", align_corners=False)
        mask = torch.sigmoid(hi) * self.m.sigmoid_scale_for_mem_enc + self.m.sigmoid_bias_for_mem_enc
        out = self.m.memory_encoder(feat, mask, skip_mask_sigmoid=True)
        latents, _ = self.m.spatial_perceiver(out["vision_features"], out["vision_pos_enc"][0])
        return latents


def load_model(repo, size=1024):
    global IMG
    IMG = size
    sys.path.insert(0, repo)
    import sam2.modeling.backbones.timm as tb
    real = tb.create_model
    # Les poids viennent de edgetam.pt : inutile de télécharger ceux de la dorsale.
    tb.create_model = lambda *a, **k: real(*a, **{**k, "pretrained": False})
    from sam2.build_sam import build_sam2
    # Une résolution plus basse réutilise les mêmes poids : seules les grilles de position changent.
    over = [f"++model.image_size={size}",
            f"++model.memory_attention.layer.cross_attention.q_sizes=[{size // 16},{size // 16}]"]
    m = build_sam2("edgetam.yaml", os.path.join(repo, "checkpoints", "edgetam.pt"), device="cpu", mode="eval",
                   hydra_overrides_extra=over)
    from timm.models._manipulate import reparameterize_model
    reparameterize_model(m.image_encoder.trunk.body, inplace=True)  # mêmes sorties, branches fusionnées
    return m


def patch(m):
    """À appeler après avoir relevé les références PyTorch : remplace les attentions par la version réelle."""
    import types
    for layer in m.memory_attention.layers:
        layer.self_attn.forward = types.MethodType(self_attn_forward, layer.self_attn)
        layer.cross_attn_image.forward = types.MethodType(cross_attn_forward, layer.cross_attn_image)


def constants(m):
    with torch.no_grad():
        img = torch.zeros(1, 3, IMG, IMG)
        bo = m.forward_image(img)
        curr_pos = bo["vision_pos_enc"][-1].flatten(2).transpose(1, 2).detach().clone()
        me = m.memory_encoder(bo["backbone_fpn"][-1], torch.zeros(1, 1, IMG, IMG), skip_mask_sigmoid=True)
        _, mem_pos = m.spatial_perceiver(me["vision_features"], me["vision_pos_enc"][0])
    return curr_pos, mem_pos.detach().clone()


def export(mod, args, path, inputs, outputs, dyn=None):
    torch.onnx.export(mod.eval(), args, path, input_names=inputs, output_names=outputs, dynamic_axes=dyn or {},
                      opset_version=17, do_constant_folding=True, dynamo=False)
    print(f"{os.path.basename(path)} : {os.path.getsize(path)/1e6:.1f} Mo")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=1024, help="côté de l'image d'entrée, multiple de 16")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    m = load_model(a.repo, a.size)
    curr_pos, mem_pos = constants(m)
    patch(m)
    with torch.no_grad():
        g = grid()
        f0 = torch.zeros(1, 32, 4 * g, 4 * g)
        f1 = torch.zeros(1, 64, 2 * g, 2 * g)
        f2 = torch.zeros(1, 256, g, g)
        export(Encoder(m), (torch.zeros(1, 3, IMG, IMG),), f"{a.out}/edgetam_encoder.onnx",
               ["image"], ["feat0", "feat1", "feat2"])
        export(Attention(m, curr_pos, mem_pos),
               (f2, torch.zeros(1, 1024, 64), torch.tensor([6, 0], dtype=torch.int64), torch.zeros(1, 8, 64)),
               f"{a.out}/edgetam_attention.onnx", ["feat", "mem", "tpos", "ptrs"], ["out"],
               {"mem": {1: "n"}, "tpos": {0: "s"}, "ptrs": {1: "m"}})
        export(Decoder(m), (f2, f0, f1, torch.zeros(1, 2, 2), torch.tensor([[2, 3]], dtype=torch.int64),
                            torch.tensor(1.0)),
               f"{a.out}/edgetam_decoder.onnx", ["feat", "high0", "high1", "points", "labels", "add_no_mem"],
               ["masks", "iou", "ptrs", "score"], {"points": {1: "p"}, "labels": {1: "p"}})
        export(Memory(m), (f2, torch.zeros(1, 1, 4 * g, 4 * g)), f"{a.out}/edgetam_memory.onnx",
               ["feat", "mask"], ["mem"])


if __name__ == "__main__":
    main()
