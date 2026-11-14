"""
Genera i materiali realistici di Oasis (nessun file scaricato): per ogni superficie
tre texture ripetibili senza giunture
  <nome>_c.jpg  colore di dettaglio (centrato sul grigio medio: il gioco lo moltiplica
                per il colore del materiale, così le palette restano quelle dei modelli)
  <nome>_n.jpg  mappa delle normali (rilievo)
  <nome>_r.jpg  ruvidità (bianco = opaco, nero = lucido)

Tecniche: rumore frattale per sintesi spettrale (perfettamente periodico), celle di
Voronoi toroidali, graffi, giunture e rivetti, rilievo -> normali con differenze
finite periodiche.

Uso:  python3 tools/textures/generate.py public/textures
"""
import math
import os
import sys

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'public/textures'
os.makedirs(OUT, exist_ok=True)


# ----------------------------------------------------------------------------- base
def fbm(n, lo=2, hi=None, beta=2.0, seed=0, aniso=(1.0, 1.0)):
    """Rumore frattale periodico: spettro con potenza ~ 1/f^beta tra le frequenze lo..hi."""
    rng = np.random.default_rng(seed)
    hi = hi or n // 2
    fy = np.fft.fftfreq(n)[:, None] * n * aniso[1]
    fx = np.fft.fftfreq(n)[None, :] * n * aniso[0]
    f = np.sqrt(fx * fx + fy * fy)
    amp = np.where((f >= lo) & (f <= hi), 1.0 / np.maximum(f, 1e-6) ** (beta / 2), 0.0)
    phase = np.exp(2j * np.pi * rng.random((n, n)))
    img = np.real(np.fft.ifft2(amp * phase))
    img -= img.min()
    return img / (img.max() + 1e-9)


def voronoi(n, cells, seed=0, jitter=1.0):
    """Celle di Voronoi periodiche: (distanza dal punto più vicino, bordo F2-F1, id cella)."""
    rng = np.random.default_rng(seed)
    pts = []
    for j in range(cells):
        for i in range(cells):
            pts.append(((i + 0.5 + (rng.random() - 0.5) * jitter) / cells, (j + 0.5 + (rng.random() - 0.5) * jitter) / cells))
    pts = np.array(pts)
    y, x = np.mgrid[0:n, 0:n] / n
    f1 = np.full((n, n), 9.0)
    f2 = np.full((n, n), 9.0)
    cid = np.zeros((n, n), dtype=np.int32)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(x - px)
        dy = np.abs(y - py)
        dx = np.minimum(dx, 1 - dx)
        dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        cid = np.where(closer, k, cid)
        f1 = np.where(closer, d, f1)
    return f1 * cells, (f2 - f1) * cells, cid


def scratches(n, count, seed=0, length=(0.05, 0.3), width=1.0, curve=0.0):
    rng = np.random.default_rng(seed)
    img = np.zeros((n, n))
    for _ in range(count):
        x, y = rng.random() * n, rng.random() * n
        a = rng.random() * np.pi * 2
        L = rng.uniform(*length) * n
        steps = int(L)
        depth = rng.uniform(0.3, 1.0)
        for s in range(steps):
            a += (rng.random() - 0.5) * curve
            x = (x + np.cos(a)) % n
            y = (y + np.sin(a)) % n
            fade = math.sin(math.pi * s / steps)
            img[int(y) % n, int(x) % n] = max(img[int(y) % n, int(x) % n], depth * fade)
            if width > 1:
                img[int(y + 1) % n, int(x) % n] = max(img[int(y + 1) % n, int(x) % n], depth * fade * 0.5)
    return img


def blur(img, r=1):
    out = img.copy()
    for _ in range(r):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5
    return out


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    return np.stack([-dx / l, dy / l, nz / l], -1)


def norm01(a):
    a = a - a.min()
    return a / (a.max() + 1e-9)


def save(name, color, height, rough, strength, quality=88):
    """color: (n,n,3) moltiplicatore attorno a 1.0 -> salvato centrato su 128."""
    c = np.clip(color * 0.5, 0, 1)
    Image.fromarray((c * 255).astype(np.uint8)).save(os.path.join(OUT, f'{name}_c.jpg'), quality=quality)
    nrm = normal_from_height(height, strength)
    Image.fromarray(((nrm * 0.5 + 0.5) * 255).astype(np.uint8)).save(os.path.join(OUT, f'{name}_n.jpg'), quality=92)
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, f'{name}_r.jpg'), quality=quality)
    print('  ', name, color.shape[0])


def tint(gray, rgb):
    return gray[..., None] * np.array(rgb)[None, None, :]


def mean1(c):
    """Normalizza il colore a media 1 (moltiplicatore neutro)."""
    return c / c.reshape(-1, 3).mean(0)


# ----------------------------------------------------------------------------- materiali
def polished_stone(n=1024):
    """Pietra scura levigata (pavimento dell'atrio): granulosità, venature, aloni e micrograffi."""
    grain = fbm(n, 64, n // 2, 0.6, 1)
    macro = fbm(n, 1, 8, 2.4, 2)
    warp = fbm(n, 2, 16, 2.0, 3)
    y, x = np.mgrid[0:n, 0:n] / n
    vein_f = np.sin((x * 2 + y * 1 + warp * 2.2) * np.pi * 2)
    veins = np.exp(-np.abs(vein_f) * 18) * (fbm(n, 2, 16, 2, 4) > 0.45)
    flecks = (fbm(n, 128, n // 2, 0.0, 5) > 0.78).astype(float) * 0.6
    sc = blur(scratches(n, 120, 6, (0.01, 0.05), curve=0.0), 1) * 0.6
    v = 0.92 + (grain - 0.5) * 0.18 + (macro - 0.5) * 0.25 + veins * 0.55 + flecks * 0.25 + sc * 0.08
    color = mean1(tint(v, (0.98, 1.0, 1.04)))
    height = grain * 0.15 + veins * 0.25 - sc * 0.6
    smudge = fbm(n, 2, 24, 2.0, 7)
    rough = 0.16 + smudge ** 2 * 0.35 + sc * 0.3 + grain * 0.05
    save('stone_polished', color, height, rough, 6)


def painted_metal(n=1024):
    """Metallo verniciato a pannelli: giunture, rivetti, spazzolatura, usura sugli spigoli, sporco."""
    y, x = np.mgrid[0:n, 0:n] / n
    px = (x * 2) % 1
    py = (y * 4) % 1
    seam = np.minimum(np.minimum(px, 1 - px) * 2, np.minimum(py, 1 - py) * 4)
    groove = np.clip(seam * 40, 0, 1)
    rivet = np.zeros((n, n))
    for cx in (0.04, 0.96):
        for cy in (0.12, 0.88):
            d = np.sqrt(((px - cx) * 2) ** 2 + ((py - cy) * 1) ** 2)
            rivet = np.maximum(rivet, np.clip(1 - d / 0.035, 0, 1))
    brushed = fbm(n, 4, n // 2, 1.0, 11, aniso=(0.05, 1.0))
    grime = fbm(n, 2, 24, 2.2, 12)
    wear = np.clip((1 - np.clip(seam * 12, 0, 1)) * (fbm(n, 16, 128, 1.2, 13) > 0.55), 0, 1)
    sc = blur(scratches(n, 160, 14, (0.01, 0.06), curve=0.3), 1)
    v = 0.95 + (brushed - 0.5) * 0.08 - (grime ** 2) * 0.35 + wear * 0.25 + sc * 0.2 - (1 - groove) * 0.45
    color = mean1(tint(v, (1.0, 1.0, 1.0)))
    height = groove * 0.6 + rivet ** 0.5 * 0.5 + brushed * 0.04 - sc * 0.3
    rough = 0.38 + grime * 0.3 + brushed * 0.08 - wear * 0.15 + (1 - groove) * 0.3
    save('metal_panels', color, height, rough, 10)


def concrete(n=1024):
    base = fbm(n, 4, n // 2, 1.6, 21)
    pores = (fbm(n, 96, n // 2, 0.0, 22) > 0.8).astype(float)
    stains = fbm(n, 1, 12, 2.4, 23)
    cracks = np.exp(-voronoi(n, 5, 24, 0.9)[1] * 60) * (fbm(n, 1, 3, 2, 25) > 0.6)
    v = 0.9 + (base - 0.5) * 0.25 - pores * 0.2 + (stains - 0.5) * 0.35 - cracks * 0.5
    color = mean1(tint(v, (1.0, 0.99, 0.97)))
    height = base * 0.4 - pores * 0.4 - cracks * 0.8
    rough = 0.75 + base * 0.15 + pores * 0.1 - stains * 0.1
    save('concrete', color, height, rough, 6)


def rock(n=1024):
    f1, edge, _ = voronoi(n, 7, 31, 1.0)
    ridged = 1 - np.abs(fbm(n, 4, n // 2, 1.8, 32) * 2 - 1)
    strata = np.sin((np.mgrid[0:n, 0:n][0] / n * 9 + fbm(n, 2, 12, 2, 33) * 2) * np.pi * 2) * 0.5 + 0.5
    cracks = np.exp(-edge * 14)
    h = ridged * 0.5 + strata * 0.2 + f1 * 0.2 - cracks * 0.5 + fbm(n, 64, n // 2, 1, 34) * 0.15
    lichen = (fbm(n, 6, 64, 1.8, 35) > 0.66).astype(float) * fbm(n, 32, 256, 1, 36)
    v = 0.85 + (h - 0.4) * 0.5 - cracks * 0.3
    color = mean1(tint(v, (1.0, 0.97, 0.95)) + tint(lichen, (-0.15, 0.08, -0.12)))
    rough = 0.82 + cracks * 0.15 - ridged * 0.1
    save('rock', color, h, rough, 14)


def ground(n=1024):
    """Terreno: zolle, sassolini, fili d'erba schiacciati e terra (moltiplica i colori del terreno)."""
    soil = fbm(n, 8, n // 2, 1.6, 41)
    f1, edge, cid = voronoi(n, 24, 42, 1.0)
    pebbles = np.clip(1 - f1 * 2.8, 0, 1) * (np.random.default_rng(43).random(cid.max() + 1)[cid] > 0.82)
    blades = fbm(n, 32, n // 2, 0.4, 44, aniso=(0.25, 1.0))
    clumps = fbm(n, 4, 32, 2.0, 45)
    v = 0.92 + (soil - 0.5) * 0.3 + (blades - 0.5) * 0.25 * clumps + pebbles * 0.3
    color = mean1(tint(v, (1.0, 1.0, 1.0)) + tint(pebbles, (0.05, 0.02, 0.0)))
    height = soil * 0.3 + blades * 0.3 * clumps + pebbles * 0.7
    rough = 0.85 + soil * 0.1 - pebbles * 0.2
    save('ground', color, height, rough, 8)


def wood_planks(n=512):
    y, x = np.mgrid[0:n, 0:n] / n
    plank = np.floor(y * 4)
    rng = np.random.default_rng(51)
    offs = rng.random(8)
    shade = rng.uniform(0.85, 1.15, 8)
    warp = fbm(n, 2, 32, 2, 52)
    grain = np.sin((y * 4 % 1 + warp * 0.6 + offs[plank.astype(int) % 8]) * 60) * 0.5 + 0.5
    rings = fbm(n, 8, 128, 1.0, 53, aniso=(0.08, 1.0))
    gap = np.minimum(y * 4 % 1, 1 - y * 4 % 1)
    gapm = np.clip(gap * 60, 0, 1)
    v = (0.85 + grain * 0.18 + (rings - 0.5) * 0.25) * shade[plank.astype(int) % 8] * (0.45 + 0.55 * gapm)
    color = mean1(tint(v, (1.0, 0.97, 0.93)))
    height = grain * 0.15 + rings * 0.1 + gapm * 0.6
    rough = 0.62 + rings * 0.15 + (1 - gapm) * 0.2
    save('wood', color, height, rough, 6)


def bark(n=512):
    furrows = fbm(n, 6, 128, 1.4, 61, aniso=(1.0, 0.12))
    cells = voronoi(n, 10, 62, 1.0)[1]
    h = (1 - np.abs(furrows * 2 - 1)) * 0.7 + np.exp(-cells * 10) * -0.3 + fbm(n, 64, n // 2, 1, 63) * 0.2
    v = 0.8 + h * 0.35
    color = mean1(tint(v, (1.0, 0.95, 0.9)))
    rough = 0.9 - h * 0.1
    save('bark', color, h, rough, 16)


def stone_blocks(n=1024):
    """Muratura a blocchi irregolari con malta (castello, borgo, pietra)."""
    y, x = np.mgrid[0:n, 0:n] / n
    rows = 6
    row = np.floor(y * rows)
    shift = (row % 2) * 0.5 + np.random.default_rng(71).random(rows)[row.astype(int) % rows] * 0.2
    bx = (x * 3 + shift) % 1
    by = (y * rows) % 1
    mortar = np.minimum(np.minimum(bx, 1 - bx) * 3 * 1.6, np.minimum(by, 1 - by) * 1.0)
    mm = np.clip(mortar * 18, 0, 1)
    block_id = (np.floor(x * 3 + shift) + row * 7).astype(int)
    tone = np.random.default_rng(72).uniform(0.82, 1.15, block_id.max() + 1)[block_id]
    chip = fbm(n, 8, n // 2, 1.6, 73)
    bevel = np.clip(mortar * 6, 0, 1) ** 0.5
    v = tone * (0.85 + chip * 0.25) * (0.55 + 0.45 * mm)
    color = mean1(tint(v, (1.0, 0.98, 0.95)))
    height = bevel * 0.7 + chip * 0.25
    rough = 0.8 + (1 - mm) * 0.15 + chip * 0.05
    save('stone_blocks', color, height, rough, 10)


def plaster(n=512):
    base = fbm(n, 4, n // 2, 1.3, 81)
    patches = fbm(n, 1, 8, 2.4, 82)
    v = 0.95 + (base - 0.5) * 0.12 + (patches - 0.5) * 0.2
    color = mean1(tint(v, (1.0, 0.99, 0.97)))
    save('plaster', color, base * 0.5, 0.85 + base * 0.1, 4)


def fabric(n=512):
    """Trama del tessuto tecnico delle tute (moltiplica il colore del vestito)."""
    y, x = np.mgrid[0:n, 0:n] / n
    k = 64
    warp = np.sin(x * k * np.pi * 2) * 0.5 + 0.5
    weft = np.sin(y * k * np.pi * 2) * 0.5 + 0.5
    checker = ((np.floor(x * k) + np.floor(y * k)) % 2)
    weave = np.where(checker > 0, warp, weft)
    fuzz = fbm(n, 64, n // 2, 0.5, 91)
    dirt = fbm(n, 2, 16, 2.2, 92)
    v = 0.95 + (weave - 0.5) * 0.1 + (fuzz - 0.5) * 0.06 - dirt ** 3 * 0.2
    color = mean1(tint(v, (1.0, 1.0, 1.0)))
    save('fabric', color, weave * 0.6 + fuzz * 0.2, 0.75 + fuzz * 0.15, 3)


def foliage(n=512):
    """Massa di foglie: tante piccole foglie sovrapposte con luce e ombra."""
    f1, edge, cid = voronoi(n, 18, 101, 1.0)
    rng = np.random.default_rng(102)
    tone = rng.uniform(0.75, 1.2, cid.max() + 1)[cid]
    leaf = np.clip(1 - f1 * 1.4, 0, 1)
    vein = np.exp(-edge * 30)
    h = leaf * 0.8 - vein * 0.3
    v = tone * (0.6 + leaf * 0.5) - vein * 0.2
    color = mean1(tint(v, (1.0, 1.0, 1.0)))
    rough = 0.65 - leaf * 0.2
    save('foliage', color, h, rough, 10)


print('Genero i materiali in', OUT)
polished_stone()
painted_metal()
concrete()
rock()
ground()
wood_planks()
bark()
stone_blocks()
plaster()
fabric()
foliage()
print('fatto')
