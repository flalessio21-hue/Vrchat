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
    'Gold': material('Gold', (1.0, 0.78, 0.35, 1), rough=0.25, metal=1.0),
    'Visor': material('Visor', (0.3, 0.9, 1.0, 1), emissive=(0.3, 0.9, 1.0, 1.0), rough=0.05),
}

# ------------------------------------------------------------------ proporzioni
HEAD_R = 0.182  # testa grande: proporzioni da cartone animato
HEAD_C = Vector((0, 0, 1.475 + HEAD_R * 0.98))
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
bone('head', (0, 0, 1.45), (0, 0, HEAD_C.z + HEAD_R), 'neck', connect=True)
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
ARM_PTS = [(0.13, 0.054), (0.26, 0.046), (0.36, 0.047), (0.495, 0.036)]  # (distanza dalla spalla, raggio)
LEG_PTS = [(0.15, 0.082), (0.33, 0.071), (0.5, 0.06), (0.62, 0.064), (0.8, 0.052), (1.0, 0.044)]  # frazione anca->caviglia
TORSO_PTS = [(0.93, (0.127, 0.097)), (1.03, (0.106, 0.083)), (1.13, (0.12, 0.09)), (1.22, (0.131, 0.097)), (1.31, (0.124, 0.088))]
FWD = Vector((0, -1, 0))


def palm_normal(side):
    return arm_dir(side).cross(FWD) * side


def body_skeleton(scale=1.0, add=0.0, parts=('torso', 'arms', 'legs', 'hands', 'neck', 'feet'), torso_low=0.86, sleeve=1.0, leg_end=1.0):
    """Vertici, spigoli e raggi per il modificatore Skin: anatomia con
    spalle, bicipiti, avambracci, mani a cinque dita, cosce, ginocchia, polpacci."""
    V, E, R = [], [], []

    def v(p, r):
        V.append(Vector(p))
        R.append(tuple(x * scale + add for x in (r if isinstance(r, tuple) else (r, r))))
        return len(V) - 1

    def chain(prev, pts):
        for p, r in pts:
            i = v(p, r)
            E.append((prev, i))
            prev = i
        return prev

    def hand(s, wr):
        d = arm_dir(s)
        n = palm_normal(s)
        W = WRIST[s]
        palm = chain(wr, [(W + d * 0.05, (0.047, 0.022))])
        for k, off in enumerate((-0.024, -0.008, 0.008, 0.024)):
            ln = 0.8 if k == 3 else (0.95 if k == 0 else 1.0)
            base = W + d * 0.095 + FWD * -off * 1.3
            f1 = base + d * 0.034 * ln + n * 0.005
            f2 = f1 + (d * 0.85 + n * 0.4).normalized() * 0.028 * ln
            chain(palm, [(base, 0.0145), (f1, 0.0125), (f2, 0.0105)])
        t0 = W + d * 0.02 + FWD * 0.022 + n * 0.012
        t1 = t0 + (d * 0.5 + FWD * 0.6 + n * 0.4).normalized() * 0.03
        t2 = t1 + (d * 0.8 + FWD * 0.3 + n * 0.35).normalized() * 0.024
        chain(wr, [(t0, 0.018), (t1, 0.015), (t2, 0.012)])

    pelvis = v((0, 0, torso_low), (0.13, 0.1))
    if 'waist' in parts:  # vita dei pantaloni: anello sopra il bacino
        chain(pelvis, [((0, 0, 0.975), (0.122, 0.095))])
    if 'torso' in parts:
        upper = chain(pelvis, [(Vector((0, 0, z)), r) for z, r in TORSO_PTS if z > torso_low + 0.02])
        if 'neck' in parts:
            chain(upper, [((0, 0, 1.38), 0.052), ((0, 0, 1.49), 0.045)])
        if 'collar' in parts:
            chain(upper, [((0, 0, 1.385), 0.064)])
        if 'arms' in parts:
            L = 0.495 * sleeve
            for s in (1, -1):
                sh = v(SH[s], 0.056)
                E.append((upper, sh))
                pts, prev_u, prev_r = [], 0.0, 0.056
                for u, r in ARM_PTS:
                    if u <= L + 1e-6:
                        pts.append((SH[s] + arm_dir(s) * u, r))
                        prev_u, prev_r = u, r
                    else:
                        k = (L - prev_u) / (u - prev_u)
                        pts.append((SH[s] + arm_dir(s) * L, prev_r + (r - prev_r) * k + 0.006))
                        break
                wr = chain(sh, pts)
                if 'hands' in parts and sleeve >= 1:
                    hand(s, wr)
    elif 'hands' in parts:  # solo mani (guanti)
        for s in (1, -1):
            wr = v(WRIST[s] - arm_dir(s) * 0.07, 0.036)
            hand(s, chain(wr, [(WRIST[s], 0.033)]))
    if 'legs' in parts:
        for s in (1, -1):
            hp = v(HIP[s], 0.08)
            E.append((pelvis, hp))
            pts, prev_u, prev_r = [], 0.0, 0.08
            for u, r in LEG_PTS:
                pos = HIP[s].lerp(ANKLE[s], u)
                if u <= leg_end + 1e-6:
                    pts.append((pos, r))
                    prev_u, prev_r = u, r
                else:
                    k = (leg_end - prev_u) / (u - prev_u)
                    pts.append((HIP[s].lerp(ANKLE[s], leg_end), prev_r + (r - prev_r) * k + 0.004))
                    break
            an = chain(hp, pts)
            if 'feet' in parts and leg_end >= 1:
                chain(an, [(ANKLE[s] + Vector((0, -0.06, -0.035)), (0.034, 0.03)), (ANKLE[s] + Vector((0, -0.12, -0.055)), (0.03, 0.022))])
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
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.011)
bmesh.ops.scale(bm, vec=(0.75, 0.9, 1.3), verts=bm.verts)
bmesh.ops.translate(bm, vec=S(0.6 * PI, 0, 0.975), verts=bm.verts)
nose = mesh_object('nose', bm, M['Skin'])
head = join([head, nose] + ears, 'Head')

# viso: superficie frontale con UV 0..1 (la texture viene disegnata nel gioco)
face = latlong('Face', 1.006, M['Face'], rings=20, segs=20, uv=True,
               th0=0.35 * PI, th1=0.75 * PI, ph0=-0.55, ph1=0.55, closed=False)

# ------------------------------------------------------------------ scarpe
def rounded_box(name, size, loc, mat, levels=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    o = mesh_object(name, bm, mat)
    sub = o.modifiers.new('s', 'SUBSURF')
    sub.levels = levels
    apply_modifiers(o)
    o.data.transform(Matrix.Translation(loc))
    return o


def shoe(s, boots=False):
    A = ANKLE[s]
    parts = []
    upper = rounded_box('upper', (0.125, 0.3, 0.11), A + Vector((0, -0.055, -0.03)), M['Shoes'])
    for vtx in upper.data.vertices:
        z = vtx.co.z - (A.z - 0.035)
        if z < -0.02:
            vtx.co.z = A.z - 0.035 - 0.02
        if vtx.co.y - A.y < -0.06:  # punta che scende
            vtx.co.z -= 0.014 * min(1.0, (-(vtx.co.y - A.y) - 0.06) / 0.1) * max(0.0, z + 0.02) / 0.06
    parts.append(upper)
    sole = rounded_box('sole', (0.135, 0.315, 0.04), A + Vector((0, -0.055, -0.072)), M['Dark'] if boots else M['Sole'], levels=1)
    parts.append(sole)
    if boots:
        shaft = skin_mesh('shaft', [A + Vector((0, 0.005, -0.02)), A + Vector((0, 0.0, 0.1)), A + Vector((0, 0.005, 0.2))], [(0, 1), (1, 2)],
                          [0.056, 0.055, 0.058], M['Shoes'], subdiv=1)
        parts.append(shaft)
        parts.append(ring_curve('cuff', A + Vector((0, 0.005, 0.2)), 0.06, 0.01, M['Dark']))
        parts.append(ring_curve('strap', A + Vector((0, 0.0, 0.07)), 0.059, 0.008, M['Accent']))
    else:
        cap = rounded_box('toecap', (0.098, 0.07, 0.05), A + Vector((0, -0.14, -0.05)), M['Sole'], levels=2)
        parts.append(cap)
        for k in range(3):  # lacci
            parts.append(box('lace', (0.06, 0.008, 0.008), A + Vector((0, -0.075 + k * 0.025, 0.012 - k * 0.004)), M['Sole'], subdiv=0))
        parts.append(box('tongue', (0.05, 0.03, 0.03), A + Vector((0, -0.02, 0.025)), M['Shoes'], subdiv=1))
        parts.append(box('heel', (0.03, 0.015, 0.05), A + Vector((0, 0.08, -0.01)), M['Accent'], subdiv=0))
        for side in (-1, 1):
            parts.append(box('stripe', (0.006, 0.09, 0.016), A + Vector((side * 0.051, -0.04, -0.03)), M['Accent'], subdiv=0))
    return join(parts, 'shoe')


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
shoes_sneakers = join([shoe(1), shoe(-1)], 'Shoes_sneakers')
shoes_boots = join([shoe(1, True), shoe(-1, True)], 'Shoes_boots')

# Felpa
V, E, R = body_skeleton(1.1, 0.012, parts=('torso', 'arms', 'collar'), torso_low=0.86)
hoodie = skin_mesh('Top_hoodie', V, E, R, M['Top'])
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.15 or v.co.z > 0.75], context='VERTS')
bmesh.ops.scale(bm, vec=(0.17, 0.13, 0.12), verts=bm.verts)
bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(0.35, 3, 'X'), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, 0.06, 1.42), verts=bm.verts)
hood = mesh_object('hood', bm, M['Top'])
sol = hood.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.014
apply_modifiers(hood)
hood_rim = ring_curve('hoodrim', (0, 0.0, 1.42), 1.0, 0.013, M['TopDark'], rot=Matrix.Diagonal((0.14, 0.09, 1)) @ Matrix.Rotation(0.5, 3, 'X'), arc=1.25 * PI, start=-0.12 * PI)
zipper = curve_strand('zip', [(0, -0.112, 1.36), (0, -0.124, 1.22), (0, -0.108, 1.03), (0, -0.126, 0.88)], 0.005, 0.005, bulge=0)
set_material(zipper, M['Dark'])
pull = box('pull', (0.012, 0.006, 0.03), (0, -0.122, 1.33), M['Gold'], subdiv=0)
tips = [box('tip', (0.009, 0.009, 0.02), (x * 1.1, -0.13, 1.21), M['Gold'], subdiv=0) for x in (0.03, -0.03)]
hood = join([hood, hood_rim, zipper, pull, *tips], 'hood')
pocket = box('pocket', (0.2, 0.03, 0.09), (0, -0.112, 0.97), M['TopDark'])
laces = [curve_strand('lace', [(x, -0.105, 1.36), (x * 1.2, -0.125, 1.28), (x * 1.1, -0.128, 1.22)], 0.005, 0.004, bulge=0) for x in (0.03, -0.03)]
for lace in laces:
    set_material(lace, M['Accent'])
cuffs = [ring_curve('cuff', WRIST[s] + arm_dir(s) * -0.02, 0.043, 0.012, M['TopDark'],
                    rot=Matrix.Rotation(PI / 2 - ARM_DOWN * 1, 3, 'Y') if s > 0 else Matrix.Rotation(-(PI / 2 - ARM_DOWN), 3, 'Y'))
         for s in (1, -1)]
hem = ring_curve('hem', (0, 0, 0.87), 1.0, 0.02, M['TopDark'], rot=Matrix.Diagonal((0.142, 0.115, 1)))
logo = ring_curve('logo', (0, 0.112, 1.2), 0.04, 0.006, M['Accent'], rot=Rx90, segs=5)
top_hoodie = join([hoodie, hood, pocket, *laces, *cuffs, hem, logo], 'Top_hoodie')

# Maglietta
V, E, R = body_skeleton(1.06, 0.008, parts=('torso', 'arms', 'collar'), torso_low=0.88, sleeve=0.48)
tshirt = skin_mesh('Top_tshirt', V, E, R, M['Top'])
collar = ring_curve('collar', (0, 0, 1.385), 0.058, 0.01, M['TopDark'])
star = ring_curve('print', (0, -0.11, 1.2), 0.035, 0.007, M['Accent'], rot=Rx90, segs=6)
t_hems = [ring_curve('shem', SH[s] + arm_dir(s) * 0.235, 0.052, 0.007, M['TopDark'],
                     rot=Matrix.Rotation(s * (PI / 2 - ARM_DOWN), 3, 'Y')) for s in (1, -1)]
t_hem = ring_curve('hem', (0, 0, 0.885), 1.0, 0.009, M['TopDark'], rot=Matrix.Diagonal((0.139, 0.111, 1)))
top_tshirt = join([tshirt, collar, star, *t_hems, t_hem], 'Top_tshirt')

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
lapels = []
for sd in (1, -1):
    lp = box('lapel', (0.05, 0.012, 0.12), (sd * 0.06, -0.128, 1.29), M['TopDark'], subdiv=1)
    lp.data.transform(Matrix.Translation((sd * 0.06, -0.128, 1.29)) @ Matrix.Rotation(sd * 0.35, 4, 'Y') @ Matrix.Translation((-sd * 0.06, 0.128, -1.29)))
    lapels.append(lp)
    lapels.append(box('flap', (0.075, 0.012, 0.03), (sd * 0.085, -0.122, 0.96), M['TopDark'], subdiv=1))
j_cuffs = [ring_curve('jcuff', WRIST[s] + arm_dir(s) * -0.03, 0.05, 0.014, M['TopDark'],
                      rot=Matrix.Rotation(s * (PI / 2 - ARM_DOWN), 3, 'Y')) for s in (1, -1)]
top_jacket = join([shirt, jacket, jcollar, *jstripe, *lapels, *j_cuffs], 'Top_jacket')

# Tuta cyber con piastre, spalline, linee luminose e guanti
V, E, R = body_skeleton(1.03, 0.005, parts=('torso', 'arms', 'collar'), torso_low=0.86)
suit = skin_mesh('suit', V, E, R, M['Top'])
V, E, R = body_skeleton(1.18, 0.004, parts=('hands',))
gloves = skin_mesh('gloves', V, E, R, M['Dark'])
plate = rounded_box('plate', (0.22, 0.05, 0.17), Vector((0, -0.1, 1.21)), M['TopDark'])
abs_plate = rounded_box('abs', (0.15, 0.04, 0.12), Vector((0, -0.088, 1.04)), M['TopDark'])
pads = []
for sd in (1, -1):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=0.072)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context='VERTS')
    bmesh.ops.scale(bm, vec=(1.0, 1.0, 0.75), verts=bm.verts)
    bmesh.ops.translate(bm, vec=SH[sd] + Vector((0.005 * sd, 0, 0.012)), verts=bm.verts)
    pad = mesh_object('pad', bm, M['TopDark'])
    so = pad.modifiers.new('so', 'SOLIDIFY')
    so.thickness = 0.01
    apply_modifiers(pad)
    pads.append(pad)
glow_lines = []
for sd in (1, -1):
    glow_lines.append(curve_strand('gl', [(sd * 0.11, -0.085, 1.3), (sd * 0.125, -0.095, 1.15), (sd * 0.1, -0.085, 1.0), (sd * 0.12, -0.1, 0.88)], 0.004, 0.004, bulge=0))
    up = Vector((0, 0, 1))
    glow_lines.append(curve_strand('gla', [SH[sd] + arm_dir(sd) * 0.06 + up * 0.044, SH[sd] + arm_dir(sd) * 0.26 + up * 0.04, SH[sd] + arm_dir(sd) * 0.47 + up * 0.033], 0.004, 0.004, bulge=0))
for g in glow_lines:
    set_material(g, M['Accent'])
c_collar = ring_curve('ccollar', (0, 0, 1.4), 0.07, 0.012, M['Accent'])
c_belt = ring_curve('cbelt', (0, 0, 0.95), 1.0, 0.014, M['Accent'], rot=Matrix.Diagonal((0.137, 0.106, 1)))
top_cyber = join([suit, gloves, plate, abs_plate, *pads, *glow_lines, c_collar, c_belt], 'Top_cyber')

# Pantaloni / shorts / gonna
V, E, R = body_skeleton(1.08, 0.01, parts=('legs', 'waist'), torso_low=0.87)
pants = skin_mesh('pants', V, E, R, M['Bottom'])
belt = ring_curve('belt', (0, 0, 0.965), 1.0, 0.016, M['Dark'], rot=Matrix.Diagonal((0.132, 0.106, 1)))
buckle = box('buckle', (0.04, 0.012, 0.028), (0, -0.112, 0.965), M['Accent'], subdiv=0)
loops = []
for k in range(8):
    a = k / 8 * 2 * PI + PI / 8
    loops.append(box('loop', (0.012, 0.008, 0.032), (math.cos(a) * 0.134, math.sin(a) * 0.108, 0.965), M['Bottom'], subdiv=0))
p_hems = [ring_curve('phem', ANKLE[s] + Vector((0, 0, 0.03)), 0.05, 0.009, M['Bottom']) for s in (1, -1)]

# Cargo: larghi, tasche laterali, polsini alle caviglie
# ricavati dai pantaloni normali gonfiati lungo le normali (più larghi, senza artefatti)
cargo = pants.copy()
cargo.data = pants.data.copy()
link(cargo)
bm = bmesh.new()
bm.from_mesh(cargo.data)
bm.normal_update()
for vtx in bm.verts:
    k = 0.016 if vtx.co.z < 0.9 else 0.006
    vtx.co += vtx.normal * k
bm.to_mesh(cargo.data)
bm.free()
c_pockets = []
for sd in (1, -1):
    pos = HIP[sd].lerp(ANKLE[sd], 0.3) + Vector((sd * 0.083, 0, 0))
    c_pockets.append(rounded_box('cpocket', (0.03, 0.1, 0.11), pos, M['Bottom']))
    c_pockets.append(box('cflap', (0.034, 0.104, 0.02), pos + Vector((0, 0, 0.055)), M['Dark'], subdiv=0))
    c_pockets.append(ring_curve('ccuff', ANKLE[sd] + Vector((0, 0, 0.03)), 0.05, 0.013, M['Dark']))
belt3 = ring_curve('belt', (0, 0, 0.965), 1.0, 0.016, M['Dark'], rot=Matrix.Diagonal((0.14, 0.112, 1)))
buckle3 = box('buckle', (0.04, 0.012, 0.028), (0, -0.118, 0.965), M['Gold'], subdiv=0)
bottom_cargo = join([cargo, *c_pockets, belt3, buckle3], 'Bottom_cargo')
bottom_pants = join([pants, belt, buckle, *loops, *p_hems], 'Bottom_pants')

V, E, R = body_skeleton(1.12, 0.012, parts=('legs', 'waist'), torso_low=0.87, leg_end=0.26)
shorts = skin_mesh('shorts', V, E, R, M['Bottom'])
belt2 = ring_curve('belt', (0, 0, 0.965), 1.0, 0.016, M['Dark'], rot=Matrix.Diagonal((0.132, 0.106, 1)))
buckle2 = box('buckle', (0.04, 0.012, 0.028), (0, -0.112, 0.965), M['Accent'], subdiv=0)
s_hems = [ring_curve('shem', HIP[s].lerp(ANKLE[s], 0.26), 0.08, 0.01, M['Bottom']) for s in (1, -1)]
s_stripes = []
for sd in (1, -1):
    st = curve_strand('sstripe', [HIP[sd] + Vector((sd * 0.085, 0, 0.08)), HIP[sd].lerp(ANKLE[sd], 0.13) + Vector((sd * 0.088, 0, 0)), HIP[sd].lerp(ANKLE[sd], 0.25) + Vector((sd * 0.086, 0, 0))], 0.005, 0.005, bulge=0)
    set_material(st, M['Accent'])
    s_stripes.append(st)
bottom_shorts = join([shorts, belt2, buckle2, *s_hems], 'Bottom_shorts')
for st in s_stripes:
    bpy.data.objects.remove(st)

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
V, E, R = body_skeleton(1.04, 0.004, parts=('legs', 'waist'), torso_low=0.87, leg_end=0.09)
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


def back_layer(n=11, length=0.12, spread=2.3):
    out = []
    for i in range(n):
        t = i / (n - 1) - 0.5
        ph = PI + t * spread
        pts = [S(0.28 * PI, ph, 1.06), S(0.48 * PI, ph, 1.13), S((0.6 + length) * PI, ph * 1.0, 1.12 - length * 0.2)]
        out.append(curve_strand('back', pts, 0.042, 0.006, bulge=0.25))
    return out


def bangs2(n=6):
    out = []
    for i in range(n):
        t = i / (n - 1) - 0.5
        a = t * 1.1 + 0.08
        pts = [S(0.12 * PI, a * 0.5, 1.04), S(0.27 * PI, a, 1.16), S(0.41 * PI, a * 1.05, 1.14)]
        out.append(curve_strand('bang2', pts, 0.03, 0.003, bulge=0.25))
    return out


def tufts():
    out = []
    for i in range(5):
        a = i / 5 * 2 * PI
        p0 = S(0.06 * PI, a, 1.05)
        tip = (p0 - HEAD_C).normalized()
        out.append(curve_strand('tuft', [p0, p0 + tip * 0.035 + Vector((0, 0.02, 0.0)), p0 + tip * 0.06 + Vector((0, 0.05, -0.02))], 0.022, 0.002, bulge=0.1))
    return out


def ahoge():
    p0 = S(0.05 * PI, 0, 1.06)
    return curve_strand('ahoge', [p0, p0 + Vector((0.01, 0.01, 0.06)), p0 + Vector((0.03, -0.03, 0.08))], 0.012, 0.001, bulge=0)


hair = {}
hair['short'] = [hair_cap(0.66), *bangs(), *bangs2(), *side_locks(0.05), *back_layer(11, 0.06), *tufts(), ahoge()]

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
hair['spiky'] = [hair_cap(0.62), *bangs(6, 1.5, 0.44), *bangs2(5), *side_locks(0.02), *spikes, *back_layer(9, 0.03)]

bob_strands = []
for i in range(13):
    ph = -PI + (i / 12) * 2 * PI
    if abs(ph) < 1.0:
        continue
    pts = [S(0.45 * PI, ph, 1.08), S(0.62 * PI, ph, 1.16), S(0.74 * PI, ph, 1.14)]
    bob_strands.append(curve_strand('bob', pts, 0.05, 0.012, bulge=0.2))
hair['bob'] = [hair_cap(0.78), *bangs(9, 1.6, 0.47), *bangs2(), *side_locks(0.18), *bob_strands, *back_layer(13, 0.14, 2.6), *tufts()]

long_strands = []
for i in range(11):
    t = i / 10 - 0.5
    ph = PI + t * 1.8
    top = S(0.55 * PI, ph, 1.08)
    pts = [top, top + Vector((0, 0.04, -0.12)), top + Vector((t * 0.05, 0.05, -0.3)), top + Vector((t * 0.08, 0.02, -0.46 + abs(t) * 0.08))]
    long_strands.append(curve_strand('long', pts, 0.045, 0.006, bulge=0.3))
hair['long'] = [hair_cap(0.74), *bangs(), *bangs2(), *side_locks(0.35), ahoge(), *long_strands, *back_layer(11, 0.12), *tufts()]

tie_p = S(0.55 * PI, PI, 1.07)
pony = curve_strand('pony', [tie_p, tie_p + Vector((0, 0.07, 0.02)), tie_p + Vector((0, 0.11, -0.12)), tie_p + Vector((0, 0.08, -0.32)), tie_p + Vector((0, 0.05, -0.42))], 0.055, 0.006, bulge=0.4)
pony_tie = ring_curve('tie', tie_p + Vector((0, 0.025, 0)), 0.03, 0.012, M['Accent'], rot=Matrix.Rotation(PI / 2 - 0.5, 3, 'X'))
hair['ponytail'] = [hair_cap(0.62), *bangs(), *bangs2(), *side_locks(0.08), pony, pony_tie, *tufts()]

twins = []
for s in (1, -1):
    p = S(0.42 * PI, s * 2.0, 1.05)
    twins.append(curve_strand('twin', [p, p + Vector((0.06 * s, 0.02, 0.02)), p + Vector((0.1 * s, 0.05, -0.12)), p + Vector((0.08 * s, 0.04, -0.32)), p + Vector((0.06 * s, 0.02, -0.45))], 0.05, 0.006, bulge=0.4))
    twins.append(ring_curve('tie', p + Vector((0.015 * s, 0, 0)), 0.026, 0.011, M['Accent'], rot=Matrix.Rotation(PI / 2, 3, 'Y')))
hair['twintails'] = [hair_cap(0.66), *bangs(), *bangs2(), *side_locks(0.12), *twins, *back_layer(9, 0.05), *tufts()]

buns = []
for sd in (1, -1):
    c = S(0.2 * PI, sd * 2.1, 1.12)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=0.058)
    bmesh.ops.translate(bm, vec=c, verts=bm.verts)
    buns.append(mesh_object('bun', bm, M['Hair']))
    for k in range(3):
        rot = Matrix.Rotation(0.6 * k, 3, 'Z') @ Matrix.Rotation(0.9, 3, 'X')
        buns.append(ring_curve('wrap', c, 0.054, 0.012, M['Hair'], rot=rot))
    buns.append(ring_curve('btie', c + (HEAD_C - c).normalized() * 0.045, 0.035, 0.01, M['Accent'],
                           rot=(HEAD_C - c).normalized().to_track_quat('Z', 'Y').to_matrix()))
hair['buns'] = [hair_cap(0.66), *bangs(), *bangs2(), *side_locks(0.1), *back_layer(11, 0.05), *buns]

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
wings = []
for sd in (1, -1):
    base = Vector((sd * 0.07, 0.115, 1.25))
    for k in range(5):
        ang = 0.45 + k * 0.28
        L = 0.48 - k * 0.06
        d = Vector((sd * math.cos(ang - 0.6), 0.5, math.sin(ang - 0.6) * 1.3)).normalized()
        tip = base + d * L
        mid = base + d * L * 0.5 + Vector((0, 0.05, 0.05))
        f = curve_strand('feather', [base, mid, tip], 0.03, 0.004, bulge=0.35)
        set_material(f, M['White'])
        wings.append(f)
    edge = curve_strand('wglow', [base + Vector((0, 0.01, 0.02)), base + Vector((sd * 0.22, 0.12, 0.2)), base + Vector((sd * 0.38, 0.22, 0.12))], 0.008, 0.003, bulge=0)
    set_material(edge, M['Accent'])
    wings.append(edge)
acc['wings'] = wings
visor = latlong('visor', 1.13, M['Visor'], rings=4, segs=24, th0=0.47 * PI, th1=0.6 * PI, ph0=-1.35, ph1=1.35, closed=False)
so = visor.modifiers.new('so', 'SOLIDIFY')
so.thickness = 0.006
apply_modifiers(visor)
acc['visor'] = [visor, ring_curve('vband', HEAD_C + Vector((0, 0.01, -0.01)), 1.0, 0.009, M['Dark'], rot=Matrix.Diagonal((HEAD_R * 1.13, HEAD_R * 1.1, 1)), arc=1.4 * PI, start=0.3 * PI)]
crown = [ring_curve('crown', HEAD_C + Vector((0, 0.01, 0.15)), 0.085, 0.012, M['Gold'])]
for k in range(6):
    a = k / 6 * 2 * PI
    p = HEAD_C + Vector((math.cos(a) * 0.085, 0.01 + math.sin(a) * 0.085, 0.15))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.022, radius2=0.0, depth=0.06)
    bmesh.ops.translate(bm, vec=p + Vector((0, 0, 0.03)), verts=bm.verts)
    crown.append(mesh_object('spike', bm, M['Gold'], smooth=False))
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.009)
    bmesh.ops.translate(bm, vec=p + Vector((0, 0, 0.068)), verts=bm.verts)
    crown.append(mesh_object('gem', bm, M['Accent'], smooth=False))
acc['crown'] = crown
pack = [rounded_box('pack', (0.24, 0.11, 0.28), Vector((0, 0.165, 1.16)), M['Dark']),
        rounded_box('packpocket', (0.18, 0.04, 0.1), Vector((0, 0.225, 1.08)), M['Dark']),
        box('packstripe', (0.245, 0.02, 0.016), (0, 0.215, 1.2), M['Accent'], subdiv=0)]
for sd in (1, -1):
    st = curve_strand('strap', [(sd * 0.09, 0.12, 1.27), (sd * 0.1, 0.0, 1.36), (sd * 0.1, -0.11, 1.28), (sd * 0.095, -0.115, 1.12), (sd * 0.09, 0.05, 1.04)], 0.011, 0.011, bulge=0)
    set_material(st, M['Dark'])
    pack.append(st)
acc['backpack'] = pack
acc_objs = {k: join(v, f'Acc_{k}') for k, v in acc.items()}

# ------------------------------------------------------------------ skinning
skinned_auto = [body, top_hoodie, top_tshirt, top_jacket, top_cyber, bottom_pants, bottom_shorts, bottom_cargo]


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
# il corpo riceve i pesi automatici (bone heat)...
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
set_deform(SOFT_BONES, True)


def fix_unweighted(obj):
    """Il calcolo automatico (bone heat) a volte lascia vertici senza pesi (dita
    sottili, piccoli dettagli): li assegniamo all'osso deformante più vicino."""
    bones = [b for b in arm_data.bones if b.use_deform and b.name not in SOFT_BONES]
    names = {g.index: g.name for g in obj.vertex_groups}
    fixed = 0
    for v in obj.data.vertices:
        total = sum(g.weight for g in v.groups if names.get(g.group) in arm_data.bones)
        if total > 1e-4:
            continue
        best, bd = None, 1e9
        for b in bones:
            a, c = b.head_local, b.tail_local
            ab = c - a
            t = max(0.0, min(1.0, (v.co - a).dot(ab) / ab.length_squared))
            d = (a + ab * t - v.co).length
            if d < bd:
                best, bd = b.name, d
        g = obj.vertex_groups.get(best) or obj.vertex_groups.new(name=best)
        g.add([v.index], 1.0, 'REPLACE')
        fixed += 1
    if fixed:
        print(f'  pesi corretti: {obj.name} {fixed} vertici')


fix_unweighted(body)


def transfer_weights(obj):
    """...e i vestiti copiano i pesi dalla superficie del corpo più vicina."""
    for g in body.vertex_groups:
        if not obj.vertex_groups.get(g.name):
            obj.vertex_groups.new(name=g.name)
    mod = obj.modifiers.new('dt', 'DATA_TRANSFER')
    mod.object = body
    mod.use_vert_data = True
    mod.data_types_verts = {'VGROUP_WEIGHTS'}
    mod.vert_mapping = 'POLYINTERP_NEAREST'
    mod.layers_vgroup_select_src = 'ALL'
    mod.layers_vgroup_select_dst = 'NAME'
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier='dt')
    add_armature_mod(obj)
    fix_unweighted(obj)


for obj in skinned_auto[1:]:
    transfer_weights(obj)

head_only = lambda co: {'head': 1.0}  # noqa: E731
for obj in [head, face, *[o for k, o in hair_objs.items() if k in ('short', 'spiky', 'bob', 'buns')], acc_objs['halo'], acc_objs['headphones'],
            acc_objs['glasses'], acc_objs['horns'], acc_objs['visor'], acc_objs['crown']]:
    rigid(obj, head_only)
for obj in (acc_objs['wings'], acc_objs['backpack']):
    rigid(obj, lambda co: {'chest': 1.0})


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
    k = smoothstep(0.1, 0.17, co.z)  # gambale degli stivali segue lo stinco
    return {f'foot_{s}': 1 - k, f'shin_{s}': k}


rigid(shoes_sneakers, shoe_w)
rigid(shoes_boots, shoe_w)


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


def p_ride_stand(t):
    """In piedi su hoverboard o monopattino: ginocchia piegate, equilibrio."""
    P = BASE()
    sway = math.sin(t * 2 * PI)
    P['hips_loc'] = Vector((sway * 0.01, 0, -0.08))
    P['hips'] = Rz(0.25)
    P['spine'] = Rx(0.12) @ Rz(-0.2)
    P['head'] = Rz(-0.05)
    for side, n in ((1, 'L'), (-1, 'R')):
        P[f'thigh_{n}'] = leg_pose(side, -0.35, 0.12)
        P[f'shin_{n}'] = Rx(0.6)
        P[f'foot_{n}'] = Rx(-0.25)
        P[f'upper_arm_{n}'] = arm_pose(side, 32 + sway * 4 * side, -0.2)
        P[f'forearm_{n}'] = elbow_pose(side, 0.5)
    return P


def p_ride_sit(t):
    """Seduto sul kart con le mani sul volante."""
    P = BASE()
    b = math.sin(t * 2 * PI * 2) * 0.004
    P['hips_loc'] = Vector((0, 0.05, -0.48 + b))
    for side, n in ((1, 'L'), (-1, 'R')):
        P[f'thigh_{n}'] = leg_pose(side, -1.35, 0.1)
        P[f'shin_{n}'] = Rx(0.9)
        P[f'upper_arm_{n}'] = arm_pose(side, 16, -0.95)
        P[f'forearm_{n}'] = elbow_pose(side, 0.7)
    P['spine'] = Rx(-0.12)
    return P


ACTIONS = [
    ('idle', 120, p_idle), ('walk', 24, lambda t: locomotion(t, False)), ('run', 18, lambda t: locomotion(t, True)),
    ('jump', 20, p_jump), ('wave', 60, p_wave), ('cheer', 40, p_cheer), ('dance', 64, p_dance),
    ('sit', 120, p_sit), ('floor', 120, p_floor), ('ride_stand', 60, p_ride_stand), ('ride_sit', 60, p_ride_sit),
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
    show = set(os.environ.get('PREVIEW_SHOW', 'Body,Head,Face,Shoes_sneakers,Hair_twintails,Top_jacket,Bottom_skirt,Acc_catears').split(','))
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
