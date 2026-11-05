#!/usr/bin/env python3
"""Compare le suivi ONNX au suivi PyTorch d'origine (SAM2Base.track_step) sur une vidéo synthétique.

Usage : python verify.py --repo <clone EdgeTAM> --onnx <dossier> [--frames 12]
Réussi si l'IoU des masques reste supérieure à 0,98 sur chaque image.
"""
import argparse
import sys
import time

import numpy as np
import onnxruntime as ort
import torch

import export as E
from export import MEAN, STD, load_model


def scene(i):
    """Fond texturé, disque orange en mouvement et carré clair immobile. RVB 0-1, CHW."""
    y, x = np.mgrid[0:E.IMG, 0:E.IMG].astype(np.float32) / E.IMG
    img = np.stack([.05 + .1 * x, .3 + .2 * y, .5 + .2 * np.sin(9 * x + 5 * y)], 0)
    cx, cy = .25 + .025 * i, .45 + .012 * i
    d = ((x - cx) ** 2 + (y - cy) ** 2) < .08 ** 2
    img[0][d], img[1][d], img[2][d] = 1., .55, .1
    b = (x > .7) & (x < .85) & (y > .15) & (y < .3)
    img[0][b], img[1][b], img[2][b] = .9, .9, .85
    box = np.array([cx - .08, cy - .08, cx + .08, cy + .08], dtype=np.float32) * E.IMG
    return img[None], box


class OnnxTracker:
    """Même logique que le moteur JS : une mémoire de sélection et les 6 dernières, 16 pointeurs d'objet."""

    def __init__(self, d):
        o = ort.SessionOptions()
        s = lambda n: ort.InferenceSession(f"{d}/edgetam_{n}.onnx", o, providers=["CPUExecutionProvider"])
        self.enc, self.att, self.dec, self.mem = s("encoder"), s("attention"), s("decoder"), s("memory")
        self.cond = None
        self.past = []
        self.times = {}

    def run(self, name, sess, inp):
        t = time.time()
        r = sess.run(None, inp)
        self.times.setdefault(name, []).append(time.time() - t)
        return r

    def decode(self, feat, f0, f1, pts, labels, add):
        m, iou, p, sc = self.run("dec", self.dec, {"feat": feat, "high0": f0, "high1": f1, "points": pts,
                                                  "labels": labels, "add_no_mem": np.array(add, np.float32)})
        return m, iou, p, sc

    def first(self, img, box):
        f0, f1, f2 = self.run("enc", self.enc, {"image": img})
        pts = box.reshape(1, 2, 2)
        m, iou, p, sc = self.decode(f2, f0, f1, pts, np.array([[2, 3]], np.int64), 1.0)
        mask, ptr = m[:, :1], p[:, 0]  # avec une boîte : un seul masque, le premier
        self.cond = {"mem": self.run("mem", self.mem, {"feat": f2, "mask": mask})[0], "ptr": ptr}
        return mask

    def step(self, img):
        f0, f1, f2 = self.run("enc", self.enc, {"image": img})
        mems, tpos = [self.cond["mem"]], [6]
        recent = self.past[-6:]
        for k, e in enumerate(recent):
            mems.append(e["mem"])
            tpos.append(len(recent) - k - 1)
        # Pointeurs : la sélection, puis du plus récent au plus ancien (15 au plus).
        ptrs = [self.cond["ptr"]] + [e["ptr"] for e in reversed(self.past[-15:])]
        ptrs = np.concatenate(ptrs, 0).reshape(1, -1, 64)
        cond = self.run("att", self.att, {"feat": f2, "mem": np.concatenate(mems, 1),
                                         "tpos": np.array(tpos, np.int64), "ptrs": ptrs})[0]
        m, iou, p, sc = self.decode(cond, f0, f1, np.zeros((1, 1, 2), np.float32),
                                    -np.ones((1, 1), np.int64), 0.0)
        b = 1 + int(np.argmax(iou[0, 1:]))
        mask, ptr = m[:, b:b + 1], p[:, b]
        self.past.append({"mem": self.run("mem", self.mem, {"feat": f2, "mask": mask})[0], "ptr": ptr})
        return mask, float(sc.ravel()[0])


def reference(m, frames):
    """Le suivi d'origine, sans aucune modification."""
    mean = torch.tensor(MEAN).view(1, 3, 1, 1)
    std = torch.tensor(STD).view(1, 3, 1, 1)
    out = {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}}
    res = []
    for i, (img, box) in enumerate(frames):
        bo = m.forward_image((torch.from_numpy(img) - mean) / std)
        _, feats, pos, sizes = m._prepare_backbone_features(bo)
        pts = None
        if i == 0:
            pts = {"point_coords": torch.from_numpy(box).reshape(1, 2, 2),
                   "point_labels": torch.tensor([[2, 3]], dtype=torch.int32)}
        o = m.track_step(i, i == 0, feats, pos, sizes, pts, None, out, len(frames))
        out["cond_frame_outputs" if i == 0 else "non_cond_frame_outputs"][i] = o
        res.append(o["pred_masks"].numpy())
    return res


def iou(a, b):
    a, b = a > 0, b > 0
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--frames", type=int, default=12)
    ap.add_argument("--size", type=int, default=1024)
    a = ap.parse_args()
    m = load_model(a.repo, a.size)
    frames = [scene(i) for i in range(a.frames)]
    with torch.no_grad():
        ref = reference(m, frames)
    t = OnnxTracker(a.onnx)
    worst = 1.0
    for i, (img, box) in enumerate(frames):
        mask, sc = (t.first(img, box), 0) if i == 0 else t.step(img)
        v = iou(mask, ref[i])
        worst = min(worst, v)
        ys, xs = np.nonzero(mask[0, 0] > 0)
        c = (xs.mean() * 4 / E.IMG, ys.mean() * 4 / E.IMG) if len(xs) else (-1, -1)
        d = np.abs(mask - ref[i]).max()
        print(f"image {i:2d} IoU {v:.4f} écart logit max {d:6.2f} centre ({c[0]:.3f},{c[1]:.3f}) "
              f"vrai ({(box[0]+box[2])/2/E.IMG:.3f},{(box[1]+box[3])/2/E.IMG:.3f}) score {sc:.1f}")
    print({k: f"{1000 * np.median(v):.0f} ms" for k, v in t.times.items()})
    print("RÉUSSI" if worst > .98 else "ÉCHEC", f"IoU minimale {worst:.4f}")
    sys.exit(0 if worst > .98 else 1)


if __name__ == "__main__":
    main()
