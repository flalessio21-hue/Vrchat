"""
Oggetti dei negozi di Oasis, creati da zero con Blender:
  veicoli: hoverboard, monopattino, kart, nuvoletta
  animali: gattobot, gelatina, draghetto, gufetto
  moneta da raccogliere
Ogni oggetto è un nodo radice "Item_<id>" con origine a terra.
Materiali: VehMain (colore scelto nel gioco), VehDark, VehGlow, Pet*, Coin...

Uso:  python tools/blender/items.py -- public/models/items.glb
"""
import math
import os
import sys

import bpy  # noqa: I001
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import apply_modifiers, curve_strand, join, material, mesh_object, reset_scene, set_material  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'items.glb'
PI = math.pi
reset_scene()

M = {
    'VehMain': material('VehMain', (0.3, 0.75, 1.0, 1), rough=0.3, metal=0.2),
    'VehDark': material('VehDark', (0.1, 0.09, 0.14, 1), rough=0.4, metal=0.3),
    'VehGlow': material('VehGlow', (0.4, 1.0, 0.9, 1), emissive=(0.4, 1.0, 0.9, 3.0)),
    'Tire': material('Tire', (0.06, 0.06, 0.08, 1), rough=0.8),
    'Chrome': material('Chrome', (0.85, 0.85, 0.9, 1), rough=0.15, metal=1.0),
    'Cloud': material('Cloud', (1, 1, 1, 1), rough=0.9),
    'PetBody': material('PetBody', (0.9, 0.9, 0.95, 1), rough=0.5),
    'PetDark': material('PetDark', (0.12, 0.1, 0.16, 1), rough=0.4),
    'PetGlow': material('PetGlow', (0.4, 0.9, 1.0, 1), emissive=(0.4, 0.9, 1.0, 3.0)),
    'PetPink': material('PetPink', (1.0, 0.6, 0.75, 1), rough=0.6),
    'Slime': material('Slime', (0.45, 1.0, 0.6, 1), rough=0.1),
    'Dragon': material('Dragon', (0.55, 0.4, 1.0, 1), rough=0.5),
    'DragonBelly': material('DragonBelly', (1.0, 0.85, 0.55, 1), rough=0.6),
    'Owl': material('Owl', (0.75, 0.55, 0.35, 1), rough=0.7),
    'Coin': material('Coin', (1.0, 0.78, 0.25, 1), emissive=(1.0, 0.6, 0.1, 0.6), rough=0.25, metal=1.0),
}


def rbox(name, size, loc, mat, levels=2, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    o = mesh_object(name, bm, mat)
    if levels:
        sub = o.modifiers.new('s', 'SUBSURF')
        sub.levels = levels
        apply_modifiers(o)
    m = Matrix.Translation(loc)
    if rot:
        m = m @ rot
    o.data.transform(m)
    return o


def sphere(name, r, loc, mat, scale=(1, 1, 1), seg=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    return mesh_object(name, bm, mat)


def cyl(name, r, h, loc, mat, axis='Z', seg=24, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    if axis == 'X':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(PI / 2, 3, 'Y'), verts=bm.verts)
    elif axis == 'Y':
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(PI / 2, 3, 'X'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    o = mesh_object(name, bm, mat)
    o.data.set_sharp_from_angle(angle=math.radians(40))
    return o


def torus(name, R, r, loc, mat, axis='X'):
    pts = []
    n = 32
    for i in range(n):
        a = 2 * PI * i / n
        pts.append((math.cos(a) * R, math.sin(a) * R))
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    sp = cu.splines.new('POLY')
    sp.points.add(n - 1)
    for i, (a, b) in enumerate(pts):
        co = {'X': (0, a, b), 'Y': (a, 0, b), 'Z': (a, b, 0)}[axis]
        sp.points[i].co = (co[0] + loc[0], co[1] + loc[1], co[2] + loc[2], 1)
    sp.use_cyclic_u = True
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(o)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    set_material(ob, mat)
    return ob


ITEMS = {}

# ---------------------------------------------------------------- veicoli (davanti = -Y)
ITEMS['hoverboard'] = [
    rbox('deck', (0.36, 1.15, 0.06), (0, 0, 0.22), M['VehMain']),
    rbox('grip', (0.3, 0.9, 0.012), (0, 0, 0.256), M['VehDark'], levels=1),
    rbox('glow', (0.38, 1.0, 0.02), (0, 0, 0.18), M['VehGlow'], levels=1),
    cyl('padF', 0.11, 0.05, (0, -0.33, 0.14), M['VehDark']),
    cyl('padB', 0.11, 0.05, (0, 0.33, 0.14), M['VehDark']),
    cyl('glowF', 0.08, 0.02, (0, -0.33, 0.11), M['VehGlow']),
    cyl('glowB', 0.08, 0.02, (0, 0.33, 0.11), M['VehGlow']),
]

sc = [
    rbox('deck', (0.2, 0.8, 0.06), (0, 0, 0.14), M['VehMain']),
    torus('wheelF', 0.1, 0.035, (0, -0.42, 0.11), M['Tire']),
    torus('wheelB', 0.1, 0.035, (0, 0.42, 0.11), M['Tire']),
    cyl('hubF', 0.05, 0.05, (0, -0.42, 0.11), M['Chrome'], axis='X'),
    cyl('hubB', 0.05, 0.05, (0, 0.42, 0.11), M['Chrome'], axis='X'),
    rbox('glow', (0.22, 0.6, 0.015), (0, 0, 0.1), M['VehGlow'], levels=1),
]
stem = curve_strand('stem', [(0, -0.42, 0.13), (0, -0.46, 0.6), (0, -0.4, 1.02)], 0.022, 0.02, bulge=0)
set_material(stem, M['Chrome'])
sc.append(stem)
sc.append(cyl('bar', 0.02, 0.5, (0, -0.4, 1.02), M['VehDark'], axis='X'))
for s in (-1, 1):
    sc.append(cyl('grip', 0.028, 0.1, (s * 0.21, -0.4, 1.02), M['VehMain'], axis='X'))
sc.append(sphere('lamp', 0.04, (0, -0.47, 0.88), M['VehGlow']))
ITEMS['scooter'] = sc

kart = [
    rbox('body', (0.9, 1.5, 0.28), (0, 0, 0.32), M['VehMain']),
    rbox('nose', (0.6, 0.5, 0.18), (0, -0.85, 0.28), M['VehMain']),
    rbox('seat', (0.46, 0.4, 0.45), (0, 0.32, 0.52), M['VehDark']),
    rbox('spoiler', (0.95, 0.18, 0.05), (0, 0.85, 0.75), M['VehDark'], levels=1),
    rbox('stripe', (0.92, 1.2, 0.03), (0, 0, 0.47), M['VehGlow'], levels=1),
    cyl('column', 0.03, 0.4, (0, -0.32, 0.58), M['Chrome']),
    torus('steer', 0.13, 0.022, (0, -0.25, 0.78), M['VehDark'], axis='Y'),
]
for s in (-1, 1):
    kart.append(rbox('post', (0.05, 0.05, 0.3), (s * 0.35, 0.82, 0.6), M['VehDark'], levels=0))
    for y in (-0.55, 0.5):
        kart.append(cyl('tire', 0.2, 0.18, (s * 0.52, y, 0.2), M['Tire'], axis='X'))
        kart.append(cyl('rim', 0.1, 0.19, (s * 0.52, y, 0.2), M['Chrome'], axis='X'))
    kart.append(sphere('light', 0.05, (s * 0.2, -1.1, 0.32), M['VehGlow']))
ITEMS['kart'] = kart

cloud = []
for i, (x, y, z, r) in enumerate([(0, 0, 0.35, 0.42), (0.35, 0.1, 0.32, 0.32), (-0.35, 0.05, 0.32, 0.33), (0.1, -0.35, 0.3, 0.3),
                                  (-0.15, 0.38, 0.3, 0.3), (0.28, -0.25, 0.42, 0.25), (-0.3, -0.28, 0.4, 0.26)]):
    cloud.append(sphere('puff', r, (x, y, z), M['Cloud'], scale=(1, 1, 0.75)))
cloud.append(sphere('blush', 0.06, (0.18, -0.36, 0.38), M['PetPink'], scale=(1, 0.4, 0.6)))
cloud.append(sphere('blush', 0.06, (-0.18, -0.36, 0.38), M['PetPink'], scale=(1, 0.4, 0.6)))
for s in (-1, 1):
    cloud.append(sphere('eye', 0.035, (s * 0.1, -0.37, 0.45), M['PetDark'], scale=(1, 0.5, 1.3)))
ITEMS['cloud'] = cloud

# ---------------------------------------------------------------- animali (davanti = -Y)
cat = [
    rbox('body', (0.26, 0.36, 0.22), (0, 0.04, 0.2), M['PetBody']),
    rbox('head', (0.3, 0.26, 0.24), (0, -0.2, 0.36), M['PetBody']),
    rbox('visor', (0.24, 0.02, 0.1), (0, -0.33, 0.37), M['PetDark'], levels=1),
]
for s in (-1, 1):
    cat.append(sphere('eye', 0.03, (s * 0.06, -0.345, 0.375), M['PetGlow'], scale=(1, 0.4, 1)))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.06, radius2=0, depth=0.1)
    bmesh.ops.translate(bm, vec=(s * 0.09, -0.2, 0.52), verts=bm.verts)
    cat.append(mesh_object('ear', bm, M['PetBody'], smooth=False))
    for y in (-0.08, 0.15):
        cat.append(cyl('leg', 0.04, 0.12, (s * 0.08, y, 0.06), M['PetDark']))
tail = curve_strand('tail', [(0, 0.2, 0.22), (0, 0.32, 0.3), (0, 0.34, 0.45), (0, 0.28, 0.52)], 0.025, 0.02, bulge=0)
set_material(tail, M['PetBody'])
cat += [tail, sphere('tip', 0.035, (0, 0.28, 0.53), M['PetGlow'])]
ITEMS['robocat'] = cat

slime = [sphere('blob', 0.24, (0, 0, 0.2), M['Slime'], scale=(1, 1, 0.85), seg=32)]
for s in (-1, 1):
    slime.append(sphere('eye', 0.035, (s * 0.08, -0.2, 0.28), M['PetDark'], scale=(1, 0.6, 1.3)))
    slime.append(sphere('shine', 0.012, (s * 0.08 + 0.01, -0.225, 0.3), M['Cloud']))
slime.append(sphere('mouth', 0.025, (0, -0.215, 0.21), M['PetDark'], scale=(1.2, 0.4, 0.6)))
ITEMS['slime'] = slime

dragon = [
    sphere('body', 0.17, (0, 0.05, 0.22), M['Dragon'], scale=(1, 1.15, 1)),
    sphere('belly', 0.13, (0, -0.06, 0.2), M['DragonBelly'], scale=(0.9, 0.6, 1)),
    sphere('head', 0.15, (0, -0.15, 0.45), M['Dragon']),
    sphere('snout', 0.08, (0, -0.28, 0.41), M['Dragon'], scale=(1.1, 0.9, 0.8)),
]
for s in (-1, 1):
    dragon.append(sphere('eye', 0.03, (s * 0.06, -0.27, 0.49), M['PetDark'], scale=(1, 0.5, 1.2)))
    horn = curve_strand('horn', [(s * 0.06, -0.12, 0.57), (s * 0.08, -0.08, 0.66), (s * 0.07, -0.02, 0.7)], 0.02, 0.003, bulge=0)
    set_material(horn, M['DragonBelly'])
    dragon.append(horn)
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in ((s * 0.1, 0.08, 0.3), (s * 0.38, 0.12, 0.5), (s * 0.32, 0.18, 0.28), (s * 0.2, 0.15, 0.22))]
    bm.faces.new(v)
    wing = mesh_object('wing', bm, M['PetPink'], smooth=False)
    so = wing.modifiers.new('so', 'SOLIDIFY')
    so.thickness = 0.015
    apply_modifiers(wing)
    dragon.append(wing)
    dragon.append(cyl('leg', 0.045, 0.1, (s * 0.09, 0.0, 0.05), M['Dragon']))
dtail = curve_strand('tail', [(0, 0.2, 0.18), (0, 0.35, 0.12), (0.05, 0.48, 0.15), (0.02, 0.56, 0.22)], 0.06, 0.012, bulge=0)
set_material(dtail, M['Dragon'])
dragon.append(dtail)
ITEMS['dragon'] = dragon

owl = [sphere('body', 0.2, (0, 0, 0.24), M['Owl'], scale=(1, 0.9, 1.1)),
       sphere('belly', 0.14, (0, -0.1, 0.2), M['DragonBelly'], scale=(1, 0.5, 1.1))]
for s in (-1, 1):
    owl.append(sphere('eyering', 0.07, (s * 0.075, -0.15, 0.33), M['Cloud'], scale=(1, 0.4, 1)))
    owl.append(sphere('eye', 0.035, (s * 0.075, -0.18, 0.33), M['PetDark'], scale=(1, 0.4, 1)))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.04, radius2=0, depth=0.08)
    bmesh.ops.translate(bm, vec=(s * 0.11, -0.02, 0.48), verts=bm.verts)
    owl.append(mesh_object('tuft', bm, M['Owl'], smooth=False))
    owl.append(sphere('wing', 0.1, (s * 0.18, 0.02, 0.24), M['Owl'], scale=(0.35, 0.8, 1.1)))
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.025, radius2=0, depth=0.05)
bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(PI, 3, 'X'), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, -0.19, 0.28), verts=bm.verts)
owl.append(mesh_object('beak', bm, M['DragonBelly'], smooth=False))
ITEMS['owl'] = owl

# ---------------------------------------------------------------- moneta
coin = [cyl('coin', 0.22, 0.05, (0, 0, 0), M['Coin'], axis='Y', seg=32),
        torus('rim', 0.18, 0.012, (0, -0.028, 0), M['Coin'], axis='Y'),
        torus('rim2', 0.18, 0.012, (0, 0.028, 0), M['Coin'], axis='Y')]
ITEMS['coin'] = coin

for k, parts in ITEMS.items():
    o = join(parts, f'Item_{k}')
    o.data.validate()
    print(f'  Item_{k}: {sum(len(p.vertices) - 2 for p in o.data.polygons)} triangoli')

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', export_yup=True, export_apply=True,
                          export_lights=False, export_cameras=False)
print('ESPORTATO', OUT)
