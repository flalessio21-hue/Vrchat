"""
Genera l'avatar di Oasis da zero con Blender (modulo `bpy`) ed esporta
public/models/avatar.glb.

Contiene:
- scheletro (armatura) con ossa nominate per il gioco
- corpo, testa, viso (superficie con UV per la texture del volto disegnata nel gioco)
- varianti: capelli (6), sopra (3), sotto (3), accessori (6), scarpe
- animazioni: idle, walk, run, jump, wave, dance, cheer, sit, floor

I colori vengono decisi nel gioco: qui i materiali hanno solo un nome
(Skin, Hair, Top, TopDark, Shirt, Bottom, Shoes, Sole, Accent, Dark, White, Pink, Face).

Uso:  python tools/blender/avatar.py -- public/models/avatar.glb [anteprima.png]
"""
import math
import os
import sys

import bpy  # noqa: I001 (bpy va importato prima di bmesh)
import bmesh
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (apply_modifiers, curve_strand, join, link, material,  # noqa: E402
                    mesh_object, reset_scene, set_material, skin_mesh, smoothstep)

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'avatar.glb'
PREVIEW = args[1] if len(args) > 1 else None

reset_scene()
PI = math.pi
rad = math.radians

# ------------------------------------------------------------------ materiali
M = {
    'Skin': material('Skin', (0.95, 0.78, 0.68, 1), rough=0.7),
    'Hair': material('Hair', (0.45, 0.8, 1.0, 1), rough=0.5),
    'Top': material('Top', (0.65, 0.55, 1.0, 1)),
    'TopDark': material('TopDark', (0.45, 0.38, 0.75, 1)),
    'Shirt': material('Shirt', (0.95, 0.94, 0.98, 1)),
    'Bottom': material('Bottom', (0.2, 0.25, 0.45, 1)),
    'Shoes': material('Shoes', (0.95, 0.95, 0.97, 1)),
    'Sole': material('Sole', (0.9, 0.9, 0.92, 1)),
    'Accent': material('Accent', (0.3, 0.9, 1.0, 1), emissive=(0.3, 0.9, 1.0, 2.0)),
    'Dark': material('Dark', (0.12, 0.1, 0.16, 1), rough=0.35, metal=0.3),
    'White': material('White', (0.97, 0.97, 0.98, 1)),
    'Pink': material('Pink', (1.0, 0.7, 0.78, 1)),
    'Face': material('Face', (1, 1, 1, 1), texture=True),
}

# ------------------------------------------------------------------ proporzioni
HEAD_C = Vector((0, 0, 1.585))
HEAD_R = 0.148
ARM_DOWN = rad(40)  # posa a "A": braccia a 40° sotto l'orizzontale


def arm_dir(side):
    return Vector((side * math.cos(ARM_DOWN), 0, -math.sin(ARM_DOWN)))


SH = {s: Vector((0.16 * s, 0, 1.33)) for s in (1, -1)}
ELBOW = {s: SH[s] + arm_dir(s) * 0.26 for s in (1, -1)}
WRIST = {s: ELBOW[s] + arm_dir(s) * 0.235 for s in (1, -1)}
HIP = {s: Vector((0.088 * s, 0, 0.86)) for s in (1, -1)}
KNEE = {s: Vector((0.092 * s, 0, 0.47)) for s in (1, -1)}
ANKLE = {s: Vector((0.092 * s, 0, 0.09)) for s in (1, -1)}


def S(theta, phi, k=1.0):
    """Punto sulla superficie della testa (theta dall'alto, phi dal davanti, -Y = davanti)."""
    d = Vector((math.sin(theta) * math.sin(phi), -math.sin(theta) * math.cos(phi), math.cos(theta)))
    v = Vector((d.x, d.y * 0.97, d.z * 1.04))
    if d.z < 0:  # mento più stretto
        lower = (-d.z) ** 1.4
        front = max(0.0, -d.y)
        v.x *= 1 - 0.32 * lower
        v.y *= 1 - 0.12 * lower * (1 - front)
        v.y -= 0.03 * lower * front
    if d.y > 0:  # nuca più piena
        v.y *= 1 + 0.06 * d.y
    return HEAD_C + v * (HEAD_R * k)


def latlong(name, k, mat, rings=24, segs=32, keep=None, uv=None, th0=0.0, th1=PI, ph0=-PI, ph1=PI, closed=True):
    """Mesh a griglia latitudine/longitudine costruita con S()."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap') if uv else None
    grid = []
    cols = segs + (0 if closed else 1)
    for i in range(rings + 1):
        th = th0 + (th1 - th0) * i / rings
        row = []
        for j in range(cols):
            ph = ph0 + (ph1 - ph0) * j / segs
            row.append(bm.verts.new(S(th, ph, k)))
        grid.append(row)
    for i in range(rings):
        for j in range(segs):
            j2 = (j + 1) % cols if closed else j + 1
            th = th0 + (th1 - th0) * (i + 0.5) / rings
            ph = ph0 + (ph1 - ph0) * (j + 0.5) / segs
            if keep and not keep(th, ph):
                continue
            vs = [grid[i][j], grid[i][j2], grid[i + 1][j2], grid[i + 1][j]]
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            if uvl:
                for loop, (a, b) in zip(f.loops, [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]):
                    loop[uvl].uv = (b / segs, 1 - a / rings)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # rimuove vertici isolati
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, mat)


# ------------------------------------------------------------------ armatura
arm_data = bpy.data.armatures.new('Rig')
rig = bpy.data.objects.new('Avatar', arm_data)
link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, deform=True, connect=False):
    b = eb.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    b.roll = 0
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    b.use_deform = deform
    return b


bone('hips', (0, 0, 0.9), (0, 0, 1.0))
bone('spine', (0, 0, 1.0), (0, 0, 1.15), 'hips', connect=True)
bone('chest', (0, 0, 1.15), (0, 0, 1.34), 'spine', connect=True)
bone('neck', (0, 0, 1.37), (0, 0, 1.45), 'chest')
bone('head', (0, 0, 1.45), (0, 0, 1.74), 'neck', connect=True)
for s, n in ((1, 'L'), (-1, 'R')):
    bone(f'shoulder_{n}', (0.03 * s, 0, 1.31), SH[s], 'chest')
    bone(f'upper_arm_{n}', SH[s], ELBOW[s], f'shoulder_{n}', connect=True)
    bone(f'forearm_{n}', ELBOW[s], WRIST[s], f'upper_arm_{n}', connect=True)
    bone(f'hand_{n}', WRIST[s], WRIST[s] + arm_dir(s) * 0.1, f'forearm_{n}', connect=True)
    bone(f'thigh_{n}', HIP[s], KNEE[s], 'hips')
    bone(f'shin_{n}', KNEE[s], ANKLE[s], f'thigh_{n}', connect=True)
    bone(f'foot_{n}', ANKLE[s], ANKLE[s] + Vector((0, -0.14, -0.05)), f'shin_{n}', connect=True)
    bone(f'hair_tail_{n}', S(0.42 * PI, s * 2.0, 1.05), S(0.42 * PI, s * 2.0, 1.05) + Vector((0.06 * s, 0.05, -0.4)), 'head', deform=False)
bone('hair_tail', S(0.55 * PI, PI, 1.06), S(0.55 * PI, PI, 1.06) + Vector((0, 0.06, -0.38)), 'head', deform=False)
bone('hair_back', S(0.5 * PI, PI, 1.05), S(0.5 * PI, PI, 1.05) + Vector((0, 0.03, -0.42)), 'head', deform=False)
bone('tail_1', (0, 0.1, 0.9), (0, 0.3, 0.86), 'hips', deform=False)
bone('tail_2', (0, 0.3, 0.86), (0, 0.48, 1.0), 'tail_1', deform=False, connect=True)
bpy.ops.object.mode_set(mode='OBJECT')

SOFT_BONES = ['hair_tail_L', 'hair_tail_R', 'hair_tail', 'hair_back', 'tail_1', 'tail_2']


def set_deform(names, value):
    for n in names:
        arm_data.bones[n].use_deform = value


# ------------------------------------------------------------------ corpo
def body_skeleton(scale=1.0, add=0.0, parts=('torso', 'arms', 'legs', 'hands', 'neck'), torso_low=0.9, sleeve=1.0, leg_end=1.0):
    """Restituisce vertici, spigoli e raggi per il modificatore Skin."""
    V, E, R = [], [], []

    def v(p, r):
        V.append(Vector(p))
        R.append(tuple(x * scale + add for x in (r if isinstance(r, tuple) else (r, r))))
        return len(V) - 1

    pelvis = v((0, 0, torso_low), (0.125, 0.1))
    if 'torso' in parts:
        waist = v((0, 0, 1.02), (0.106, 0.084))
        chest = v((0, 0, 1.18), (0.128, 0.094))
        upper = v((0, 0, 1.3), (0.122, 0.088))
        E += [(pelvis, waist), (waist, chest), (chest, upper)]
        if 'neck' in parts:
            nb = v((0, 0, 1.38), 0.05)
            nt = v((0, 0, 1.49), 0.044)
            E += [(upper, nb), (nb, nt)]
        if 'collar' in parts:
            nb = v((0, 0, 1.38), 0.062)
            E += [(upper, nb)]
        if 'arms' in parts:
            for s in (1, -1):
                sh = v(SH[s], 0.052)
                E.append((upper, sh))
                if sleeve >= 1:
                    el = v(ELBOW[s], 0.042)
                    wr = v(WRIST[s], 0.033)
                    E += [(sh, el), (el, wr)]
                    if 'hands' in parts:
                        d = arm_dir(s)
                        palm = v(WRIST[s] + d * 0.05, (0.038, 0.018))
                        tip = v(WRIST[s] + d * 0.105, (0.026, 0.014))
                        th = v(WRIST[s] + d * 0.035 + Vector((0, -0.04, 0.0)), 0.015)
                        E += [(wr, palm), (palm, tip), (wr, th)]
                else:
                    mid = v(SH[s] + arm_dir(s) * 0.26 * sleeve, 0.047)
                    E.append((sh, mid))
    if 'legs' in parts:
        for s in (1, -1):
            hp = v(HIP[s], 0.078)
            E.append((pelvis, hp))
            if leg_end >= 1:
                kn = v(KNEE[s], 0.054)
                an = v(ANKLE[s], 0.04)
                E += [(hp, kn), (kn, an)]
            else:
                end = v(HIP[s].lerp(KNEE[s], leg_end), 0.07)
                E.append((hp, end))
    return V, E, R


V, E, R = body_skeleton()
body = skin_mesh('Body', V, E, R, M['Skin'])
head = latlong('Head', 1.0, M['Skin'])
# orecchie
ears = []
for s in (1, -1):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.028)
    bmesh.ops.scale(bm, vec=(0.45, 0.8, 1.1), verts=bm.verts)
    bmesh.ops.translate(bm, vec=S(0.52 * PI, s * PI / 2, 0.97), verts=bm.verts)
    ears.append(mesh_object('ear', bm, M['Skin']))
head = join([head] + ears, 'Head')

# viso: superficie frontale con UV 0..1 (la texture viene disegnata nel gioco)
face = latlong('Face', 1.006, M['Face'], rings=20, segs=20, uv=True,
               th0=0.35 * PI, th1=0.75 * PI, ph0=-0.55, ph1=0.55, closed=False)

# ------------------------------------------------------------------ scarpe
shoe_parts = []
for s in (1, -1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.1, 0.24, 0.085), verts=bm.verts)
    obj = mesh_object('shoe', bm, M['Shoes'])
    obj.location = ANKLE[s] + Vector((0, -0.045, -0.04))
    sub = obj.modifiers.new('s', 'SUBSURF')
    sub.levels = 2
    apply_modifiers(obj)
    for vtx in obj.data.vertices:
        if vtx.co.z < -0.02:  # base piatta
            vtx.co.z = -0.02
        if vtx.co.y < 0:  # punta più bassa, tallone più alto
            vtx.co.z -= 0.012 * (-vtx.co.y / 0.12) * max(0.0, vtx.co.z + 0.02) / 0.05
    obj.data.update()
    shoe_parts.append(obj)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.106, 0.25, 0.022), verts=bm.verts)
    sole = mesh_object('sole', bm, M['Sole'], smooth=False)
    sole.location = ANKLE[s] + Vector((0, -0.045, -0.072))
    bev = sole.modifiers.new('b', 'BEVEL')
    bev.width = 0.008
    bev.segments = 2
    apply_modifiers(sole)
    shoe_parts.append(sole)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.108, 0.07, 0.014), verts=bm.verts)
    stripe = mesh_object('stripe', bm, M['Accent'], smooth=False)
    stripe.location = ANKLE[s] + Vector((0, -0.02, -0.03))
    shoe_parts.append(stripe)
shoes = join(shoe_parts, 'Shoes')


# ------------------------------------------------------------------ vestiti
def ring_curve(name, center, radius, thickness, mat, rot=Matrix.Identity(3), arc=2 * PI, start=0.0, segs=48):
    pts = []
    n = segs
    for i in range(n + 1 if arc < 2 * PI else n):
        a = start + arc * i / n
        pts.append(Vector(center) + rot @ Vector((math.cos(a) * radius, math.sin(a) * radius, 0)))
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = thickness
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1)
    sp.use_cyclic_u = arc >= 2 * PI
    obj = bpy.data.objects.new(name, cu)
    link(obj)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    m = bpy.data.objects.new(name, me)
    link(m)
    for p in me.polygons:
        p.use_smooth = True
    set_material(m, mat)
    return m


def box(name, size, loc, mat, subdiv=2, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    obj = mesh_object(name, bm, mat)
    if subdiv:
        sub = obj.modifiers.new('s', 'SUBSURF')
        sub.levels = subdiv
        apply_modifiers(obj)
    if rot:
        obj.data.transform(rot.to_4x4())
    obj.location = loc
    return obj


Rx90 = Matrix.Rotation(PI / 2, 3, 'X')

# Felpa
V, E, R = body_skeleton(1.1, 0.012, parts=('torso', 'arms', 'collar'), torso_low=0.86)
hoodie = skin_mesh('Top_hoodie', V, E, R, M['Top'])
hood_v = [(-0.1, 0.0, 1.38), (-0.085, 0.07, 1.41), (0, 0.11, 1.43), (0.085, 0.07, 1.41), (0.1, 0.0, 1.38)]
hood = skin_mesh('hood', hood_v, [(0, 1), (1, 2), (2, 3), (3, 4)], [0.035, 0.045, 0.05, 0.045, 0.035], M['TopDark'], root=2)
pocket = box('pocket', (0.2, 0.03, 0.09), (0, -0.112, 0.97), M['TopDark'])
laces = [curve_strand('lace', [(x, -0.105, 1.36), (x * 1.2, -0.125, 1.28), (x * 1.1, -0.128, 1.22)], 0.005, 0.004, bulge=0) for x in (0.03, -0.03)]
for lace in laces:
    set_material(lace, M['Accent'])
cuffs = [ring_curve('cuff', WRIST[s] + arm_dir(s) * -0.02, 0.043, 0.012, M['TopDark'],
                    rot=Matrix.Rotation(PI / 2 - ARM_DOWN * 1, 3, 'Y') if s > 0 else Matrix.Rotation(-(PI / 2 - ARM_DOWN), 3, 'Y'))
         for s in (1, -1)]
hem = ring_curve('hem', (0, 0, 0.87), 1.0, 0.02, M['TopDark'], rot=Matrix.Diagonal((0.142, 0.115, 1)))
top_hoodie = join([hoodie, hood, pocket, *laces, *cuffs, hem], 'Top_hoodie')

# Maglietta
V, E, R = body_skeleton(1.06, 0.008, parts=('torso', 'arms', 'collar'), torso_low=0.88, sleeve=0.48)
tshirt = skin_mesh('Top_tshirt', V, E, R, M['Top'])
collar = ring_curve('collar', (0, 0, 1.385), 0.058, 0.01, M['TopDark'])
star = ring_curve('print', (0, -0.11, 1.2), 0.035, 0.007, M['Accent'], rot=Rx90, segs=6)
top_tshirt = join([tshirt, collar, star], 'Top_tshirt')

# Giacca aperta + maglia sotto
V, E, R = body_skeleton(1.04, 0.006, parts=('torso', 'collar'), torso_low=0.88)
shirt = skin_mesh('shirt', V, E, R, M['Shirt'])
V, E, R = body_skeleton(1.14, 0.016, parts=('torso', 'arms', 'collar'), torso_low=0.84)
jacket = skin_mesh('jacket', V, E, R, M['Top'])
bm = bmesh.new()
bm.from_mesh(jacket.data)
kill = [f for f in bm.faces if f.calc_center_median().y < -0.05 and abs(f.calc_center_median().x) < 0.045 and 0.8 < f.calc_center_median().z < 1.42]
bmesh.ops.delete(bm, geom=kill, context='FACES')
bm.to_mesh(jacket.data)
bm.free()
sol = jacket.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.006
apply_modifiers(jacket)
jcollar = ring_curve('jcollar', (0, 0.01, 1.39), 0.075, 0.02, M['TopDark'], arc=1.4 * PI, start=-0.2 * PI)
jstripe = [curve_strand('jstripe', [(x, -0.122, 1.32), (x * 1.15, -0.13, 1.1), (x * 1.1, -0.128, 0.88)], 0.006, 0.006, bulge=0) for x in (0.05, -0.05)]
for js in jstripe:
    set_material(js, M['Accent'])
top_jacket = join([shirt, jacket, jcollar, *jstripe], 'Top_jacket')

# Pantaloni / shorts / gonna
V, E, R = body_skeleton(1.08, 0.01, parts=('legs',), torso_low=0.95)
pants = skin_mesh('pants', V, E, R, M['Bottom'])
belt = ring_curve('belt', (0, 0, 0.965), 1.0, 0.016, M['Dark'], rot=Matrix.Diagonal((0.132, 0.106, 1)))
buckle = box('buckle', (0.04, 0.012, 0.028), (0, -0.112, 0.965), M['Accent'], subdiv=0)
bottom_pants = join([pants, belt, buckle], 'Bottom_pants')

V, E, R = body_skeleton(1.12, 0.012, parts=('legs',), torso_low=0.95, leg_end=0.45)
shorts = skin_mesh('shorts', V, E, R, M['Bottom'])
belt2 = ring_curve('belt', (0, 0, 0.965), 1.0, 0.016, M['Dark'], rot=Matrix.Diagonal((0.132, 0.106, 1)))
buckle2 = box('buckle', (0.04, 0.012, 0.028), (0, -0.112, 0.965), M['Accent'], subdiv=0)
bottom_shorts = join([shorts, belt2, buckle2], 'Bottom_shorts')

bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=40, radius1=0.25, radius2=0.128, depth=0.34)
bmesh.ops.translate(bm, vec=(0, 0, 0.82), verts=bm.verts)
for vtx in bm.verts:  # pieghe
    a = math.atan2(vtx.co.y, vtx.co.x)
    k = (0.98 - vtx.co.z) / 0.34
    f = 1 + 0.06 * k * math.sin(a * 12)
    vtx.co.x *= f
    vtx.co.y *= f * 0.92
skirt = mesh_object('skirt', bm, M['Bottom'])
sol = skirt.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.008
sub = skirt.modifiers.new('sub', 'SUBSURF')
sub.levels = 1
apply_modifiers(skirt)
band = ring_curve('band', (0, 0, 0.985), 1.0, 0.014, M['Accent'], rot=Matrix.Diagonal((0.13, 0.112, 1)))
V, E, R = body_skeleton(1.04, 0.004, parts=('legs',), torso_low=0.95, leg_end=0.15)
under = skin_mesh('under', V, E, R, M['Bottom'])
bottom_skirt = join([skirt, band, under], 'Bottom_skirt')


# ------------------------------------------------------------------ capelli
def hair_cap(back_len):
    def keep(th, ph):
        side = smoothstep(0.55, 1.35, abs(ph))
        limit = 0.36 * PI + (back_len * PI - 0.36 * PI) * side
        return th < limit
    cap = latlong('cap', 1.075, M['Hair'], rings=28, segs=40, keep=keep)
    sol = cap.modifiers.new('sol', 'SOLIDIFY')
    sol.thickness = 0.014
    sol.offset = 1
    apply_modifiers(cap)
    return cap


def bangs(n=7, spread=1.5, length=0.46, extra=0.0):
    out = []
    for i in range(n):
        t = i / (n - 1) - 0.5
        a = t * spread
        end_th = (length + abs(t) * 0.06 + (0.07 if abs(t) > 0.4 else 0) + extra) * PI
        pts = [S(0.1 * PI, a * 0.6, 1.0), S(0.25 * PI, a, 1.12), S(0.38 * PI, a * 1.04, 1.12), S(end_th, a * 1.06, 1.1)]
        out.append(curve_strand('bang', pts, 0.034, 0.003, bulge=0.25))
    return out


def side_locks(length):
    out = []
    for s in (1, -1):
        pts = [S(0.3 * PI, s * 1.05, 1.08), S(0.45 * PI, s * 1.15, 1.12), S((0.55 + length * 0.5) * PI, s * 1.18, 1.1),
               S((0.55 + length) * PI, s * 1.12, 1.06)]
        out.append(curve_strand('lock', pts, 0.03, 0.004))
    return out


def ahoge():
    p0 = S(0.05 * PI, 0, 1.06)
    return curve_strand('ahoge', [p0, p0 + Vector((0.01, 0.01, 0.06)), p0 + Vector((0.03, -0.03, 0.08))], 0.012, 0.001, bulge=0)


hair = {}
hair['short'] = [hair_cap(0.66), *bangs(), *side_locks(0.05), ahoge()]

spikes = []
for i in range(14):
    ph = PI * 0.4 + (i / 13) * PI * 1.2 * (1 if i % 2 else -1) * 0.5 + (PI if i % 2 else 0) * 0
    ph = -PI + (i / 14) * 2 * PI
    if abs(ph) < 0.7:
        continue
    th = 0.32 * PI + (i % 3) * 0.04
    base = S(th, ph, 0.95)
    tip_dir = (base - HEAD_C).normalized()
    tip_dir.z += 0.35
    tip_dir.normalize()
    spikes.append(curve_strand('spike', [base, base + tip_dir * 0.09, base + tip_dir * 0.17], 0.045, 0.002, bulge=0.1))
for i in range(5):
    x = (i - 2) * 0.045
    base = S(0.08 * PI, x * 3, 1.0)
    spikes.append(curve_strand('spike', [base, base + Vector((x * 0.6, 0.02, 0.08)), base + Vector((x * 1.2, 0.08, 0.13))], 0.04, 0.002, bulge=0.1))
hair['spiky'] = [hair_cap(0.62), *bangs(6, 1.5, 0.44), *side_locks(0.02), *spikes]

bob_strands = []
for i in range(13):
    ph = -PI + (i / 12) * 2 * PI
    if abs(ph) < 1.0:
        continue
    pts = [S(0.45 * PI, ph, 1.08), S(0.62 * PI, ph, 1.16), S(0.74 * PI, ph, 1.14)]
    bob_strands.append(curve_strand('bob', pts, 0.05, 0.012, bulge=0.2))
hair['bob'] = [hair_cap(0.78), *bangs(9, 1.6, 0.47), *side_locks(0.18), *bob_strands]

long_strands = []
for i in range(11):
    t = i / 10 - 0.5
    ph = PI + t * 1.8
    top = S(0.55 * PI, ph, 1.08)
    pts = [top, top + Vector((0, 0.04, -0.12)), top + Vector((t * 0.05, 0.05, -0.3)), top + Vector((t * 0.08, 0.02, -0.46 + abs(t) * 0.08))]
    long_strands.append(curve_strand('long', pts, 0.045, 0.006, bulge=0.3))
hair['long'] = [hair_cap(0.74), *bangs(), *side_locks(0.35), ahoge(), *long_strands]

tie_p = S(0.55 * PI, PI, 1.07)
pony = curve_strand('pony', [tie_p, tie_p + Vector((0, 0.07, 0.02)), tie_p + Vector((0, 0.11, -0.12)), tie_p + Vector((0, 0.08, -0.32)), tie_p + Vector((0, 0.05, -0.42))], 0.055, 0.006, bulge=0.4)
pony_tie = ring_curve('tie', tie_p + Vector((0, 0.025, 0)), 0.03, 0.012, M['Accent'], rot=Matrix.Rotation(PI / 2 - 0.5, 3, 'X'))
hair['ponytail'] = [hair_cap(0.62), *bangs(), *side_locks(0.08), pony, pony_tie]

twins = []
for s in (1, -1):
    p = S(0.42 * PI, s * 2.0, 1.05)
    twins.append(curve_strand('twin', [p, p + Vector((0.06 * s, 0.02, 0.02)), p + Vector((0.1 * s, 0.05, -0.12)), p + Vector((0.08 * s, 0.04, -0.32)), p + Vector((0.06 * s, 0.02, -0.45))], 0.05, 0.006, bulge=0.4))
    twins.append(ring_curve('tie', p + Vector((0.015 * s, 0, 0)), 0.026, 0.011, M['Accent'], rot=Matrix.Rotation(PI / 2, 3, 'Y')))
hair['twintails'] = [hair_cap(0.66), *bangs(), *side_locks(0.12), *twins]

hair_objs = {}
for k, parts in hair.items():
    for p in parts:
        if not p.data.materials:
            p.data.materials.append(M['Hair'])
    hair_objs[k] = join(parts, f'Hair_{k}')

# ------------------------------------------------------------------ accessori
def ear(s, h, w, inner_mat):
    base = S(0.17 * PI, s * 1.2, 0.95)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=w, radius2=0.0, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    bmesh.ops.scale(bm, vec=(1, 0.45, 1), verts=bm.verts)
    o = mesh_object('ear', bm, M['Hair'], smooth=False)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=w * 0.6, radius2=0.0, depth=h * 0.75)
    bmesh.ops.translate(bm, vec=(0, -0.012, h * 0.37), verts=bm.verts)
    bmesh.ops.scale(bm, vec=(1, 0.3, 1), verts=bm.verts)
    i = mesh_object('earin', bm, inner_mat, smooth=False)
    out = join([o, i], 'ear')
    out.data.transform((Matrix.Translation(base) @ Matrix.Rotation(-s * 0.4, 4, 'Y') @ Matrix.Rotation(0.15, 4, 'X')))
    return out


def tail_mesh(r, length, tip_mat):
    p0 = Vector((0, 0.11, 0.9))
    pts = [p0, p0 + Vector((0, 0.1, -0.05)), p0 + Vector((0, length * 0.55, -0.02)), p0 + Vector((0, length * 0.85, 0.1)), p0 + Vector((0, length, 0.2))]
    t = curve_strand('tail', pts, r, r * 0.2, bulge=0.5 if r > 0.05 else 0.05)
    set_material(t, M['Hair'])
    parts = [t]
    if tip_mat:
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=r * 0.9)
        bmesh.ops.scale(bm, vec=(1, 1.6, 1.2), verts=bm.verts)
        bmesh.ops.translate(bm, vec=pts[-1] + Vector((0, -0.03, -0.01)), verts=bm.verts)
        parts.append(mesh_object('tip', bm, tip_mat))
    return join(parts, 'tail')


acc = {}
acc['catears'] = [ear(1, 0.09, 0.055, M['Pink']), ear(-1, 0.09, 0.055, M['Pink']), tail_mesh(0.022, 0.5, None)]
acc['foxears'] = [ear(1, 0.13, 0.06, M['White']), ear(-1, 0.13, 0.06, M['White']), tail_mesh(0.075, 0.45, M['White'])]
acc['halo'] = [ring_curve('halo', HEAD_C + Vector((0, 0.03, 0.24)), 0.12, 0.012, M['Accent'], rot=Matrix.Rotation(-0.25, 3, 'X'))]
hp = [ring_curve('band', HEAD_C + Vector((0, 0.0, 0.0)), HEAD_R * 1.16, 0.013, M['Dark'], rot=Rx90 @ Matrix.Rotation(0, 3, 'Z'), arc=PI, start=0)]
for s in (1, -1):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.05, radius2=0.048, depth=0.045)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(PI / 2, 3, 'Y'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=HEAD_C + Vector((s * HEAD_R * 1.1, 0, -0.01)), verts=bm.verts)
    hp.append(mesh_object('cup', bm, M['Dark']))
    hp.append(ring_curve('glow', HEAD_C + Vector((s * (HEAD_R * 1.1 + 0.024), 0, -0.01)), 0.035, 0.007, M['Accent'], rot=Matrix.Rotation(PI / 2, 3, 'Y')))
acc['headphones'] = hp
gl = []
eye_c = S(0.54 * PI, 0, 1.0)
for s in (1, -1):
    c = S(0.54 * PI, s * 0.33, 1.06)
    gl.append(ring_curve('rim', c, 0.034, 0.004, M['Dark'], rot=Rx90 @ Matrix.Diagonal((1, 0.8, 1)) @ Matrix.Rotation(0, 3, 'Z')))
    gl.append(curve_strand('temple', [c + Vector((s * 0.034, 0, 0)), S(0.52 * PI, s * 1.3, 1.04), S(0.52 * PI, s * 1.65, 1.02)], 0.004, 0.004, bulge=0))
gl.append(curve_strand('bridge', [S(0.53 * PI, 0.12, 1.07), S(0.52 * PI, 0, 1.08), S(0.53 * PI, -0.12, 1.07)], 0.004, 0.004, bulge=0))
for g in gl:
    set_material(g, M['Dark'])
acc['glasses'] = gl
hr = []
for s in (1, -1):
    b = S(0.2 * PI, s * 0.8, 0.95)
    h = curve_strand('horn', [b, b + Vector((s * 0.03, 0.0, 0.07)), b + Vector((s * 0.05, 0.05, 0.13)), b + Vector((s * 0.03, 0.11, 0.16))], 0.026, 0.002, bulge=0)
    set_material(h, M['Dark'])
    hr.append(h)
    hr.append(ring_curve('hring', b + Vector((0, 0, 0.02)), 0.022, 0.005, M['Accent']))
acc['horns'] = hr
acc_objs = {k: join(v, f'Acc_{k}') for k, v in acc.items()}

# ------------------------------------------------------------------ skinning
skinned_auto = [body, top_hoodie, top_tshirt, top_jacket, bottom_pants, bottom_shorts]


def add_armature_mod(obj):
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    obj.parent = rig


def rigid(obj, weights):
    """weights: funzione(co) -> {osso: peso}."""
    groups = {}
    for v in obj.data.vertices:
        for bname, w in weights(v.co).items():
            if w <= 0:
                continue
            if bname not in groups:
                groups[bname] = obj.vertex_groups.get(bname) or obj.vertex_groups.new(name=bname)
            groups[bname].add([v.index], w, 'REPLACE')
    add_armature_mod(obj)


set_deform(SOFT_BONES, False)
for obj in skinned_auto:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
set_deform(SOFT_BONES, True)

head_only = lambda co: {'head': 1.0}  # noqa: E731
for obj in [head, face, *[o for k, o in hair_objs.items() if k in ('short', 'spiky', 'bob')], acc_objs['halo'], acc_objs['headphones'], acc_objs['glasses'], acc_objs['horns']]:
    rigid(obj, head_only)


def chain_weights(root_bone, start):
    def w(co):
        k = smoothstep(0.0, 0.12, (co - start).length)
        return {'head': 1 - k, root_bone: k}
    return w


def hair_long(co):
    k = smoothstep(1.5, 1.25, co.z) if co.y > 0.05 else 0.0
    return {'head': 1 - k, 'hair_back': k}


def hair_pony(co):
    d = (co - tie_p)
    k = smoothstep(0.03, 0.12, d.length) if d.y > -0.01 and co.z < tie_p.z + 0.06 else 0.0
    return {'head': 1 - k, 'hair_tail': k}


def hair_twin(co):
    for s, n in ((1, 'L'), (-1, 'R')):
        p = S(0.42 * PI, s * 2.0, 1.05)
        if co.x * s > 0.12 and co.z < p.z + 0.04:
            k = smoothstep(0.03, 0.12, (co - p).length)
            return {'head': 1 - k, f'hair_tail_{n}': k}
    return {'head': 1.0}


rigid(hair_objs['long'], hair_long)
rigid(hair_objs['ponytail'], hair_pony)
rigid(hair_objs['twintails'], hair_twin)


def ears_and_tail(co):
    if co.z > 1.3:
        return {'head': 1.0}
    k = smoothstep(0.1, 0.42, co.y)
    k1 = 1 - k
    base = smoothstep(0.1, 0.18, co.y)
    return {'hips': 1 - base, 'tail_1': base * k1, 'tail_2': k}


rigid(acc_objs['catears'], ears_and_tail)
rigid(acc_objs['foxears'], ears_and_tail)


def shoe_w(co):
    s = 'L' if co.x > 0 else 'R'
    return {f'foot_{s}': 1.0}


rigid(shoes, shoe_w)


def skirt_w(co):
    s = 'L' if co.x > 0 else 'R'
    k = smoothstep(0.95, 0.65, co.z) * 0.45 * smoothstep(0.0, 0.08, abs(co.x))
    return {'hips': 1 - k, f'thigh_{s}': k}


rigid(bottom_skirt, skirt_w)

# ------------------------------------------------------------------ animazioni
rig.rotation_mode = 'XYZ'
for pb in rig.pose.bones:
    pb.rotation_mode = 'QUATERNION'
REST = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}


def Rx(a):
    return Matrix.Rotation(a, 3, 'X')


def Ry(a):
    return Matrix.Rotation(a, 3, 'Y')


def Rz(a):
    return Matrix.Rotation(a, 3, 'Z')


def Raxis(axis, a):
    return Matrix.Rotation(a, 3, Vector(axis).normalized())


FWD = Vector((0, -1, 0))


def arm_pose(side, out_deg, swing=0.0, twist=0.0):
    """Braccio: angolo dalla verticale verso l'esterno + oscillazione avanti/indietro."""
    return Rx(swing) @ Rz(twist * side) @ Ry(side * rad(50 - out_deg))


def elbow_pose(side, bend, wave=0.0):
    d = arm_dir(side)
    return Raxis(FWD, wave * side) @ Raxis(d.cross(FWD), bend)


def leg_pose(side, swing, spread=0.0):
    return Rx(swing) @ Ry(-side * spread)


BASE = lambda: {  # noqa: E731
    'hips_loc': Vector((0, 0, 0)),
    'upper_arm_L': arm_pose(1, 9), 'upper_arm_R': arm_pose(-1, 9),
    'forearm_L': elbow_pose(1, 0.15), 'forearm_R': elbow_pose(-1, 0.15),
}


def p_idle(t):
    P = BASE()
    b = math.sin(t * 2 * PI * 2)  # due respiri per ciclo
    w = math.sin(t * 2 * PI)
    P['hips_loc'] = Vector((w * 0.012, 0, -0.005 + b * 0.003))
    P['hips'] = Ry(w * 0.03)
    P['spine'] = Rx(b * 0.012)
    P['chest'] = Rx(b * 0.015)
    P['thigh_L'] = leg_pose(1, 0, -w * 0.03 + 0.02)
    P['thigh_R'] = leg_pose(-1, 0, w * 0.03 + 0.02)
    P['shin_L'] = Rx(0.05 + max(0, w) * 0.1)
    P['shin_R'] = Rx(0.05 + max(0, -w) * 0.1)
    P['head'] = Rz(math.sin(t * 2 * PI) * 0.25) @ Rx(math.sin(t * 4 * PI + 1) * 0.05)
    P['upper_arm_L'] = arm_pose(1, 9 + b * 1.5, 0.03)
    P['upper_arm_R'] = arm_pose(-1, 9 + b * 1.5, 0.03)
    return P


def locomotion(t, run):
    P = BASE()
    ph = t * 2 * PI
    amp_leg = 0.95 if run else 0.6
    for side, n, off in ((1, 'L', 0), (-1, 'R', PI)):
        s = math.sin(ph + off)
        c = math.cos(ph + off)
        swing = -s * amp_leg
        knee = (0.15 + max(0.0, c) * (1.5 if run else 0.75)) if True else 0
        if run and s < 0:
            knee += 0.2
        P[f'thigh_{n}'] = leg_pose(side, swing, 0.02)
        P[f'shin_{n}'] = Rx(knee)
        P[f'foot_{n}'] = Rx(-(swing + knee) * 0.35 - (0.25 * s if run else 0.12 * s))
        P[f'upper_arm_{n}'] = arm_pose(side, 12 if run else 9, s * (0.85 if run else 0.5))
        P[f'forearm_{n}'] = elbow_pose(side, 1.35 if run else 0.35)
    bob = abs(math.cos(ph)) * (0.05 if run else 0.025)
    P['hips_loc'] = Vector((0, 0, -0.035 + bob if run else -0.012 + bob))
    P['hips'] = Rz(math.sin(ph) * 0.12)
    P['spine'] = Rx(0.18 if run else 0.04) @ Rz(-math.sin(ph) * 0.12)
    P['chest'] = Rz(-math.sin(ph) * 0.1)
    P['head'] = Rx(-0.12 if run else -0.02) @ Rz(math.sin(ph) * 0.1)
    return P


def p_jump(t):
    P = BASE()
    P['thigh_L'] = leg_pose(1, -0.9)
    P['shin_L'] = Rx(1.4)
    P['thigh_R'] = leg_pose(-1, 0.25)
    P['shin_R'] = Rx(0.55)
    P['upper_arm_L'] = arm_pose(1, 70, -0.3)
    P['upper_arm_R'] = arm_pose(-1, 70, 0.3)
    P['forearm_L'] = elbow_pose(1, 0.6)
    P['forearm_R'] = elbow_pose(-1, 0.4)
    P['spine'] = Rx(0.1)
    P['head'] = Rx(-0.1)
    P['hips_loc'] = Vector((0, 0, 0.02 + math.sin(t * 2 * PI) * 0.01))
    return P


def p_wave(t):
    P = p_idle(t * 0.5)
    w = math.sin(t * 2 * PI * 3)
    P['upper_arm_R'] = arm_pose(-1, 150, -0.25)
    P['forearm_R'] = elbow_pose(-1, 0.3, 0.45 * w)
    P['chest'] = Ry(-0.06)
    P['head'] = Rx(-0.05) @ Ry(-0.1)
    return P


def p_cheer(t):
    P = BASE()
    b = abs(math.sin(t * 2 * PI * 2))
    P['upper_arm_L'] = arm_pose(1, 160 + b * 10)
    P['upper_arm_R'] = arm_pose(-1, 160 + b * 10)
    P['forearm_L'] = elbow_pose(1, 0.3)
    P['forearm_R'] = elbow_pose(-1, 0.3)
    P['hips_loc'] = Vector((0, 0, -0.04 + b * 0.07))
    for side, n in ((1, 'L'), (-1, 'R')):
        P[f'thigh_{n}'] = leg_pose(side, -0.25 + b * 0.2, 0.05)
        P[f'shin_{n}'] = Rx(0.45 - b * 0.4)
        P[f'foot_{n}'] = Rx(-0.15)
    P['head'] = Rx(-0.25)
    P['spine'] = Rx(-0.08)
    return P


def p_dance(t):
    P = BASE()
    beat = t * 2 * PI * 4
    s = math.sin(beat)
    c = math.cos(beat / 2)
    P['hips_loc'] = Vector((s * 0.05, 0, -0.06 + abs(math.cos(beat)) * 0.04))
    P['hips'] = Rz(c * 0.35) @ Ry(-s * 0.08)
    P['spine'] = Ry(s * 0.12) @ Rz(-c * 0.2)
    P['chest'] = Ry(s * 0.06)
    for side, n, sg in ((1, 'L', 1), (-1, 'R', -1)):
        lift = max(0.0, s * sg)
        P[f'thigh_{n}'] = leg_pose(side, -0.25 - lift * 0.3, 0.06)
        P[f'shin_{n}'] = Rx(0.45 + lift * 0.4)
        P[f'foot_{n}'] = Rx(-0.2)
        P[f'upper_arm_{n}'] = arm_pose(side, 85 + s * sg * 55, -0.5 - c * 0.4 * sg)
        P[f'forearm_{n}'] = elbow_pose(side, 1.3 + s * sg * 0.4)
    P['head'] = Ry(-s * 0.15) @ Rx(abs(math.cos(beat)) * 0.12)
    return P


def p_sit(t):
    P = BASE()
    P['hips_loc'] = Vector((0, 0.02, -0.4))
    for side, n in ((1, 'L'), (-1, 'R')):
        P[f'thigh_{n}'] = leg_pose(side, -1.5, 0.08)
        P[f'shin_{n}'] = Rx(1.5)
        P[f'upper_arm_{n}'] = arm_pose(side, 14, -0.55)
        P[f'forearm_{n}'] = elbow_pose(side, 0.7)
    P['spine'] = Rx(-0.06)
    P['head'] = Rz(math.sin(t * 2 * PI) * 0.35) @ Rx(math.sin(t * 4 * PI) * 0.06)
    return P


def p_floor(t):
    P = BASE()
    P['hips_loc'] = Vector((0, 0.03, -0.78))
    for side, n in ((1, 'L'), (-1, 'R')):
        P[f'thigh_{n}'] = leg_pose(side, -1.45, 0.14)
        P[f'shin_{n}'] = Rx(0.2 if side > 0 else 0.4)
        P[f'upper_arm_{n}'] = arm_pose(side, 25, 0.45)
        P[f'forearm_{n}'] = elbow_pose(side, -0.05)
    P['spine'] = Rx(-0.22)
    P['head'] = Rx(0.18 + math.sin(t * 2 * PI) * 0.05) @ Rz(math.sin(t * 2 * PI) * 0.3)
    return P


ACTIONS = [
    ('idle', 120, p_idle), ('walk', 24, lambda t: locomotion(t, False)), ('run', 18, lambda t: locomotion(t, True)),
    ('jump', 20, p_jump), ('wave', 60, p_wave), ('cheer', 40, p_cheer), ('dance', 64, p_dance),
    ('sit', 120, p_sit), ('floor', 120, p_floor),
]

rig.animation_data_create()
ALL_BONES = [b.name for b in arm_data.bones]
for name, frames, fn in ACTIONS:
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    prev = {}
    for f in range(frames + 1):
        P = fn(f / frames)
        for bname in ALL_BONES:
            pb = rig.pose.bones[bname]
            Rw = P.get(bname, Matrix.Identity(3))
            Rb = REST[bname]
            q = (Rb.inverted() @ Rw @ Rb).to_quaternion()
            if bname in prev:
                q.make_compatible(prev[bname])
            prev[bname] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f)
            if bname == 'hips':
                pb.location = REST['hips'].inverted() @ P['hips_loc']
                pb.keyframe_insert('location', frame=f)
            else:
                pb.location = (0, 0, 0)
    # interpolazione lineare: le pose sono già campionate fotogramma per fotogramma
    try:
        for fc in act.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    except AttributeError:
        pass

# posa di riposo per l'export
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_quaternion = Quaternion()
    pb.location = (0, 0, 0)

# ------------------------------------------------------------------ anteprima (facoltativa)
if PREVIEW:
    scene = bpy.context.scene
    show = {'Body', 'Head', 'Face', 'Shoes', 'Hair_twintails', 'Top_jacket', 'Bottom_skirt', 'Acc_catears'}
    for o in scene.objects:
        if o.type == 'MESH':
            o.hide_render = o.name not in show
    M['Face'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.95, 0.78, 0.68, 1)
    act = bpy.data.actions['wave']
    rig.animation_data.action = act
    scene.frame_set(10)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    link(cam)
    cam.location = (1.6, -3.0, 1.3)
    direction = Vector((0, 0, 0.95)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = 50
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (0.8, 0.2, 0.6)
    link(sun)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.55, 0.75, 1)
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None
    scene.frame_set(0)
    for o in scene.objects:
        o.hide_render = False

# ------------------------------------------------------------------ export
total = 0
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        o.data.validate()
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        total += tris
        print(f'  {o.name:18s} {tris:7d} triangoli')
print('  TOTALE', total)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT),
    export_format='GLB',
    export_yup=True,
    export_apply=False,
    export_skins=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_def_bones=False,
    export_draco_mesh_compression_enable=False,
    export_draco_mesh_compression_level=6,
    export_lights=False,
    export_cameras=False,
)
print('ESPORTATO', OUT)
