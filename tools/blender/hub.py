"""
Genera l'hub di Oasis da zero con Blender ed esporta:
  public/models/hub.glb   geometria con occlusione ambientale cotta (Cycles) nei colori dei vertici
  public/models/hub.json  layout per il gioco: collisioni, piattaforme, sedute, portali, specchio

Convenzioni di nomi lette dal gioco:
  Water*            superfici d'acqua (shader animato)
  Portal_<id>       superficie del portale (shader)
  Board_<id>        pannello con texture disegnata nel gioco (UV 0..1)
  MirrorSurface     sostituita da uno specchio reale
  Crystal           cristallo animato al centro

Uso:  python tools/blender/hub.py -- public/models [--fast]
"""
import json
import math
import os
import random
import sys

import bpy  # noqa: I001
import bmesh
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import apply_modifiers, curve_strand, join, link, material, mesh_object, reset_scene, set_material  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_DIR = args[0] if args else 'public/models'
FAST = '--fast' in args
PI = math.pi
reset_scene()
rng = random.Random(7)

# Mondi (devono corrispondere a src/world/worlds.js)
WORLDS = ['arena', 'music', 'racing', 'school', 'quest', 'market']
WORLD_COLORS = ['#ff4d6d', '#ff3df2', '#ffb02e', '#7dff6a', '#8a7bff', '#39e6ff']

PLAZA_R = 24.0
ISLAND_R = 50.5
PORTAL_R = 36.0


def hex_rgb(h, a=1.0):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[x ** 2.2 for x in c], a)


def G(x, y, z):
    """Coordinate del gioco (Y in alto, +Z verso lo spawn) -> Blender (Z in alto)."""
    return Vector((x, -z, y))


def game(v):
    return [round(v.x, 3), round(v.z, 3), round(-v.y, 3)]


def place(obj, gx, gy, gz, facing=0.0, scale=1.0):
    """facing: angolo nel gioco (0 = guarda verso +Z del gioco)."""
    obj.location = G(gx, gy, gz)
    obj.rotation_euler = (0, 0, facing)
    obj.scale = (scale, scale, scale)
    return obj


def portal_angle(i):
    return (i / 6) * 2 * PI + PI / 6


# ------------------------------------------------------------------ materiali
MAT = {
    'Tiles': material('Tiles', (0.78, 0.72, 0.8, 1), rough=0.8),
    'Grout': material('Grout', (0.32, 0.27, 0.38, 1), rough=0.95),
    'Grass': material('Grass', (0.33, 0.62, 0.32, 1), rough=1.0),
    'Path': material('Path', (0.86, 0.8, 0.74, 1), rough=0.85),
    'Stone': material('Stone', (0.93, 0.89, 0.96, 1), rough=0.6),
    'StoneDark': material('StoneDark', (0.58, 0.5, 0.7, 1), rough=0.7),
    'Rock': material('Rock', (0.55, 0.45, 0.62, 1), rough=0.9),
    'Wood': material('Wood', (0.72, 0.45, 0.28, 1), rough=0.7),
    'Metal': material('Metal', (0.22, 0.18, 0.3, 1), rough=0.35, metal=0.7),
    'Gold': material('Gold', (1.0, 0.78, 0.4, 1), rough=0.25, metal=1.0),
    'Bark': material('Bark', (0.42, 0.26, 0.24, 1), rough=0.9),
    'LeavesPink': material('LeavesPink', (1.0, 0.62, 0.78, 1), rough=0.8),
    'LeavesGreen': material('LeavesGreen', (0.38, 0.72, 0.36, 1), rough=0.8),
    'LeavesPine': material('LeavesPine', (0.2, 0.52, 0.38, 1), rough=0.8),
    'Bush': material('Bush', (0.3, 0.6, 0.38, 1), rough=0.85),
    'Flower': material('Flower', (1, 1, 1, 1), rough=0.8),
    'Water': material('Water', (0.3, 0.7, 0.95, 1), rough=0.05),
    'GlowCyan': material('GlowCyan', (0.5, 0.95, 1.0, 1), emissive=(0.5, 0.95, 1.0, 3.0)),
    'GlowPink': material('GlowPink', (1.0, 0.6, 0.9, 1), emissive=(1.0, 0.6, 0.9, 3.0)),
    'Lantern': material('Lantern', (1.0, 0.85, 0.6, 1), emissive=(1.0, 0.7, 0.35, 4.0)),
    'Crystal': material('Crystal', (0.6, 0.95, 1.0, 1), emissive=(0.25, 0.8, 1.0, 2.5), rough=0.1),
    'Rail': material('Rail', (0.95, 0.92, 0.98, 1), rough=0.5),
    'Board': material('Board', (1, 1, 1, 1), texture=True),
    'Mirror': material('Mirror', (0.8, 0.8, 0.85, 1), rough=0.0, metal=1.0),
    'GemGreen': material('GemGreen', (0.6, 1.0, 0.6, 1), emissive=(0.35, 1.0, 0.45, 3.0), rough=0.1),
}
PORTAL_MATS = []
for wid, col in zip(WORLDS, WORLD_COLORS):
    PORTAL_MATS.append((
        material(f'Portal_{wid}', hex_rgb(col)),
        material(f'Glow_{wid}', hex_rgb(col), emissive=(*hex_rgb(col)[:3], 3.5)),
    ))

LAYOUT = {'colliders': [], 'platforms': [], 'seats': [], 'interactables': [], 'portals': [], 'lights': []}
STATIC = []  # oggetti che ricevono l'AO cotto


def collider(gx, gz, r):
    LAYOUT['colliders'].append([round(gx, 3), round(gz, 3), round(r, 3)])


def platform(gx, gz, r, top):
    LAYOUT['platforms'].append([round(gx, 3), round(gz, 3), round(r, 3), round(top, 3)])


def static(obj):
    STATIC.append(obj)
    return obj


# ------------------------------------------------------------------ primitive
def bm_box(sx, sy, sz, center=(0, 0, 0), bevel=0.0, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    return bm


def box(name, size, center, mat, bevel=0.0, segs=2, smooth=False):
    o = mesh_object(name, bm_box(*size, center, bevel, segs), mat, smooth=smooth)
    if bevel and smooth:
        o.data.set_sharp_from_angle(angle=math.radians(40))
    return o


def cylinder(name, r1, r2, h, mat, segs=24, center=(0, 0, 0), caps=True, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=segs, radius1=r1, radius2=r2, depth=h)
    bmesh.ops.translate(bm, vec=Vector(center) + Vector((0, 0, h / 2)), verts=bm.verts)
    o = mesh_object(name, bm, mat, smooth=smooth)
    if smooth:
        o.data.set_sharp_from_angle(angle=math.radians(45))
    return o


def lathe(name, profile, mat, segs=48, smooth=True):
    """profile: [(raggio, z), ...] dal basso verso l'alto."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for j in range(segs):
            a = 2 * PI * j / segs
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            bm.faces.new([rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_object(name, bm, mat, smooth=smooth)
    if smooth:
        o.data.set_sharp_from_angle(angle=math.radians(50))
    return o


def blob(name, radius, mat, subdiv=2, rough=0.25, seed=0, squash=1.0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in bm.verts:
        n = noise.noise(v.co * (2.2 / radius) + off)
        v.co *= 1 + n * rough
        v.co.z *= squash
    return mesh_object(name, bm, mat)


def disc(name, r_in, r_out, rings, segs, mat, z=0.0, jitter=0.0):
    bm = bmesh.new()
    grid = []
    for i in range(rings + 1):
        r = r_in + (r_out - r_in) * i / rings
        row = []
        for j in range(segs):
            a = 2 * PI * j / segs
            rr = r + (noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, 0))) * jitter if i == rings else 0)
            row.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z)))
        grid.append(row)
    for i in range(rings):
        for j in range(segs):
            j2 = (j + 1) % segs
            bm.faces.new([grid[i][j], grid[i][j2], grid[i + 1][j2], grid[i + 1][j]])
    if r_in == 0:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return mesh_object(name, bm, mat, smooth=True)


# ------------------------------------------------------------------ isola
def build_island():
    grass = static(disc('Grass', PLAZA_R - 0.3, ISLAND_R, 18, 160, MAT['Grass'], z=0.0, jitter=0.4))
    # bordo erboso arrotondato e scogliera
    prof = [(ISLAND_R + 0.4, 0.0), (ISLAND_R + 0.6, -0.25), (ISLAND_R + 0.3, -0.7)]
    lip = lathe('GrassLip', prof, MAT['Grass'], segs=160)
    static(lip)
    profile = [(ISLAND_R + 0.3, -0.7), (ISLAND_R - 0.5, -2.5), (ISLAND_R - 5, -6), (40, -11), (30, -17),
               (19, -24), (10, -31), (3, -37), (0.2, -40)]
    cliff = lathe('Cliff', profile, MAT['Rock'], segs=96, smooth=False)
    for v in cliff.data.vertices:
        if v.co.z < -1.2:
            p = v.co * 0.18
            d = noise.noise(p) * 2.6 + noise.noise(p * 3.1) * 1.0
            h = Vector((v.co.x, v.co.y, 0)).normalized()
            v.co += h * d
            v.co.z += noise.noise(p * 2 + Vector((5, 5, 5))) * 1.2
    cliff.data.update()
    # fasce di colore della roccia (strati)
    col = cliff.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
    for i, v in enumerate(cliff.data.vertices):
        band = 0.5 + 0.5 * math.sin(v.co.z * 0.9 + noise.noise(v.co * 0.1) * 2)
        t = 0.8 + band * 0.25
        col.data[i].color = (t, t * 0.95, t * 1.05, 1)

    # piazza a lastre concentriche
    grout = disc('Grout', 0, PLAZA_R, 1, 128, MAT['Grout'], z=0.005)
    static(grout)
    bm = bmesh.new()
    tint = []
    r = 5.6
    ring = 0
    while r < PLAZA_R - 0.4:
        w = 0.95
        n = max(8, round(2 * PI * (r + w / 2) / 1.05))
        off = (ring % 2) * 0.5
        for j in range(n):
            a0 = 2 * PI * (j + off + 0.035) / n
            a1 = 2 * PI * (j + off + 0.965) / n
            r0 = r + 0.04
            r1 = r + w - 0.04
            h = 0.06 + rng.random() * 0.012
            ins = 0.035
            pts = []
            for rr, aa, z in ((r0, a0, 0.0), (r1, a0, 0.0), (r1, a1, 0.0), (r0, a1, 0.0)):
                pts.append(Vector((math.cos(aa) * rr, math.sin(aa) * rr, z)))
            c = sum(pts, Vector()) / 4
            top = [c + (p - c) * (1 - ins * 2 / w) + Vector((0, 0, h)) for p in pts]
            mid = [p + Vector((0, 0, h - 0.015)) for p in pts]
            vb = [bm.verts.new(p) for p in pts]
            vm = [bm.verts.new(p) for p in mid]
            vt = [bm.verts.new(p) for p in top]
            bm.faces.new(vt)
            for k in range(4):
                k2 = (k + 1) % 4
                bm.faces.new([vm[k], vm[k2], vt[k2], vt[k]])
                bm.faces.new([vb[k], vb[k2], vm[k2], vm[k]])
            shade = 0.86 + rng.random() * 0.2
            warm = rng.random() * 0.06
            tint.append((shade + warm, shade, shade - warm * 0.5))
        r += w
        ring += 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    tiles = mesh_object('Tiles', bm, MAT['Tiles'], smooth=False)
    # colore per lastra (12 vertici per lastra)
    col = tiles.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
    for i in range(len(tiles.data.vertices)):
        t = tint[i // 12]
        col.data[i].color = (*t, 1)
    static(tiles)

    # anelli luminosi e cordolo
    curb = lathe('Curb', [(PLAZA_R - 0.35, 0.0), (PLAZA_R - 0.35, 0.12), (PLAZA_R - 0.2, 0.16), (PLAZA_R + 0.05, 0.16), (PLAZA_R + 0.2, 0.1), (PLAZA_R + 0.25, 0.0)], MAT['Stone'], segs=192)
    static(curb)
    for rr in (12.4, PLAZA_R - 0.75):
        lathe('GlowRing', [(rr + 0.05, 0.075), (rr - 0.05, 0.075)], MAT['GlowCyan'], segs=160, smooth=False)

    # sentieri verso i portali
    for i in range(6):
        a = portal_angle(i)
        bm = bmesh.new()
        L0, L1 = PLAZA_R - 0.2, PORTAL_R - 1.0
        steps = 9
        stones = []
        for k in range(steps):
            d = L0 + (L1 - L0) * (k + 0.5) / steps
            for s in (-1, 1):
                w = 1.45
                bm_s = bm_box(w - 0.08, (L1 - L0) / steps - 0.08, 0.08, (s * w / 2, 0, 0.0), bevel=0.02, segs=1)
                me = bpy.data.meshes.new('t')
                bm_s.to_mesh(me)
                bm_s.free()
                me.transform(Matrix.Translation((0, d, 0.02)))
                bm.from_mesh(me)
                bpy.data.meshes.remove(me)
        path = mesh_object('Path', bm, MAT['Path'], smooth=False)
        # il sentiero è costruito lungo +Y di Blender: lo ruotiamo verso il portale
        path.rotation_euler = (0, 0, PI + a)
        static(path)
        stones.append(path)

    # erba alta a ciuffi e fiori sparsi sull'erba (geometria statica leggera)
    bm = bmesh.new()
    flowers = bmesh.new()
    fcol = []
    palette = [(1.0, 0.75, 0.88), (1.0, 0.95, 0.55), (0.75, 0.85, 1.0), (1, 1, 1)]
    count = 0
    while count < 700:
        a = rng.random() * 2 * PI
        d = PLAZA_R + 1.2 + rng.random() * (ISLAND_R - PLAZA_R - 2.5)
        if any(abs(math.atan2(math.sin(a - portal_angle(i)), math.cos(a - portal_angle(i)))) * d < 2.2 for i in range(6)):
            continue
        x, y = math.cos(a) * d, math.sin(a) * d
        count += 1
        c = palette[count % 4]
        for k in range(5):
            pa = 2 * PI * k / 5
            px, py = x + math.cos(pa) * 0.07, y + math.sin(pa) * 0.07
            vs = [flowers.verts.new((px + dx, py + dy, 0.12)) for dx, dy in ((-0.05, -0.05), (0.05, -0.05), (0.05, 0.05), (-0.05, 0.05))]
            flowers.faces.new(vs)
            fcol += [c] * 4
        stem = [flowers.verts.new(p) for p in ((x - 0.01, y, 0), (x + 0.01, y, 0), (x + 0.01, y, 0.12), (x - 0.01, y, 0.12))]
        flowers.faces.new(stem)
        fcol += [(0.3, 0.6, 0.3)] * 4
    fl = mesh_object('Flowers', flowers, MAT['Flower'], smooth=False)
    col = fl.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(fcol):
        col.data[i].color = (*c, 1)
    bm.free()

    # ringhiera
    rail_objs = []
    n = 120
    for i in range(n):
        a = 2 * PI * i / n
        p = Vector((math.cos(a), math.sin(a), 0)) * (ISLAND_R - 1.2)
        rail_objs.append(cylinder('post', 0.07, 0.06, 1.05, MAT['Rail'], segs=8, center=p))
    for z, r, m in ((1.02, 0.055, MAT['Rail']), (0.6, 0.03, MAT['GlowPink'])):
        cu = bpy.data.curves.new('rail', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = r
        cu.bevel_resolution = 2
        sp = cu.splines.new('POLY')
        pts = 240
        sp.points.add(pts - 1)
        for i in range(pts):
            a = 2 * PI * i / pts
            sp.points[i].co = (math.cos(a) * (ISLAND_R - 1.2), math.sin(a) * (ISLAND_R - 1.2), z, 1)
        sp.use_cyclic_u = True
        o = bpy.data.objects.new('rail', cu)
        link(o)
        me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(o)
        ro = bpy.data.objects.new('rail', me)
        link(ro)
        set_material(ro, m)
        rail_objs.append(ro)
    static(join(rail_objs, 'Railing'))


# ------------------------------------------------------------------ fontana
def build_fountain():
    parts = []
    basin = lathe('Basin', [(0, 0.05), (4.7, 0.05), (4.75, 0.3), (5.0, 0.3), (5.3, 0.36), (5.4, 0.55), (5.32, 0.66), (5.05, 0.68),
                            (4.8, 0.62), (4.72, 0.4)], MAT['Stone'], segs=96)
    parts.append(basin)
    step = lathe('Step', [(5.4, 0.0), (6.3, 0.0), (6.3, 0.18), (6.1, 0.22), (5.4, 0.22)], MAT['StoneDark'], segs=96)
    parts.append(step)
    col = lathe('Column', [(0.95, 0.3), (0.95, 0.55), (0.7, 0.75), (0.55, 1.3), (0.5, 2.0), (0.62, 2.35), (0.8, 2.5)], MAT['Stone'], segs=48)
    parts.append(col)
    bowl = lathe('Bowl', [(0.5, 2.45), (1.2, 2.5), (2.0, 2.8), (2.15, 3.05), (2.05, 3.12), (1.9, 3.05), (0.6, 2.85)], MAT['Stone'], segs=64)
    parts.append(bowl)
    gold = lathe('GoldRing', [(2.16, 3.0), (2.2, 3.05), (2.16, 3.1)], MAT['Gold'], segs=64)
    parts.append(gold)
    top = lathe('Top', [(0.3, 2.95), (0.3, 3.6), (0.45, 3.75), (0.2, 3.95), (0.05, 4.0)], MAT['StoneDark'], segs=32)
    parts.append(top)
    f = static(join(parts, 'Fountain'))
    w1 = disc('Water', 0, 4.74, 10, 96, MAT['Water'], z=0.45)
    w2 = disc('Water_top', 0, 1.95, 6, 64, MAT['Water'], z=2.98)
    crystal = blob('Crystal', 1.0, MAT['Crystal'], subdiv=0, rough=0.0)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.0, radius2=1.0, depth=1.6)
    bmesh.ops.translate(bm, vec=(0, 0, -0.8), verts=bm.verts)
    top2 = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=1.0, radius2=0.0, depth=2.0)
    bmesh.ops.translate(bm, vec=(0, 0, 1.0), verts=top2['verts'])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)
    bpy.data.objects.remove(crystal)
    crystal = mesh_object('Crystal', bm, MAT['Crystal'], smooth=False)
    crystal.location = (0, 0, 6.0)
    platform(0, 0, 5.4, 0.66)
    platform(0, 0, 6.3, 0.22)
    collider(0, 0, 4.75)
    LAYOUT['lights'].append({'type': 'point', 'pos': [0, 6, 0], 'color': '#7fe6ff', 'intensity': 25, 'distance': 18})
    return f, w1, w2


# ------------------------------------------------------------------ portali
def arch_shape_points(w, h, segs=24):
    """Contorno dell'apertura: lati dritti + semicerchio (in XZ)."""
    r = w / 2
    pts = [Vector((-r, 0, 0.3)), Vector((-r, 0, h))]
    for k in range(1, segs):
        a = PI - PI * k / segs
        pts.append(Vector((math.cos(a) * r, 0, h + math.sin(a) * r)))
    pts += [Vector((r, 0, h)), Vector((r, 0, 0.3))]
    return pts


def build_portal(i):
    wid = WORLDS[i]
    pmat, gmat = PORTAL_MATS[i]
    a = portal_angle(i)
    gx, gz = math.sin(a) * PORTAL_R, math.cos(a) * PORTAL_R
    facing = a + PI
    parts = []
    parts.append(box('base', (7.4, 3.6, 0.3), (0, 0, 0.15), MAT['StoneDark'], bevel=0.05))
    parts.append(box('base2', (6.2, 2.8, 0.18), (0, 0, 0.39), MAT['Stone'], bevel=0.04))
    for s in (-1, 1):
        parts.append(box('pillar', (0.75, 0.85, 4.2), (s * 2.6, 0, 2.58), MAT['Stone'], bevel=0.06))
        parts.append(box('capital', (1.0, 1.05, 0.28), (s * 2.6, 0, 4.72), MAT['StoneDark'], bevel=0.04))
        parts.append(box('plinth', (1.0, 1.05, 0.32), (s * 2.6, 0, 0.62), MAT['StoneDark'], bevel=0.04))
        for k in range(3):  # scanalature dorate
            parts.append(box('flute', (0.05, 0.04, 3.4), (s * 2.6 + (k - 1) * 0.2, -0.43, 2.6), MAT['Gold']))
    # arco: tubo rettangolare lungo un semicerchio
    bm = bmesh.new()
    R0, R1, D = 2.25, 2.95, 0.85
    segs = 32
    verts = []
    for k in range(segs + 1):
        t = PI * k / segs
        c, s_ = math.cos(t), math.sin(t)
        ring = [bm.verts.new((c * R0, -D / 2, 4.85 + s_ * R0)), bm.verts.new((c * R1, -D / 2, 4.85 + s_ * R1)),
                bm.verts.new((c * R1, D / 2, 4.85 + s_ * R1)), bm.verts.new((c * R0, D / 2, 4.85 + s_ * R0))]
        verts.append(ring)
    for k in range(segs):
        for q in range(4):
            q2 = (q + 1) % 4
            bm.faces.new([verts[k][q], verts[k][q2], verts[k + 1][q2], verts[k + 1][q]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    arch = mesh_object('arch', bm, MAT['Stone'], smooth=False)
    bev = arch.modifiers.new('b', 'BEVEL')
    bev.width = 0.05
    bev.segments = 2
    bev.limit_method = 'ANGLE'
    apply_modifiers(arch)
    parts.append(arch)
    # chiave di volta
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.45, radius2=0.0, depth=0.7)
    bmesh.ops.translate(bm, vec=(0, 0, 0.35), verts=bm.verts)
    b2 = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.45, radius2=0.0, depth=0.5)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(PI, 3, 'X'), verts=b2['verts'])
    bmesh.ops.translate(bm, vec=(0, 0, -0.25), verts=b2['verts'])
    bmesh.ops.translate(bm, vec=(0, -0.48, 7.9), verts=bm.verts)
    parts.append(mesh_object('key', bm, gmat, smooth=False))
    # bordo luminoso interno
    cu = bpy.data.curves.new('trim', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.06
    cu.bevel_resolution = 2
    sp = cu.splines.new('POLY')
    pts = arch_shape_points(4.4, 4.85, 32)
    sp.points.add(len(pts) - 1)
    for k, p in enumerate(pts):
        sp.points[k].co = (p.x * 1.0, -0.44, p.z, 1)
    o = bpy.data.objects.new('trim', cu)
    link(o)
    me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(o)
    trim = bpy.data.objects.new('trim', me)
    link(trim)
    set_material(trim, gmat)
    parts.append(trim)
    # leggio con pannello
    parts.append(cylinder('stand', 0.07, 0.09, 1.25, MAT['Metal'], segs=10, center=(4.6, -0.9, 0.3)))
    parts.append(box('panelback', (2.4, 0.08, 1.5), (4.6, -0.86, 2.2), MAT['StoneDark'], bevel=0.03))
    frame = static(join(parts, f'PortalFrame_{wid}'))
    place(frame, gx, 0, gz, facing)

    # superficie del portale con UV (x, z) normalizzate
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    outline = arch_shape_points(4.4, 4.85, 32)
    center = bm.verts.new((0, 0.0, 2.6))
    ring = [bm.verts.new((p.x, 0.0, p.z)) for p in outline]
    for k in range(len(ring) - 1):
        f = bm.faces.new([center, ring[k + 1], ring[k]])
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = ((co.x + 2.2) / 4.4, (co.z - 0.3) / 6.75)
    f = bm.faces.new([center, ring[0], ring[-1]])
    for loop in f.loops:
        co = loop.vert.co
        loop[uvl].uv = ((co.x + 2.2) / 4.4, (co.z - 0.3) / 6.75)
    surf = mesh_object(f'Portal_{wid}', bm, pmat, smooth=False)
    place(surf, gx, 0, gz, facing)

    # pannello informativo (UV 0..1)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    vs = [bm.verts.new(p) for p in ((-1.1, 0, -0.69), (1.1, 0, -0.69), (1.1, 0, 0.69), (-1.1, 0, 0.69))]
    f = bm.faces.new(vs)
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uv
    board = mesh_object(f'Board_{wid}', bm, MAT['Board'], smooth=False)
    board.data.transform(Matrix.Translation((4.6, -0.91, 2.2)))
    place(board, gx, 0, gz, facing)

    # dati di gioco
    rot = Matrix.Rotation(facing, 3, 'Z')

    def to_game(lx, ly):
        p = G(gx, 0, gz) + rot @ Vector((lx, ly, 0))
        return p.x, -p.y

    for s in (-1, 1):
        px, pz = to_game(s * 2.6, 0)
        collider(px, pz, 0.6)
    px, pz = to_game(4.6, -0.9)
    collider(px, pz, 0.25)
    px, pz = to_game(0, 0.25)
    collider(px, pz, 0.5)
    platform(gx, gz, 2.3, 0.48)
    ix, iz = to_game(0, -2.4)
    LAYOUT['portals'].append({'id': wid, 'position': [round(gx, 3), 0, round(gz, 3)], 'interact': [round(ix, 3), 0, round(iz, 3)]})


# ------------------------------------------------------------------ specchio
def build_mirror():
    W, H = 5.0, 3.0
    parts = [
        box('top', (W + 0.6, 0.3, 0.3), (0, 0, 1.9 + H / 2 + 0.12), MAT['Stone'], bevel=0.04),
        box('bottom', (W + 0.6, 0.35, 0.4), (0, 0, 0.2), MAT['Stone'], bevel=0.04),
        box('left', (0.3, 0.3, H + 0.4), (-W / 2 - 0.15, 0, 1.9), MAT['Stone'], bevel=0.04),
        box('right', (0.3, 0.3, H + 0.4), (W / 2 + 0.15, 0, 1.9), MAT['Stone'], bevel=0.04),
        box('back', (W, 0.1, H), (0, 0.08, 1.9), MAT['StoneDark']),
        box('glow', (W + 0.3, 0.06, 0.06), (0, -0.16, 1.9 + H / 2 + 0.32), MAT['GlowPink']),
        box('switch', (0.3, 0.1, 0.45), (3.1, -0.02, 1.3), MAT['GlowCyan']),
        cylinder('switchpost', 0.05, 0.06, 1.1, MAT['Metal'], segs=8, center=(3.1, 0.05, 0)),
    ]
    frame = static(join(parts, 'MirrorFrame'))
    place(frame, 0, 0, -19.5, 0)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    vs = [bm.verts.new(p) for p in ((-W / 2, 0, -H / 2), (W / 2, 0, -H / 2), (W / 2, 0, H / 2), (-W / 2, 0, H / 2))]
    f = bm.faces.new(vs)
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uv
    surf = mesh_object('MirrorSurface', bm, MAT['Mirror'], smooth=False)
    surf.location = G(0, 1.9, -19.5 + 0.06)
    for x in [-2.5 + k for k in range(6)]:
        collider(x, -19.5, 0.45)
    LAYOUT['mirror'] = {'center': [0, 1.9, -19.44], 'size': [W, H], 'switch': [3.1, 0, -18.4]}
    LAYOUT['interactables'].append({'type': 'mirror', 'point': [3.3, 0, -18.4], 'radius': 1.8, 'label': 'Specchio on/off'})


# ------------------------------------------------------------------ panchine
def bench_mesh():
    parts = []
    for k in range(4):
        parts.append(box('slat', (2.0, 0.13, 0.05), (0, -0.21 + k * 0.14, 0.46), MAT['Wood'], bevel=0.015, segs=1))
    for k in range(2):
        b = box('back', (2.0, 0.05, 0.14), (0, 0.33, 0.68 + k * 0.19), MAT['Wood'], bevel=0.015, segs=1)
        b.data.transform(Matrix.Translation((0, 0.33, 0.68 + k * 0.19)) @ Matrix.Rotation(-0.18, 4, 'X') @ Matrix.Translation((0, -0.33, -0.68 - k * 0.19)))
        parts.append(b)
    for s in (-1, 1):
        parts.append(box('leg', (0.08, 0.55, 0.44), (s * 0.85, 0.0, 0.22), MAT['Metal'], bevel=0.02, segs=1))
        parts.append(box('arm', (0.08, 0.6, 0.06), (s * 0.98, 0.0, 0.64), MAT['Metal'], bevel=0.02, segs=1))
        parts.append(box('armpost', (0.06, 0.06, 0.2), (s * 0.98, -0.25, 0.54), MAT['Metal']))
        parts.append(box('backpost', (0.06, 0.06, 0.5), (s * 0.85, 0.36, 0.72), MAT['Metal']))
    return join(parts, 'bench')


def add_bench(gx, gz, facing, name):
    b = bench_mesh()
    b.name = name
    place(b, gx, 0, gz, facing)
    static(b)
    fx, fz = math.sin(facing), math.cos(facing)
    rx, rz = math.cos(facing), -math.sin(facing)
    for s in (-0.7, 0, 0.7):
        collider(gx + rx * s - fx * 0.05, gz + rz * s - fz * 0.05, 0.3)
    for s in (-0.5, 0.5):
        seat = [round(gx + rx * s + fx * 0.02, 3), 0, round(gz + rz * s + fz * 0.02, 3)]
        LAYOUT['seats'].append({'position': seat, 'facing': round(facing, 4)})
        LAYOUT['interactables'].append({'type': 'sit', 'seat': len(LAYOUT['seats']) - 1,
                                        'point': [round(gx + rx * s + fx * 0.8, 3), 0, round(gz + rz * s + fz * 0.8, 3)],
                                        'radius': 1.1, 'label': 'Siediti'})


def build_benches():
    for i in range(6):
        if i == 3:
            continue
        a = 2 * PI * i / 6
        add_bench(math.sin(a) * 8.8, math.cos(a) * 8.8, a, f'Bench_{i}')
    for x in (-2.3, 2.3):
        add_bench(x, -14, PI, 'Bench_mirror')


# ------------------------------------------------------------------ alberi
def tree(kind, scale, seed):
    r = random.Random(seed)
    parts = []
    h = (1.8 if kind == 'pine' else 2.4) * scale
    # tronco curvo con rami
    lean = Vector(((r.random() - 0.5) * 0.4, (r.random() - 0.5) * 0.4, 0)) * scale
    trunk_pts = [(0, 0, -0.2), (lean.x * 0.3, lean.y * 0.3, h * 0.4), (lean.x, lean.y, h)]
    t = curve_strand('trunk', trunk_pts, 0.26 * scale, 0.12 * scale, bulge=0, res=2, bevel_res=2)
    set_material(t, MAT['Bark'])
    parts.append(t)
    top = Vector((lean.x, lean.y, h))
    if kind == 'pine':
        for k in range(4):
            bm = bmesh.new()
            rr = (1.7 - k * 0.38) * scale
            bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=rr, radius2=0.0, depth=1.5 * scale)
            for v in bm.verts:
                if v.co.z < 0:
                    v.co.z += noise.noise(v.co * 3 + Vector((seed, k, 0))) * 0.15 * scale
            bmesh.ops.translate(bm, vec=top + Vector((0, 0, k * 0.85 * scale + 0.3 * scale)), verts=bm.verts)
            parts.append(mesh_object('pine', bm, MAT['LeavesPine'], smooth=True))
    else:
        mat = MAT['LeavesPink'] if kind == 'sakura' else MAT['LeavesGreen']
        n = 7 if kind == 'sakura' else 6
        for k in range(n):
            if k:
                br = Vector((math.cos(k * 2.4 + seed), math.sin(k * 2.4 + seed), 0.0)) * 0.9 * scale
                br.z = (0.4 + r.random() * 0.7) * scale
                b = curve_strand('branch', [top - Vector((0, 0, 0.4 * scale)), top + br * 0.6], 0.07 * scale, 0.03 * scale, bulge=0, res=1, bevel_res=1)
                set_material(b, MAT['Bark'])
                parts.append(b)
                c = top + br
            else:
                c = top + Vector((0, 0, 0.9 * scale))
            rr = (0.85 + r.random() * 0.45) * scale
            bl = blob('leaf', rr, mat, subdiv=2, rough=0.22, seed=seed * 10 + k, squash=0.82)
            bl.location = c
            parts.append(bl)
    return join(parts, 'tree')


def build_trees():
    placed = []
    trees = []
    r = random.Random(42)
    park = portal_angle(1) + PI / 6
    tries = 0
    while len(placed) < 34 and tries < 900:
        tries += 1
        a = r.random() * 2 * PI
        d = PLAZA_R + 3 + r.random() * (ISLAND_R - PLAZA_R - 6)
        ok = all(abs(math.atan2(math.sin(a - portal_angle(i)), math.cos(a - portal_angle(i)))) * d > 5.5 for i in range(6))
        ok = ok and abs(math.atan2(math.sin(a - park), math.cos(a - park))) > 0.38
        gx, gz = math.sin(a) * d, math.cos(a) * d
        ok = ok and all(math.hypot(p[0] - gx, p[1] - gz) > 4.6 for p in placed)
        if not ok:
            continue
        placed.append((gx, gz))
        kind = ['sakura', 'round', 'pine', 'sakura'][int(r.random() * 4)]
        sc = 0.9 + r.random() * 0.6
        t = tree(kind, sc, len(placed))
        t.name = f'Tree_{kind}_{len(placed)}'
        place(t, gx, 0, gz, r.random() * 6)
        trees.append(t)
        collider(gx, gz, 0.32 * sc)
    for t in trees:
        static(t)
    # cespugli lungo il bordo della piazza
    bushes = []
    for k in range(40):
        a = 2 * PI * k / 40 + 0.03
        if any(abs(math.atan2(math.sin(a - portal_angle(i)), math.cos(a - portal_angle(i)))) < 0.12 for i in range(6)):
            continue
        if abs(math.atan2(math.sin(a - PI), math.cos(a - PI))) < 0.15 or abs(a) < 0.12 or abs(a - 2 * PI) < 0.12:
            continue
        b = blob('bush', 0.55 + r.random() * 0.25, MAT['Bush'], subdiv=2, rough=0.25, seed=k + 100, squash=0.7)
        b.location = G(math.sin(a) * (PLAZA_R + 1.1), 0.25, math.cos(a) * (PLAZA_R + 1.1))
        bushes.append(b)
        collider(math.sin(a) * (PLAZA_R + 1.1), math.cos(a) * (PLAZA_R + 1.1), 0.55)
    static(join(bushes, 'Bushes'))


# ------------------------------------------------------------------ lanterne
def build_lanterns():
    parts = []
    for i in range(6):
        a = portal_angle(i)
        for d in (PLAZA_R + 3, PLAZA_R + 9):
            for s in (-1, 1):
                gx = math.sin(a) * d + math.cos(a) * 2.1 * s
                gz = math.cos(a) * d - math.sin(a) * 2.1 * s
                p = G(gx, 0, gz)
                parts.append(cylinder('post', 0.06, 0.09, 2.2, MAT['Metal'], segs=10, center=p))
                parts.append(cylinder('foot', 0.2, 0.16, 0.12, MAT['Metal'], segs=10, center=p))
                parts.append(cylinder('lamp', 0.17, 0.14, 0.38, MAT['Lantern'], segs=6, center=p + Vector((0, 0, 2.18)), smooth=False))
                parts.append(cylinder('roof', 0.3, 0.02, 0.24, MAT['Metal'], segs=6, center=p + Vector((0, 0, 2.54)), smooth=False))
                parts.append(cylinder('cap', 0.18, 0.18, 0.04, MAT['Gold'], segs=6, center=p + Vector((0, 0, 2.14)), smooth=False))
                collider(gx, gz, 0.15)
    static(join(parts, 'Lanterns'))


# ------------------------------------------------------------------ rocce e isolotti
def rock_island(name, radius, depth, seed, top_mat=MAT['Grass']):
    r = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=9, radius1=radius, radius2=0.0, depth=depth)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(PI, 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, -depth / 2 - 0.15), verts=bm.verts)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=2, use_grid_fill=True)
    for v in bm.verts:
        if v.co.z < -0.2:
            v.co += Vector((noise.noise(v.co * 1.3 + Vector((seed, 0, 0))), noise.noise(v.co * 1.3 + Vector((0, seed, 0))), 0)) * radius * 0.18
    rock = mesh_object('rock', bm, MAT['Rock'], smooth=False)
    capb = bmesh.new()
    bmesh.ops.create_cone(capb, cap_ends=True, segments=9, radius1=radius * 1.02, radius2=radius * 0.98, depth=0.3)
    bmesh.ops.translate(capb, vec=(0, 0, -0.15), verts=capb.verts)
    cap = mesh_object('cap', capb, top_mat, smooth=False)
    return join([rock, cap], name)


def build_parkour():
    base = portal_angle(1) + PI / 6
    steps = 8
    last = None
    parts = []
    for k in range(steps):
        t = k / (steps - 1)
        a = base - 0.25 + t * 0.5
        d = PLAZA_R + 4 + t * 14
        gx, gz = math.sin(a) * d, math.cos(a) * d
        y = 0.75 + k * 0.75
        r = 3.2 if k == steps - 1 else 1.25
        isle = rock_island(f'Parkour_{k}', r, r * 1.6, k + 30, MAT['Stone'] if k < steps - 1 else MAT['Grass'])
        place(isle, gx, y, gz, k * 0.7)
        parts.append(isle)
        platform(gx, gz, r, y)
        last = (gx, y, gz)
    for p in parts:
        static(p)
    t = tree('sakura', 0.9, 5)
    t.name = 'Tree_lookout'
    place(t, last[0] + 1.4, last[1], last[2], 0.4)
    static(t)
    collider(last[0] + 1.4, last[2], 0.3)
    LAYOUT['gem'] = [round(last[0] - 0.8, 3), round(last[1] + 1.0, 3), round(last[2], 3)]


def build_far_islands():
    r = random.Random(21)
    for k in range(10):
        a = r.random() * 2 * PI
        d = 80 + r.random() * 100
        s = 3 + r.random() * 7
        isle = rock_island(f'FarIsland_{k}', s, s * 1.9, k + 60)
        place(isle, math.sin(a) * d, -6 + r.random() * 28, math.cos(a) * d, r.random() * 6)
        if s > 5:
            t = tree(['sakura', 'round', 'pine'][k % 3], s * 0.14 + 0.7, 200 + k)
            t.parent = isle
            t.location = (0, 0, 0)


# ------------------------------------------------------------------ bacheca
def build_welcome():
    parts = [
        box('frame', (3.7, 0.12, 2.4), (0, 0.06, 2.0), MAT['Stone'], bevel=0.04),
        box('roof', (3.95, 0.4, 0.14), (0, 0.0, 3.27), MAT['StoneDark'], bevel=0.03),
    ]
    for s in (-1, 1):
        parts.append(box('leg', (0.16, 0.16, 1.0), (s * 1.45, 0.06, 0.5), MAT['Stone'], bevel=0.03))
    frame = static(join(parts, 'WelcomeFrame'))
    facing = PI - 0.55
    place(frame, -6.5, 0, 17.5, facing)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    vs = [bm.verts.new(p) for p in ((-1.7, 0, 0.94), (1.7, 0, 0.94), (1.7, 0, 3.06), (-1.7, 0, 3.06))]
    f = bm.faces.new(vs)
    for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uvl].uv = uv
    board = mesh_object('Board_welcome', bm, MAT['Board'], smooth=False)
    board.data.transform(Matrix.Translation((0, -0.01, 0)))
    place(board, -6.5, 0, 17.5, facing)
    rot = Matrix.Rotation(facing, 3, 'Z')
    for s in (-1, 1):
        p = G(-6.5, 0, 17.5) + rot @ Vector((s * 1.45, 0.06, 0))
        collider(p.x, -p.y, 0.2)


# ------------------------------------------------------------------ costruzione
build_island()
build_fountain()
for i in range(6):
    build_portal(i)
build_mirror()
build_benches()
build_trees()
build_lanterns()
build_parkour()
build_far_islands()
build_welcome()


# ------------------------------------------------------------------ occlusione ambientale cotta
def bake_ao(objs):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16 if FAST else 64
    world = bpy.data.worlds.new('w')
    scene.world = world
    world.light_settings.distance = 3.0
    for o in objs:
        me = o.data
        if not me.polygons:
            continue
        tint = me.color_attributes.get('Tint')
        tint_vals = [tuple(c.color) for c in tint.data] if tint else None
        ao = me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        me.color_attributes.active_color = ao
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        try:
            bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        except RuntimeError as e:
            print('bake fallito', o.name, e)
            continue
        # colore finale = AO (schiarito) x tinta
        out = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(ao.data):
            v = 0.35 + 0.65 * c.color[0]
            t = tint_vals[i] if tint_vals else (1, 1, 1, 1)
            out.data[i].color = (v * t[0], v * t[1], v * t[2], 1)
        me.color_attributes.remove(me.color_attributes['AO'])
        if tint:
            me.color_attributes.remove(me.color_attributes['Tint'])
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        print('  AO cotta:', o.name, len(me.vertices), 'vertici')


# applica trasformazioni agli oggetti statici così l'AO li "vede" nel posto giusto
bpy.context.view_layer.update()
bake_ao(STATIC)
# le tinte non cotte (scogliera, fiori) diventano il colore finale
for o in bpy.context.scene.objects:
    if o.type == 'MESH' and 'Tint' in o.data.color_attributes and 'Col' not in o.data.color_attributes:
        o.data.color_attributes['Tint'].name = 'Col'

# ------------------------------------------------------------------ export
total = 0
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        o.data.validate()
        total += sum(len(p.vertices) - 2 for p in o.data.polygons)
print('TRIANGOLI TOTALI', total)

LAYOUT['spawn'] = [0, 0, 15]
LAYOUT['bounds'] = ISLAND_R - 2
LAYOUT['plazaRadius'] = PLAZA_R
LAYOUT['islandRadius'] = ISLAND_R
os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, 'hub.json'), 'w') as fh:
    json.dump(LAYOUT, fh, indent=1)

bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(os.path.join(OUT_DIR, 'hub.glb')),
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_vertex_color='ACTIVE',
    export_all_vertex_colors=False,
    export_active_vertex_color_when_no_material=True,
    export_draco_mesh_compression_enable=False,
    export_draco_mesh_compression_level=6,
    export_draco_color_quantization=8,
    export_lights=False,
    export_cameras=False,
)
print('ESPORTATO', OUT_DIR)
