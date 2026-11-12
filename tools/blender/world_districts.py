"""
Quartieri del mondo grande di Oasis (usato da hub.py).

Tutte le posizioni sono in coordinate di gioco (x, z) con Y in alto:
  nord = -Z (Quartiere Neon), sud = +Z (Foresta), est = +X.
"""
import base64
import math
import random

import bpy  # noqa: I001
import bmesh
from mathutils import Matrix, Vector, noise

PI = math.pi

WORLD_R = 300.0
BOUNDS = 292.0
PLAZA_FLAT = 52.0
LAKE = (108.0, 62.0)
LAKE_R = 40.0
WATER_Y = -0.6
HILL = (-110.0, -63.0)
HILL_H = 24.0
HILL_S = 24.0
CITY = (-62.0, 62.0, -182.0, -88.0)  # xmin, xmax, zmin, zmax
CITY_Y = 0.3
STAGE = (95.0, -60.0)
MEADOW = (-105.0, 60.0)
FOREST = (0.0, 125.0)
CLEARING = (0.0, 128.0)
MEDIEVAL = (-160.0, -150.0)
CASTLE = (-200.0, -192.0)
CHINA = (225.0, -40.0)
POND = (238.0, -18.0)
SNOW = (-175.0, 175.0)
ICE = (-150.0, 200.0)
PEAKS = [(-210.0, 205.0, 40.0, 30.0), (-130.0, 240.0, 30.0, 26.0), (-250.0, 135.0, 32.0, 26.0), (-95.0, 262.0, 22.0, 22.0)]

ROADS = [
    [(0, -50), (0, -88)],                                  # verso il Quartiere Neon
    [(0, 50), (5, 72), (-4, 92), (2, 110), (0, 116)],      # sentiero della foresta
    [(43, 25), (70, 40)],                                  # lago
    [(-43, -25), (-72, -42), (-92, -53)],                  # collina
    [(43, -25), (78, -48)],                                # palco
    [(-43, 25), (-88, 50)],                                # prato
    [(-92, -53), (-128, -112), (-150, -138)],               # borgo medievale
    [(78, -48), (140, -46), (192, -40)],                   # città d'oriente
    [(-88, 50), (-128, 108), (-160, 152)],                 # valle innevata
]

ZONES = [
    {'name': 'Piazza Centrale', 'x': 0, 'z': 0, 'r': 56},
    {'name': 'Quartiere Neon', 'x': 0, 'z': -135, 'r': 72},
    {'name': 'Foresta Sussurrante', 'x': 0, 'z': 125, 'r': 70},
    {'name': 'Lago Cristallo', 'x': LAKE[0], 'z': LAKE[1], 'r': 62},
    {'name': 'Collina del Vento', 'x': HILL[0], 'z': HILL[1], 'r': 58},
    {'name': 'Palco delle Stelle', 'x': STAGE[0], 'z': STAGE[1], 'r': 34},
    {'name': "Prato dell'Albero Antico", 'x': MEADOW[0], 'z': MEADOW[1], 'r': 42},
    {'name': 'Borgo Medievale', 'x': -170, 'z': -165, 'r': 70, 'theme': 'medieval'},
    {'name': "Città d'Oriente", 'x': CHINA[0], 'z': CHINA[1], 'r': 62, 'theme': 'east'},
    {'name': 'Valle Innevata', 'x': SNOW[0], 'z': SNOW[1], 'r': 85, 'theme': 'snow'},
]


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def seg_dist(px, pz, a, b):
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - (ax + dx * t), pz - (az + dz * t))


def road_dist(x, z):
    return min(seg_dist(x, z, r[i], r[i + 1]) for r in ROADS for i in range(len(r) - 1))


def city_mask(x, z, margin=10.0):
    x0, x1, z0, z1 = CITY
    dx = max(x0 - x, 0, x - x1)
    dz = max(z0 - z, 0, z - z1)
    return smooth(margin, 0.0, math.hypot(dx, dz))


def H(x, z):
    """Altezza del terreno in coordinate di gioco."""
    r = math.hypot(x, z)
    rolling = noise.noise(Vector((x * 0.017, z * 0.017, 0.3))) * 2.4 + noise.noise(Vector((x * 0.06, z * 0.06, 1.7))) * 0.5 + 1.1
    h = max(rolling, 0.15) * smooth(PLAZA_FLAT, 86, r)  # dolci colline, mai sotto il livello dell'acqua
    # collina con cima spianata per il tempio
    dh = math.hypot(x - HILL[0], z - HILL[1])
    t = HILL_H * math.exp(-dh * dh / (2 * HILL_S * HILL_S))
    cap = HILL_H * 0.88
    if t > cap:
        t = cap + (t - cap) * 0.12
    h += t
    # città, palco, radura e prato: terreno spianato
    h = lerp(h, CITY_Y, city_mask(x, z))
    h = lerp(h, 0.3, smooth(32, 20, math.hypot(x - STAGE[0], z - STAGE[1])))
    h = lerp(h, 0.6, smooth(22, 12, math.hypot(x - CLEARING[0], z - CLEARING[1])))
    h = lerp(h, h * 0.35, smooth(26, 10, math.hypot(x - MEADOW[0], z - MEADOW[1])))
    # borgo medievale: villaggio pianeggiante e castello su un colle
    h = lerp(h, 0.8, smooth(40, 26, math.hypot(x - MEDIEVAL[0], z - MEDIEVAL[1])))
    dc = math.hypot(x - CASTLE[0], z - CASTLE[1])
    h = max(h, 7.0 * math.exp(-dc * dc / (2 * 26 * 26)) + 0.8 * smooth(60, 30, dc))
    h = lerp(h, 6.4, smooth(24, 20, dc))  # spianata del castello
    # città d'oriente con laghetto
    h = lerp(h, 0.5, smooth(52, 40, math.hypot(x - CHINA[0], z - CHINA[1])))
    dp = math.hypot(x - POND[0], z - POND[1])
    h = lerp(h, -1.6, smooth(13, 9, dp))
    # valle innevata: montagne alle spalle, villaggio e laghetto ghiacciato in piano
    for px, pz, ph, ps in PEAKS:
        d = math.hypot(x - px, z - pz)
        h += ph * math.exp(-d * d / (2 * ps * ps)) * (0.8 + 0.2 * noise.noise(Vector((x * 0.05, z * 0.05, 7.0))))
    h = lerp(h, 1.5, smooth(30, 20, math.hypot(x - SNOW[0], z - SNOW[1])))
    h = lerp(h, 1.2, smooth(18, 14, math.hypot(x - ICE[0], z - ICE[1])))
    # lago con spiaggia
    dl = math.hypot(x - LAKE[0], z - LAKE[1])
    if dl < LAKE_R:
        target = lerp(-3.2, -0.85, (dl / LAKE_R) ** 2)
    else:
        target = lerp(-0.85, 0.3, smooth(LAKE_R, LAKE_R + 14, dl))
    h = lerp(h, target, smooth(LAKE_R + 24, LAKE_R + 12, dl))
    # piazza centrale piatta
    h = lerp(h, 0.0, smooth(PLAZA_FLAT + 6, PLAZA_FLAT, r))
    if r < 47:
        h = -0.03
    return h


def slope(x, z):
    e = 1.0
    return math.hypot(H(x + e, z) - H(x - e, z), H(x, z + e) - H(x, z - e)) / (2 * e)


def srgb(c):
    return tuple(max(0.0, x) ** 2.2 for x in c)


def terrain_color(x, z):
    """Colore (lineare) e quantità d'erba del terreno."""
    r = math.hypot(x, z)
    n = noise.noise(Vector((x * 0.08, z * 0.08, 4.0)))
    n2 = noise.noise(Vector((x * 0.02, z * 0.02, 9.0)))
    grass = Vector(lerp(Vector((0.36, 0.6, 0.3)), Vector((0.5, 0.7, 0.33)), 0.5 + 0.5 * n))
    df = math.hypot(x - FOREST[0], z - FOREST[1])
    grass = grass.lerp(Vector((0.26, 0.45, 0.25)), smooth(75, 45, df) * 0.8)
    grass = grass.lerp(Vector((0.62, 0.72, 0.32)), smooth(30, 12, math.hypot(x - MEADOW[0], z - MEADOW[1])) * 0.6)
    grass = grass.lerp(grass * 0.82, 0.5 + 0.5 * n2)
    col = grass
    g = 1.0
    h = H(x, z)
    s = slope(x, z)
    rock = smooth(0.45, 0.7, s)
    col = col.lerp(Vector((0.58, 0.52, 0.6)), rock)
    g *= 1 - rock
    dl = math.hypot(x - LAKE[0], z - LAKE[1])
    sand = smooth(LAKE_R + 13, LAKE_R + 7, dl)
    col = col.lerp(Vector((0.95, 0.86, 0.66)), sand)
    col = col.lerp(Vector((0.7, 0.62, 0.48)), smooth(-0.4, -0.9, h) * smooth(LAKE_R + 30, LAKE_R, dl))
    col = col.lerp(Vector((0.42, 0.52, 0.5)), smooth(-1.2, -2.5, h))
    g *= 1 - sand
    rd = road_dist(x, z)
    path = smooth(3.4, 2.2, rd) * (1 - city_mask(x, z, 2))
    col = col.lerp(Vector((0.84, 0.76, 0.64)) * (0.92 + 0.08 * n), path)
    g *= 1 - smooth(4.0, 2.4, rd)
    cm = city_mask(x, z, 3)
    col = col.lerp(Vector((0.22, 0.2, 0.28)), cm)
    g *= 1 - cm
    st = smooth(24, 20, math.hypot(x - STAGE[0], z - STAGE[1]))
    col = col.lerp(Vector((0.6, 0.55, 0.66)), st)
    g *= 1 - st
    cl = smooth(9, 6, math.hypot(x - CLEARING[0], z - CLEARING[1]))
    col = col.lerp(Vector((0.55, 0.45, 0.36)), cl)
    g *= 1 - cl
    # neve: valle e cime
    sn = max(smooth(95, 60, math.hypot(x - SNOW[0], z - SNOW[1])), smooth(14, 22, h) * smooth(140, 90, math.hypot(x - SNOW[0], z - SNOW[1])))
    col = col.lerp(Vector((0.95, 0.97, 1.0)) * (0.94 + 0.06 * n), sn)
    g *= 1 - sn
    # lastricati del borgo e della città d'oriente
    mv = smooth(18, 12, math.hypot(x - MEDIEVAL[0], z - MEDIEVAL[1]))
    col = col.lerp(Vector((0.62, 0.56, 0.5)) * (0.9 + 0.1 * n), mv)
    g *= 1 - mv
    ce = smooth(36, 30, math.hypot(x - CHINA[0], z - CHINA[1]))
    col = col.lerp(Vector((0.78, 0.74, 0.7)) * (0.92 + 0.08 * n), ce)
    g *= 1 - ce
    cs = smooth(22, 18, math.hypot(x - CASTLE[0], z - CASTLE[1]))
    col = col.lerp(Vector((0.55, 0.52, 0.5)), cs)
    g *= 1 - cs
    if r < 47.5:
        g = 0.0
        col = Vector((0.13, 0.13, 0.17))
    if h < -0.55:
        g = 0.0
    return srgb(col), max(0.0, min(1.0, g))


class World:
    """Costruisce i quartieri usando le primitive e i materiali di hub.py."""

    def __init__(self, ctx):
        self.c = ctx  # dizionario con funzioni e materiali di hub.py
        self.M = ctx['MAT']
        self.L = ctx['LAYOUT']
        self.rng = random.Random(1234)
        self.instances = {}
        self.L.setdefault('boxColliders', [])
        self.L.setdefault('boxPlatforms', [])
        self.L.setdefault('destinations', [])
        self.L['zones'] = ZONES
        self.L['roads'] = ROADS
        self.L['lake'] = {'x': LAKE[0], 'z': LAKE[1], 'r': LAKE_R, 'y': WATER_Y}
        self.L['city'] = CITY

    # ---------------------------------------------------------------- utilità
    def box_collider(self, x, z, hw, hd, rot=0.0):
        self.L['boxColliders'].append([round(x, 3), round(z, 3), round(hw, 3), round(hd, 3), round(rot, 4)])

    def box_platform(self, x, z, hw, hd, rot, top):
        self.L['boxPlatforms'].append([round(x, 3), round(z, 3), round(hw, 3), round(hd, 3), round(rot, 4), round(top, 3)])

    def seat(self, gx, gy, gz, facing, label='Siediti'):
        L = self.L
        L['seats'].append({'position': [round(gx, 3), round(gy, 3), round(gz, 3)], 'facing': round(facing, 4)})
        fx, fz = math.sin(facing), math.cos(facing)
        L['interactables'].append({'type': 'sit', 'seat': len(L['seats']) - 1, 'point': [round(gx + fx * 0.8, 3), round(gy, 3), round(gz + fz * 0.8, 3)],
                                   'radius': 1.1, 'label': label})

    def local(self, gx, gz, facing, lx, lz):
        """Punto locale (lx a destra, lz in avanti) -> coordinate di gioco."""
        rx, rz = math.cos(facing), -math.sin(facing)
        fx, fz = math.sin(facing), math.cos(facing)
        return gx + rx * lx + fx * lz, gz + rz * lx + fz * lz

    def add_instance(self, kind, x, z, rot=None, scale=1.0, y=None):
        y = H(x, z) if y is None else y
        rot = self.rng.random() * 2 * PI if rot is None else rot
        self.instances.setdefault(kind, []).append([round(x, 2), round(y, 2), round(z, 2), round(rot, 3), round(scale, 3)])

    def free(self, x, z, avoid_roads=4.0):
        """Il punto è libero da strade, città, lago, piazza e quartieri speciali?"""
        r = math.hypot(x, z)
        if r < PLAZA_FLAT + 4 or r > BOUNDS - 2:
            return False
        if road_dist(x, z) < avoid_roads or city_mask(x, z, 8) > 0.01:
            return False
        if math.hypot(x - LAKE[0], z - LAKE[1]) < LAKE_R + 14:
            return False
        if math.hypot(x - STAGE[0], z - STAGE[1]) < 30 or math.hypot(x - CLEARING[0], z - CLEARING[1]) < 18:
            return False
        if math.hypot(x - HILL[0], z - HILL[1]) < 15 or math.hypot(x - MEADOW[0], z - MEADOW[1]) < 12:
            return False
        if math.hypot(x - MEDIEVAL[0], z - MEDIEVAL[1]) < 42 or math.hypot(x - CASTLE[0], z - CASTLE[1]) < 30:
            return False
        if math.hypot(x - CHINA[0], z - CHINA[1]) < 52 or math.hypot(x - SNOW[0], z - SNOW[1]) < 100:
            return False
        return True

    # ---------------------------------------------------------------- terreno
    def build_terrain(self):
        c = self.c
        step = 2.5
        N = 261
        half = (N - 1) * step / 2
        bm = bmesh.new()
        verts = {}
        cols = []
        heights = []
        mask = []
        for j in range(N):
            for i in range(N):
                x = -half + i * step
                z = -half + j * step
                h = H(x, z)
                col, g = terrain_color(x, z)
                heights.append(max(-32000, min(32000, int(round(h * 100)))))
                mask.append(int(g * 255))
                if math.hypot(x, z) <= WORLD_R + 6:
                    verts[(i, j)] = bm.verts.new(c['G'](x, h, z))
                    cols.append(col)
        for j in range(N - 1):
            for i in range(N - 1):
                q = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                if all(k in verts for k in q):
                    bm.faces.new([verts[k] for k in q])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
        terrain = c['mesh_object']('Terrain', bm, self.M['Terrain'], smooth=True)
        col = terrain.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
        for k, cc in enumerate(cols):
            col.data[k].color = (*cc, 1)
        c['static'](terrain)
        self.L['terrain'] = {
            'n': N, 'step': step, 'origin': -half,
            'heights': base64.b64encode(bytes(memoryview(__import__('array').array('h', heights)))).decode(),
            'grass': base64.b64encode(bytes(mask)).decode(),
        }
        self.build_cliff_skirt()

    def build_cliff_skirt(self):
        c = self.c
        segs = 180
        rings = [(WORLD_R + 1.0, None), (WORLD_R + 3, -3), (WORLD_R - 6, -10), (WORLD_R - 25, -20), (WORLD_R - 60, -32), (WORLD_R - 110, -44), (30, -56), (2, -62)]
        bm = bmesh.new()
        grid = []
        for k, (rr, dz) in enumerate(rings):
            row = []
            for j in range(segs):
                a = 2 * PI * j / segs
                x, z = math.sin(a) * rr, math.cos(a) * rr
                if dz is None:
                    y = H(math.sin(a) * (WORLD_R - 1), math.cos(a) * (WORLD_R - 1)) - 0.5
                else:
                    y = dz + noise.noise(Vector((x * 0.05, z * 0.05, k))) * 3
                    x += noise.noise(Vector((x * 0.04, z * 0.04, k + 5))) * 6
                    z += noise.noise(Vector((x * 0.04, z * 0.04, k + 9))) * 6
                row.append(bm.verts.new(c['G'](x, y, z)))
            grid.append(row)
        for k in range(len(rings) - 1):
            for j in range(segs):
                j2 = (j + 1) % segs
                bm.faces.new([grid[k][j], grid[k][j2], grid[k + 1][j2], grid[k + 1][j]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        cliff = c['mesh_object']('Cliff', bm, self.M['Rock'], smooth=False)
        col = cliff.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
        for i, v in enumerate(cliff.data.vertices):
            band = 0.5 + 0.5 * math.sin(v.co.z * 0.5 + noise.noise(v.co * 0.05) * 2)
            t = 0.75 + band * 0.3
            col.data[i].color = (t, t * 0.93, t * 1.05, 1)

    # ---------------------------------------------------------------- teletrasporti
    def pad(self, name, gx, gz, y=None, facing=0.0):
        c = self.c
        y = H(gx, gz) if y is None else y
        parts = [
            c['cylinder']('padbase', 1.8, 1.9, 0.25, self.M['StoneDark'], segs=32),
            c['cylinder']('padtop', 1.55, 1.6, 0.06, self.M['GlowCyan'], segs=32, center=(0, 0, 0.25), smooth=False),
            c['cylinder']('padinner', 1.2, 1.2, 0.08, self.M['StoneDark'], segs=32, center=(0, 0, 0.26)),
        ]
        for k in range(6):
            a = k / 6 * 2 * PI
            parts.append(c['box']('rune', (0.18, 0.5, 0.04), (math.cos(a) * 0.85, math.sin(a) * 0.85, 0.33), self.M['GlowPink']))
        obj = c['static'](c['join'](parts, f'Pad_{name}'))
        c['place'](obj, gx, y, gz, facing)
        self.c['platform'](gx, gz, 1.9, y + 0.3)
        self.L['interactables'].append({'type': 'teleport', 'point': [round(gx, 2), round(y, 2), round(gz, 2)], 'radius': 2.0, 'label': 'Teletrasporto'})
        fx, fz = math.sin(facing), math.cos(facing)
        self.L['destinations'].append({'name': name, 'pos': [round(gx + fx * 3, 2), round(H(gx + fx * 3, gz + fz * 3) if name != 'Piazza Centrale' else 0, 2), round(gz + fz * 3, 2)],
                                       'facing': round(facing, 3)})

    # ---------------------------------------------------------------- Quartiere Neon
    def build_city(self):
        c, M = self.c, self.M
        G, box = c['G'], c['box']
        rng = random.Random(88)
        xs = [-45.0, -15.0, 15.0, 45.0]
        zs = [-105.0, -135.0, -165.0]
        slab_top = CITY_Y + 0.15
        window_mats = [M['WinCyan'], M['WinPink'], M['WinAmber']]
        glow_mats = [M['GlowCyan'], M['GlowPink'], M['WinAmber']]
        signs = ['PIXEL CAFE', 'ARCADE 88', 'RAMEN NEON', 'SYNTH SHOP', 'HOTEL ORBITA', 'CYBER GYM', 'BAR LUNA', 'VR LOUNGE', 'MERCATO 24H', 'CINEMA STELLA']
        sign_i = 0
        slabs = []
        lamps = []
        for zi, bz in enumerate(zs):
            for xi, bx in enumerate(xs):
                square = zi == 1 and xi in (1, 2)
                if square and xi == 2:
                    continue
                if square:
                    sx, sz, cx = 52.0, 22.0, 0.0
                else:
                    sx, sz, cx = 22.0, 22.0, bx
                slab = box('slab', (sx, sz, 0.15), G(cx, CITY_Y + 0.075, bz), M['Sidewalk'], bevel=0.04, segs=1)
                slabs.append(slab)
                self.box_platform(cx, bz, sx / 2, sz / 2, 0.0, slab_top)
                for lx in (-1, 1):
                    for lz in (-1, 1):
                        lamps.append((cx + lx * (sx / 2 - 0.8), bz + lz * (sz / 2 - 0.8)))
                if square:
                    continue
                n_b = 1 if rng.random() < 0.45 else 2
                for k in range(n_b):
                    if n_b == 1:
                        fx, fz, fw, fd = bx, bz, 17.0, 17.0
                    else:
                        fx, fz, fw, fd = bx, bz + (-4.6 if k == 0 else 4.6), 17.0, 7.6
                    height = rng.uniform(12, 26) + (14 if zi == 2 else 0) + rng.uniform(0, 10) * (xi in (1, 2))
                    self.building(f'Building_{zi}{xi}{k}', fx, fz, fw, fd, height, slab_top, rng, window_mats, glow_mats)
                    self.box_collider(fx, fz, fw / 2, fd / 2, 0.0)
                    # insegna con testo (disegnata nel gioco)
                    if sign_i < len(signs) and rng.random() < 0.85:
                        side = -1 if fz > bz - 0.1 and n_b == 2 and k == 1 else 1
                        face_z = fz + side * (fd / 2 + 0.06) if n_b == 1 or True else fz
                        self.sign_board(f'Board_neon_{sign_i}', fx + rng.uniform(-4, 4), slab_top + 3.6, face_z if side > 0 else fz - fd / 2 - 0.06,
                                        0.0 if side > 0 else PI)
                        self.L.setdefault('signs', []).append(signs[sign_i])
                        sign_i += 1
        c['static'](c['join'](slabs, 'CitySidewalks'))
        # lampioni al neon
        parts = []
        for k, (lx, lz) in enumerate(lamps):
            p = G(lx, slab_top, lz)
            parts.append(c['cylinder']('lp', 0.07, 0.09, 4.6, M['Metal'], segs=8, center=p))
            parts.append(c['box']('arm', (0.9, 0.1, 0.1), p + Vector((0.4, 0, 4.55)), M['Metal']))
            parts.append(c['box']('head', (0.6, 0.25, 0.12), p + Vector((0.75, 0, 4.45)), M['GlowCyan'] if k % 2 else M['GlowPink']))
            c['collider'](lx, lz, 0.15)
        c['static'](c['join'](parts, 'CityLamps'))
        # piazza con schermo olografico
        self.holo_screen(0.0, -143.5, slab_top)
        for x in (-12, 12):
            c['add_bench'](x, -131.0, PI, f'CityBench_{x}')
        self.pad('Quartiere Neon', 0.0, -126.0, y=slab_top, facing=0.0)
        # sculture al neon
        for k, x in enumerate((-20, 20)):
            parts = [c['cylinder']('base', 1.2, 1.4, 0.6, M['StoneDark'], segs=6)]
            for j in range(4):
                parts.append(c['box']('ring', (0.18, 2.4 - j * 0.4, 0.18), (0, 0, 1.8 + j * 1.3), [M['GlowCyan'], M['GlowPink']][(j + k) % 2]))
            o = c['static'](c['join'](parts, f'NeonSculpture_{k}'))
            c['place'](o, x, slab_top, -137.0, k * 0.8)
            c['collider'](x, -137.0, 1.4)

    def building(self, name, gx, gz, w, d, height, base_y, rng, window_mats, glow_mats):
        c, M = self.c, self.M
        G, box = c['G'], c['box']
        parts = []
        parts.append(box('core', (w, d, height), G(gx, base_y + height / 2, gz), M['Building'], bevel=0.12, segs=1))
        # piano superiore rientrato
        if height > 20 and rng.random() < 0.7:
            h2 = rng.uniform(4, 9)
            parts.append(box('top', (w * 0.65, d * 0.65, h2), G(gx, base_y + height + h2 / 2, gz), M['Building'], bevel=0.1, segs=1))
            parts.append(box('rim2', (w * 0.65 + 0.2, d * 0.65 + 0.2, 0.18), G(gx, base_y + height + h2, gz), rng.choice(glow_mats)))
        glow = rng.choice(glow_mats)
        parts.append(box('rim', (w + 0.25, d + 0.25, 0.22), G(gx, base_y + height, gz), glow))
        wmat = rng.choice(window_mats)
        floors = int((height - 4) / 3.3)
        for f in range(floors):
            if rng.random() < 0.18:
                continue
            y = base_y + 4.2 + f * 3.3
            parts.append(box('wx', (w - 1.6, d + 0.12, 0.55), G(gx, y, gz), wmat))
            parts.append(box('wz', (w + 0.12, d - 1.6, 0.55), G(gx, y, gz), wmat))
        # tubo al neon verticale su uno spigolo
        cx = gx + (w / 2 + 0.1) * rng.choice((-1, 1))
        cz = gz + (d / 2 + 0.1) * rng.choice((-1, 1))
        parts.append(box('tube', (0.22, 0.22, height - 3), G(cx, base_y + 1.5 + (height - 3) / 2, cz), rng.choice(glow_mats)))
        # ingresso con pensilina
        parts.append(box('door', (3.0, 0.2, 2.6), G(gx, base_y + 1.3, gz + d / 2 + 0.02), M['Dark']))
        parts.append(box('awning', (4.2, 1.6, 0.18), G(gx, base_y + 3.0, gz + d / 2 + 0.8), glow))
        # antenne
        for k in range(rng.randint(0, 3)):
            ax = gx + rng.uniform(-w / 3, w / 3)
            az = gz + rng.uniform(-d / 3, d / 3)
            parts.append(c['cylinder']('ant', 0.06, 0.03, rng.uniform(2, 5), M['Metal'], segs=6, center=G(ax, base_y + height, az)))
        o = c['join'](parts, name)
        c['static'](o)
        return o

    def sign_board(self, name, gx, gy, gz, facing):
        c = self.c
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        vs = [bm.verts.new(p) for p in ((-2.6, 0, -0.7), (2.6, 0, -0.7), (2.6, 0, 0.7), (-2.6, 0, 0.7))]
        f = bm.faces.new(vs)
        for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uvl].uv = uv
        board = c['mesh_object'](name, bm, self.M['Board'], smooth=False)
        c['place'](board, gx, gy, gz, facing)
        frame = c['box']('signframe', (5.4, 0.12, 1.6), (0, 0.08, 0), self.M['Metal'])
        frame.name = name + '_frame'
        c['place'](frame, gx, gy, gz, facing)

    def holo_screen(self, gx, gz, base_y):
        c, M = self.c, self.M
        parts = [
            c['box']('pillarL', (0.8, 0.8, 13), (-6.0, 0, 6.5), M['Building'], bevel=0.08, segs=1),
            c['box']('pillarR', (0.8, 0.8, 13), (6.0, 0, 6.5), M['Building'], bevel=0.08, segs=1),
            c['box']('beam', (13.2, 0.9, 0.8), (0, 0, 13.2), M['Building'], bevel=0.08, segs=1),
            c['box']('glowL', (0.15, 0.15, 12), (-5.55, -0.45, 6.5), M['GlowCyan']),
            c['box']('glowR', (0.15, 0.15, 12), (5.55, -0.45, 6.5), M['GlowPink']),
            c['box']('back', (11, 0.3, 7), (0, 0.3, 8.7), M['Dark']),
        ]
        frame = c['static'](c['join'](parts, 'HoloFrame'))
        c['place'](frame, gx, base_y, gz, 0.0)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        vs = [bm.verts.new(p) for p in ((-5.4, 0, 5.3), (5.4, 0, 5.3), (5.4, 0, 12.1), (-5.4, 0, 12.1))]
        f = bm.faces.new(vs)
        for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uvl].uv = uv
        scr = c['mesh_object']('Screen_holo', bm, M['Screen'], smooth=False)
        c['place'](scr, gx, base_y, gz - 0.2, 0.0)
        for x in (-6.0, 6.0):
            c['collider'](gx + x, gz, 0.6)

    # ---------------------------------------------------------------- Lago
    def build_lake(self):
        c, M = self.c, self.M
        water = c['disc']('Water_lake', 0, LAKE_R + 6, 10, 128, M['Water'])
        water.location = c['G'](LAKE[0], WATER_Y, LAKE[1])
        # pontile verso il centro del lago
        dx, dz = -LAKE[0], -LAKE[1]
        ln = math.hypot(dx, dz)
        dx, dz = dx / ln, dz / ln
        facing = math.atan2(-dx, -dz)  # guarda verso il centro del lago
        start = LAKE_R + 7
        length = 30.0
        cx = LAKE[0] + dx * (start - length / 2)
        cz = LAKE[1] + dz * (start - length / 2)
        top = 0.25
        parts = []
        for k in range(int(length / 0.6)):
            parts.append(c['box']('plank', (3.2, 0.5, 0.09), (0, -length / 2 + 0.3 + k * 0.6, top - 0.045), M['Wood'], bevel=0.01, segs=1))
        for k in range(0, int(length / 3) + 1):
            for s in (-1, 1):
                parts.append(c['cylinder']('post', 0.12, 0.12, 4.2, M['WoodDark'], segs=8, center=(s * 1.5, -length / 2 + k * 3, top - 4.0)))
        end_y = -length / 2 - 4.0
        for k in range(16):
            parts.append(c['box']('plankE', (9, 0.5, 0.09), (0, end_y - 4.5 + 0.28 + k * 0.56, top - 0.045), M['Wood'], bevel=0.01, segs=1))
        for sx in (-4.3, 4.3):
            for sy in (end_y - 4.3, end_y + 4.3):
                parts.append(c['cylinder']('cpost', 0.15, 0.15, 5.2, M['WoodDark'], segs=8, center=(sx, sy, top - 4.0)))
                parts.append(c['cylinder']('lamp', 0.12, 0.1, 0.3, M['Lantern'], segs=6, center=(sx, sy, top + 1.15), smooth=False))
        pier = c['static'](c['join'](parts, 'Pier'))
        c['place'](pier, cx, 0, cz, facing)
        self.box_platform(cx, cz, 1.6, length / 2, facing, top)
        ex, ez = self.local(cx, cz, facing, 0, length / 2 + 4.5)
        self.box_platform(ex, ez, 4.5, 4.5, facing, top)
        for sx in (-4.3, 4.3):
            for sy in (-4.3, 4.3):
                px, pz = self.local(ex, ez, facing, sx, sy)
                c['collider'](px, pz, 0.2)
        # panchine in fondo al pontile, rivolte al lago
        for sx in (-2.0, 2.0):
            bx, bz = self.local(ex, ez, facing, sx, 2.6)
            b = c['bench_mesh']()
            b.name = 'PierBench'
            c['place'](b, bx, top, bz, facing)
            c['static'](b)
            for s in (-0.5, 0.5):
                sx2, sz2 = self.local(bx, bz, facing, s, 0.02)
                self.seat(sx2, top, sz2, facing)
            c['collider'](bx, bz, 0.6)
        # barche
        for k, (ang, dist) in enumerate(((0.9, 18), (2.4, 24), (-1.8, 14))):
            bx = LAKE[0] + math.sin(ang) * dist
            bz = LAKE[1] + math.cos(ang) * dist
            boat = self.boat(f'Boat_{k}', k)
            c['place'](boat, bx, WATER_Y, bz, ang + 1.3)
        # spiaggia: ombrelloni e lettini
        for k, ang in enumerate((1.2, 1.6, 2.0, 2.4, 3.6, 4.0)):
            d = LAKE_R + 9
            ux = LAKE[0] + math.sin(ang) * d
            uz = LAKE[1] + math.cos(ang) * d
            if road_dist(ux, uz) < 5:
                continue
            face_lake = math.atan2(LAKE[0] - ux, LAKE[1] - uz)
            self.umbrella(ux, uz, k, face_lake)
        # palme sulla spiaggia
        r = random.Random(5)
        placed = 0
        while placed < 14:
            ang = r.random() * 2 * PI
            d = LAKE_R + 11 + r.random() * 8
            x, z = LAKE[0] + math.sin(ang) * d, LAKE[1] + math.cos(ang) * d
            if road_dist(x, z) < 5 or math.hypot(x, z) > BOUNDS - 4:
                continue
            self.add_instance('palm', x, z, scale=0.9 + r.random() * 0.4)
            c['collider'](x, z, 0.35)
            placed += 1
        px, pz = self.local(LAKE[0] + dx * (LAKE_R + 15), LAKE[1] + dz * (LAKE_R + 15), facing, 7.0, 0.0)
        self.pad('Lago Cristallo', px, pz, facing=facing)

    def boat(self, name, k):
        c, M = self.c, self.M
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.05], context='VERTS')
        bmesh.ops.scale(bm, vec=(0.9, 2.2, 0.7), verts=bm.verts)
        hull = c['mesh_object']('hull', bm, [M['Wood'], M['WinPink'], M['Rail']][k % 3])
        so = hull.modifiers.new('so', 'SOLIDIFY')
        so.thickness = 0.08
        c['apply_modifiers'](hull)
        seat = c['box']('seatb', (1.6, 0.4, 0.08), (0, 0, -0.15), M['WoodDark'])
        rim = c['box']('rimb', (0.08, 0.08, 0.08), (0, -2.15, 0.02), M['Gold'])
        return c['join']([hull, seat, rim], name)

    def umbrella(self, x, z, k, facing):
        c, M = self.c, self.M
        y = H(x, z)
        cols = [M['WinPink'], M['GlowCyan'], M['WinAmber']]
        parts = [c['cylinder']('pole', 0.05, 0.05, 2.6, M['Rail'], segs=8)]
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=12, radius1=1.8, radius2=0.05, depth=0.6)
        bmesh.ops.translate(bm, vec=(0, 0, 2.5), verts=bm.verts)
        canopy = c['mesh_object']('canopy', bm, M['Canvas'], smooth=False)
        col = canopy.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
        tints = [(1.0, 0.45, 0.6), (1, 1, 1)] if k % 2 else [(0.3, 0.75, 1.0), (1, 1, 1)]
        for i, v in enumerate(canopy.data.vertices):
            a = math.atan2(v.co.y, v.co.x)
            col.data[i].color = (*srgb(tints[int((a + PI) / (2 * PI) * 12) % 2]), 1)
        parts.append(canopy)
        # lettino
        parts.append(c['box']('lounger', (0.7, 1.9, 0.12), (1.4, 0.2, 0.42), M['Rail'], bevel=0.03, segs=1))
        back = c['box']('lback', (0.7, 0.6, 0.1), (0, 0, 0), M['Rail'], bevel=0.03, segs=1)
        back.data.transform(Matrix.Translation((1.4, 1.2, 0.65)) @ Matrix.Rotation(0.9, 4, 'X'))
        parts.append(back)
        for sx in (-0.3, 0.3):
            for sy in (-0.7, 0.9):
                parts.append(c['box']('lleg', (0.06, 0.06, 0.4), (1.4 + sx, 0.2 + sy, 0.2), M['Metal']))
        o = c['static'](c['join'](parts, f'Umbrella_{k}'))
        c['place'](o, x, y, z, facing)
        c['collider'](x, z, 0.15)
        lx, lz = self.local(x, z, facing, 1.4, -0.1)
        self.L['seats'].append({'position': [round(lx, 3), round(y, 3), round(lz, 3)], 'facing': round(facing, 4)})
        ix, iz = self.local(x, z, facing, 2.3, -0.2)
        self.L['interactables'].append({'type': 'sit', 'seat': len(self.L['seats']) - 1, 'point': [round(ix, 3), round(y, 3), round(iz, 3)], 'radius': 1.2, 'label': 'Rilassati'})
        self.box_collider(lx, lz, 0.4, 0.95, facing)

    # ---------------------------------------------------------------- Foresta
    def build_forest(self):
        c, M = self.c, self.M
        r = random.Random(77)
        cx, cz = CLEARING
        y0 = H(cx, cz)
        # falò
        parts = []
        for k in range(9):
            a = k / 9 * 2 * PI
            b = c['blob']('stone', 0.28, M['Rock'], subdiv=1, rough=0.3, seed=k + 300, squash=0.7)
            b.location = (math.cos(a) * 0.9, math.sin(a) * 0.9, 0.1)
            parts.append(b)
        for k in range(4):
            lg = c['cylinder']('log', 0.11, 0.09, 1.3, M['Bark'], segs=8)
            lg.data.transform(Matrix.Rotation(0.9, 4, 'X') @ Matrix.Translation((0, 0, -0.65)))
            lg.data.transform(Matrix.Rotation(k * PI / 2, 4, 'Z'))
            lg.location = (0, 0, 0.35)
            parts.append(lg)
        fire = c['static'](c['join'](parts, 'Campfire'))
        c['place'](fire, cx, y0, cz)
        c['collider'](cx, cz, 1.3)
        self.L['campfire'] = [cx, round(y0 + 0.3, 2), cz]
        # tronchi per sedersi
        for k in range(4):
            a = k / 4 * 2 * PI + PI / 4
            lx, lz = cx + math.sin(a) * 4.2, cz + math.cos(a) * 4.2
            facing = math.atan2(cx - lx, cz - lz)
            lg = c['cylinder']('seatlog', 0.28, 0.28, 2.6, M['Bark'], segs=12)
            lg.data.transform(Matrix.Rotation(PI / 2, 4, 'Y') @ Matrix.Translation((0, 0, -1.3)))
            lg.location = (0, 0, 0.22)
            lg.name = f'SeatLog_{k}'
            c['place'](lg, lx, H(lx, lz), lz, facing)
            c['static'](lg)
            self.box_collider(lx, lz, 1.3, 0.3, facing)
            for s in (-0.6, 0.6):
                sx, sz = self.local(lx, lz, facing, s, 0.05)
                self.seat(sx, H(lx, lz) + 0.05, sz, facing)
        # capanna di tronchi
        self.cabin(cx + 11, cz + 9, -2.3)
        # tenda
        bm = bmesh.new()
        v = [bm.verts.new(p) for p in ((-1.4, -1.6, 0), (1.4, -1.6, 0), (0, -1.6, 1.8), (-1.4, 1.6, 0), (1.4, 1.6, 0), (0, 1.6, 1.8))]
        bm.faces.new([v[0], v[1], v[4], v[3]])
        bm.faces.new([v[1], v[2], v[5], v[4]])
        bm.faces.new([v[2], v[0], v[3], v[5]])
        bm.faces.new([v[3], v[4], v[5]])
        tent = c['mesh_object']('Tent', bm, M['Canvas'], smooth=False)
        col = tent.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
        for i in range(len(tent.data.vertices)):
            col.data[i].color = (*srgb((1.0, 0.62, 0.3)), 1)
        c['place'](tent, cx - 10, H(cx - 10, cz + 6), cz + 6, 0.6)
        c['static'](tent)
        self.box_collider(cx - 10, cz + 6, 1.5, 1.7, 0.6)
        self.pad('Foresta Sussurrante', cx, cz - 13, facing=PI)
        # alberi del bosco (istanze)
        placed = 0
        tries = 0
        while placed < 230 and tries < 6000:
            tries += 1
            a = r.random() * 2 * PI
            d = math.sqrt(r.random()) * 78
            x, z = FOREST[0] + math.sin(a) * d, FOREST[1] + math.cos(a) * d
            if math.hypot(x, z) < PLAZA_FLAT + 6 or math.hypot(x, z) > BOUNDS - 3:
                continue
            if math.hypot(x - cx, z - cz) < 17 or road_dist(x, z) < 3.5:
                continue
            if any(math.hypot(x - p[0], z - p[2]) < 4.2 for p in self.instances.get('_forest', [])):
                continue
            kind = r.choices(['pine', 'round', 'autumn'], [0.45, 0.3, 0.25])[0]
            sc = 0.9 + r.random() * 0.7
            self.add_instance(kind, x, z, scale=sc)
            self.instances.setdefault('_forest', []).append([x, 0, z])
            c['collider'](x, z, 0.32 * sc)
            placed += 1
        # funghi e cespugli nel sottobosco
        for k in range(70):
            a = r.random() * 2 * PI
            d = math.sqrt(r.random()) * 72
            x, z = FOREST[0] + math.sin(a) * d, FOREST[1] + math.cos(a) * d
            if math.hypot(x, z) < PLAZA_FLAT + 6 or road_dist(x, z) < 2.5 or math.hypot(x - cx, z - cz) < 6:
                continue
            self.add_instance('mushroom', x, z, scale=0.7 + r.random() * 0.8)
        self.instances.pop('_forest', None)

    def cabin(self, gx, gz, facing):
        c, M = self.c, self.M
        y = H(gx, gz)
        W, D = 6.0, 5.0
        parts = []
        for k in range(9):
            z = 0.15 + k * 0.3
            for (lx, ly, ln, rot) in ((0, -D / 2, W + 0.6, 'Y'), (0, D / 2, W + 0.6, 'Y'), (-W / 2, 0, D + 0.6, 'X'), (W / 2, 0, D + 0.6, 'X')):
                lg = c['cylinder']('wall', 0.16, 0.16, ln, M['Bark'] if k % 2 else M['WoodDark'], segs=8)
                lg.data.transform(Matrix.Translation((lx, ly, z)) @ Matrix.Rotation(PI / 2, 4, rot) @ Matrix.Translation((0, 0, -ln / 2)))
                parts.append(lg)
        bm = bmesh.new()
        rv = [bm.verts.new(p) for p in ((-W / 2 - 0.6, -D / 2 - 0.6, 2.7), (W / 2 + 0.6, -D / 2 - 0.6, 2.7), (0, -D / 2 - 0.6, 4.6),
                                        (-W / 2 - 0.6, D / 2 + 0.6, 2.7), (W / 2 + 0.6, D / 2 + 0.6, 2.7), (0, D / 2 + 0.6, 4.6))]
        bm.faces.new([rv[0], rv[2], rv[5], rv[3]])
        bm.faces.new([rv[2], rv[1], rv[4], rv[5]])
        roof = c['mesh_object']('roof', bm, M['Roof'], smooth=False)
        so = roof.modifiers.new('so', 'SOLIDIFY')
        so.thickness = 0.2
        c['apply_modifiers'](roof)
        parts.append(roof)
        bm = bmesh.new()
        gv = [bm.verts.new(p) for p in ((-W / 2, -D / 2, 2.7), (W / 2, -D / 2, 2.7), (0, -D / 2, 4.5))]
        bm.faces.new(gv)
        gv2 = [bm.verts.new(p) for p in ((-W / 2, D / 2, 2.7), (0, D / 2, 4.5), (W / 2, D / 2, 2.7))]
        bm.faces.new(gv2)
        parts.append(c['mesh_object']('gable', bm, M['WoodDark'], smooth=False))
        parts.append(c['box']('door', (1.1, 0.12, 2.0), (0, -D / 2 - 0.12, 1.0), M['WoodDark']))
        for sx in (-1.8, 1.8):
            parts.append(c['box']('win', (0.9, 0.1, 0.8), (sx, -D / 2 - 0.13, 1.5), M['Lantern']))
        parts.append(c['box']('chimney', (0.6, 0.6, 1.8), (1.6, 0.8, 4.0), M['Rock']))
        o = c['static'](c['join'](parts, 'Cabin'))
        c['place'](o, gx, y, gz, facing)
        self.box_collider(gx, gz, W / 2 + 0.2, D / 2 + 0.2, facing)

    # ---------------------------------------------------------------- Collina con tempio
    def build_hill(self):
        c, M = self.c, self.M
        gx, gz = HILL
        y = max(H(gx + dx, gz + dz) for dx in (-6, 0, 6) for dz in (-6, 0, 6))
        parts = [
            c['cylinder']('base', 7.4, 7.8, 0.6, M['StoneDark'], segs=8, smooth=False),
            c['cylinder']('floor', 6.9, 7.1, 0.12, M['Stone'], segs=8, center=(0, 0, 0.6), smooth=False),
        ]
        for k in range(8):
            a = k / 8 * 2 * PI + PI / 8
            px, py = math.cos(a) * 5.6, math.sin(a) * 5.6
            parts.append(c['cylinder']('pillar', 0.28, 0.3, 4.2, M['Lacquer'], segs=12, center=(px, py, 0.7)))
            parts.append(c['cylinder']('pbase', 0.42, 0.45, 0.25, M['Stone'], segs=8, center=(px, py, 0.7)))
        parts.append(c['lathe']('beam', [(5.95, 4.8), (6.1, 4.8), (6.1, 5.2), (5.3, 5.2), (5.3, 4.8)], M['Lacquer'], segs=8, smooth=False))
        parts.append(c['lathe']('roof1', [(8.6, 5.3), (8.2, 5.15), (7.6, 5.4), (5.0, 6.6), (2.2, 7.6), (0.01, 7.9)], M['Roof'], segs=8, smooth=False))
        parts.append(c['lathe']('roof2', [(4.0, 7.7), (3.7, 7.6), (2.6, 8.3), (0.8, 9.3), (0.01, 9.5)], M['Roof'], segs=8, smooth=False))
        parts.append(c['lathe']('finial', [(0.01, 9.4), (0.25, 9.6), (0.12, 10.2), (0.3, 10.5), (0.01, 11.2)], M['Gold'], segs=12))
        parts.append(c['lathe']('bell', [(0.01, 3.2), (0.5, 3.25), (0.45, 3.6), (0.3, 4.1), (0.01, 4.25)], M['Gold'], segs=16))
        parts.append(c['cylinder']('rope', 0.03, 0.03, 0.6, M['Bark'], segs=6, center=(0, 0, 4.2)))
        # gradini
        for k in range(4):
            parts.append(c['box']('step', (3.0, 0.8, 0.15), (0, -7.6 - k * 0.8, 0.45 - k * 0.15), M['Stone'], bevel=0.03, segs=1))
        temple = c['static'](c['join'](parts, 'Temple'))
        c['place'](temple, gx, y - 0.1, gz, math.atan2(-gx, -gz))
        c['platform'](gx, gz, 7.4, y + 0.6)
        for k in range(8):
            a = k / 8 * 2 * PI + PI / 8
            # coordinate locali del tempio ruotate verso la piazza
            f = math.atan2(-gx, -gz)
            lx, lz = math.cos(a) * 5.6, -math.sin(a) * 5.6
            px, pz = self.local(gx, gz, f, lx, -lz)
            c['collider'](px, pz, 0.4)
        # cannocchiale
        tele = [c['cylinder']('tripod', 0.05, 0.05, 1.2, M['Metal'], segs=6), c['cylinder']('tube', 0.12, 0.08, 1.0, M['Gold'], segs=12)]
        tele[1].data.transform(Matrix.Translation((0, 0, 1.25)) @ Matrix.Rotation(1.2, 4, 'X') @ Matrix.Translation((0, 0, -0.5)))
        t = c['static'](c['join'](tele, 'Telescope'))
        tx, tz = self.local(gx, gz, math.atan2(-gx, -gz), 3.0, -3.2)
        c['place'](t, tx, y + 0.72, tz, math.atan2(-gx, -gz) + PI)
        c['collider'](tx, tz, 0.3)
        # panchine rivolte al panorama
        for k, ang in enumerate((0.6, 2.2, 3.8, 5.0)):
            bx, bz = gx + math.sin(ang) * 10.5, gz + math.cos(ang) * 10.5
            b = c['bench_mesh']()
            b.name = f'HillBench_{k}'
            c['place'](b, bx, H(bx, bz), bz, ang)
            c['static'](b)
            fx, fz = math.sin(ang), math.cos(ang)
            rx, rz = math.cos(ang), -math.sin(ang)
            for s in (-0.5, 0.5):
                self.seat(bx + rx * s + fx * 0.02, H(bx, bz), bz + rz * s + fz * 0.02, ang)
            c['collider'](bx, bz, 0.7)
        px, pz = gx + 9 * math.sin(math.atan2(-gx, -gz) + 0.9), gz + 9 * math.cos(math.atan2(-gx, -gz) + 0.9)
        self.pad('Collina del Vento', px, pz, facing=math.atan2(-gx, -gz))
        # rocce sulla collina
        r = random.Random(31)
        for k in range(40):
            a = r.random() * 2 * PI
            d = 12 + r.random() * 30
            x, z = gx + math.sin(a) * d, gz + math.cos(a) * d
            if road_dist(x, z) < 3 or math.hypot(x, z) < PLAZA_FLAT + 4:
                continue
            sc = 0.6 + r.random() * 1.6
            self.add_instance('rock', x, z, scale=sc)
            c['collider'](x, z, 0.8 * sc)

    # ---------------------------------------------------------------- Palco
    def build_stage(self):
        c, M = self.c, self.M
        gx, gz = STAGE
        f = math.atan2(-gx, -gz)  # il palco guarda verso la piazza
        y = 0.3
        parts = [
            c['box']('deck', (18, 9, 1.2), (0, 3.0, 0.6), M['StoneDark'], bevel=0.06, segs=1),
            c['box']('edge', (18.2, 0.2, 0.15), (0, -1.5, 1.22), M['GlowCyan']),
        ]
        for s in (-1, 1):
            parts.append(c['box']('tower', (1.0, 1.0, 9), (s * 9.5, 6.5, 4.5), M['Metal'], bevel=0.05, segs=1))
            for k in range(3):
                parts.append(c['box']('spk', (1.6, 1.4, 1.4), (s * 11.4, 1.0, 1.4 * k + 0.7), M['Dark'], bevel=0.06, segs=1))
                parts.append(c['cylinder']('cone', 0.5, 0.5, 0.05, M['GlowPink'] if k % 2 else M['GlowCyan'], segs=16, center=(s * 11.4, 0.29, 1.4 * k + 0.7)))
            st = c['box']('steps', (2.2, 3.0, 0.6), (s * 7.4, -2.6, 0.3), M['Stone'], bevel=0.04, segs=1)
            parts.append(st)
        parts.append(c['box']('truss', (20, 1.0, 1.0), (0, 6.5, 9.0), M['Metal'], bevel=0.05, segs=1))
        ring = c['lathe']('ring', [(6.0, 0), (6.4, 0), (6.4, 0.3), (6.0, 0.3)], M['GlowPink'], segs=64, smooth=False)
        ring.data.transform(Matrix.Translation((0, 7.2, 5.6)) @ Matrix.Rotation(PI / 2, 4, 'X'))
        parts.append(ring)
        parts.append(c['box']('backwall', (17, 0.4, 7), (0, 7.4, 4.7), M['Dark']))
        for k in range(7):
            parts.append(c['box']('led', (0.3, 0.12, 6.5), (-7.2 + k * 2.4, 7.15, 4.5), [M['GlowCyan'], M['GlowPink'], M['WinAmber']][k % 3]))
        stage = c['static'](c['join'](parts, 'Stage'))
        c['place'](stage, gx, y, gz, f)
        cx, cz = self.local(gx, gz, f, 0, -3.0)
        self.box_platform(cx, cz, 9, 4.5, f, y + 1.2)
        self.box_collider(cx, cz, 9, 4.5, f)  # si sale dalle scale laterali
        for s in (-1, 1):
            sx, sz = self.local(gx, gz, f, s * 7.4, 2.6)
            self.box_platform(sx, sz, 1.1, 1.5, f, y + 0.6)
            tx, tz = self.local(gx, gz, f, s * 9.5, -6.5)
            c['collider'](tx, tz, 0.8)
            for k in range(1):
                spx, spz = self.local(gx, gz, f, s * 11.4, -1.0)
                self.box_collider(spx, spz, 0.8, 0.7, f)
        # file di sedute per il pubblico
        for row in range(3):
            d = 9 + row * 3.2
            bench = c['box']('row', (14 - row * 0.0, 0.9, 0.45), (0, 0, 0.225), M['Wood'], bevel=0.04, segs=1)
            bench.name = f'StageRow_{row}'
            rx, rz = self.local(gx, gz, f, 0, d)
            c['place'](bench, rx, y, rz, f)
            c['static'](bench)
            self.box_collider(rx, rz, 7, 0.45, f)
            for k in range(7):
                sx, sz = self.local(rx, rz, f, -6 + k * 2, 0.0)
                self.L['seats'].append({'position': [round(sx, 3), round(y, 3), round(sz, 3)], 'facing': round(f + PI, 4)})
                ix, iz = self.local(rx, rz, f, -6 + k * 2, 0.9)
                self.L['interactables'].append({'type': 'sit', 'seat': len(self.L['seats']) - 1, 'point': [round(ix, 3), round(y, 3), round(iz, 3)], 'radius': 0.9, 'label': 'Siediti'})
        px, pz = self.local(gx, gz, f, 12, 13)
        self.pad('Palco delle Stelle', px, pz, facing=f)

    # ---------------------------------------------------------------- Prato con albero antico
    def build_meadow(self):
        c, M = self.c, self.M
        gx, gz = MEADOW
        y = H(gx, gz)
        parts = []
        trunk = c['curve_strand']('trunk', [(0, 0, -0.5), (0.4, 0.2, 3.5), (-0.3, 0.1, 7.5), (0.2, -0.2, 10)], 1.7, 0.6, bulge=0)
        c['set_material'](trunk, M['Bark'])
        parts.append(trunk)
        r = random.Random(9)
        for k in range(7):
            a = k / 7 * 2 * PI
            end = Vector((math.cos(a) * 5.5, math.sin(a) * 5.5, 11 + r.random() * 2))
            br = c['curve_strand']('branch', [(0, 0, 8), (math.cos(a) * 2.5, math.sin(a) * 2.5, 9.5), tuple(end)], 0.55, 0.2, bulge=0)
            c['set_material'](br, M['Bark'])
            parts.append(br)
            b = c['blob']('crown', 3.2 + r.random() * 1.2, M['LeavesPink'], subdiv=2, rough=0.2, seed=500 + k, squash=0.75)
            b.location = end + Vector((0, 0, 1.2))
            parts.append(b)
        top = c['blob']('crowntop', 5.0, M['LeavesPink'], subdiv=2, rough=0.2, seed=520, squash=0.7)
        top.location = (0, 0, 14.5)
        parts.append(top)
        for k in range(6):  # radici
            a = k / 6 * 2 * PI + 0.3
            rt = c['curve_strand']('root', [(0, 0, 0.8), (math.cos(a) * 2.2, math.sin(a) * 2.2, 0.2), (math.cos(a) * 3.6, math.sin(a) * 3.6, -0.3)], 0.6, 0.1, bulge=0)
            c['set_material'](rt, M['Bark'])
            parts.append(rt)
        tree = c['static'](c['join'](parts, 'AncientTree'))
        c['place'](tree, gx, y, gz)
        c['collider'](gx, gz, 2.3)
        for k, ang in enumerate((0.4, 2.5, 4.4)):
            bx, bz = gx + math.sin(ang) * 7.5, gz + math.cos(ang) * 7.5
            b = c['bench_mesh']()
            b.name = f'MeadowBench_{k}'
            c['place'](b, bx, H(bx, bz), bz, ang + PI)
            c['static'](b)
            fx, fz = math.sin(ang + PI), math.cos(ang + PI)
            rx, rz = math.cos(ang + PI), -math.sin(ang + PI)
            for s in (-0.5, 0.5):
                self.seat(bx + rx * s + fx * 0.02, H(bx, bz), bz + rz * s + fz * 0.02, ang + PI)
            c['collider'](bx, bz, 0.7)
        for k in range(160):
            a = r.random() * 2 * PI
            d = 4 + math.sqrt(r.random()) * 24
            x, z = gx + math.sin(a) * d, gz + math.cos(a) * d
            if road_dist(x, z) < 2.5:
                continue
            self.add_instance('flowers', x, z, scale=0.8 + r.random() * 0.5)
        self.pad("Prato dell'Albero Antico", gx + 6, gz - 10, facing=math.atan2(-gx, -gz))

    # ---------------------------------------------------------------- campagna
    def scatter_countryside(self):
        c = self.c
        r = random.Random(4242)
        counts = {'tree': 0, 'bush': 0, 'rock': 0, 'flowers': 0}
        target = {'tree': 300, 'bush': 280, 'rock': 140, 'flowers': 260}
        tries = 0
        while any(counts[k] < target[k] for k in counts) and tries < 30000:
            tries += 1
            a = r.random() * 2 * PI
            d = PLAZA_FLAT + 4 + math.sqrt(r.random()) * (BOUNDS - PLAZA_FLAT - 6)
            x, z = math.sin(a) * d, math.cos(a) * d
            if not self.free(x, z):
                continue
            if math.hypot(x - FOREST[0], z - FOREST[1]) < 80:
                continue
            kind = r.choice([k for k in counts if counts[k] < target[k]])
            if kind == 'tree':
                k2 = r.choices(['round', 'sakura', 'pine', 'autumn'], [0.35, 0.3, 0.2, 0.15])[0]
                sc = 0.9 + r.random() * 0.6
                self.add_instance(k2, x, z, scale=sc)
                c['collider'](x, z, 0.32 * sc)
            elif kind == 'bush':
                sc = 0.7 + r.random() * 0.7
                self.add_instance('bush', x, z, scale=sc)
                c['collider'](x, z, 0.5 * sc)
            elif kind == 'rock':
                sc = 0.5 + r.random() * 1.4
                self.add_instance('rock', x, z, scale=sc)
                c['collider'](x, z, 0.8 * sc)
            else:
                self.add_instance('flowers', x, z, scale=0.8 + r.random() * 0.6)
            counts[kind] += 1

    # ---------------------------------------------------------------- sorgenti delle istanze
    def build_instance_sources(self):
        """Un modello per tipo; il gioco li ripete con InstancedMesh."""
        c, M = self.c, self.M
        srcs = {}
        srcs['pine'] = c['tree']('pine', 1.0, 11, light=True)
        srcs['round'] = c['tree']('round', 1.0, 12, light=True)
        srcs['sakura'] = c['tree']('sakura', 1.0, 13, light=True)
        srcs['autumn'] = c['tree']('autumn', 1.0, 14, light=True)
        srcs['bush'] = c['blob']('bush', 0.7, M['Bush'], subdiv=3, rough=0.25, seed=900, squash=0.7)
        srcs['bush'].data.transform(Matrix.Translation((0, 0, 0.3)))
        rock = c['blob']('rock', 1.0, M['Rock'], subdiv=2, rough=0.35, seed=901, squash=0.6)
        for v in rock.data.vertices:
            v.co.z = max(v.co.z, -0.3)
        rock.data.update()
        srcs['rock'] = rock
        stem = c['cylinder']('stem', 0.05, 0.06, 0.18, M['Rail'], segs=8)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=0.16)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context='VERTS')
        bmesh.ops.scale(bm, vec=(1, 1, 0.7), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(0, 0, 0.17), verts=bm.verts)
        cap = c['mesh_object']('cap', bm, M['Mushroom'])
        srcs['mushroom'] = c['join']([stem, cap], 'mushroom')
        # mazzo di fiori colorati
        fb = bmesh.new()
        fcol = []
        r = random.Random(3)
        palette = [(1.0, 0.75, 0.88), (1.0, 0.95, 0.55), (0.75, 0.85, 1.0), (1, 1, 1), (1.0, 0.6, 0.5)]
        for k in range(14):
            x, y = (r.random() - 0.5) * 1.6, (r.random() - 0.5) * 1.6
            col = srgb(palette[k % 5])
            hgt = 0.12 + r.random() * 0.12
            for j in range(5):
                pa = 2 * PI * j / 5
                px, py = x + math.cos(pa) * 0.06, y + math.sin(pa) * 0.06
                vs = [fb.verts.new((px + dx, py + dy, hgt)) for dx, dy in ((-0.045, -0.045), (0.045, -0.045), (0.045, 0.045), (-0.045, 0.045))]
                fb.faces.new(vs)
                fcol += [col] * 4
            vs = [fb.verts.new(p) for p in ((x - 0.01, y, 0), (x + 0.01, y, 0), (x + 0.01, y, hgt), (x - 0.01, y, hgt))]
            fb.faces.new(vs)
            fcol += [srgb((0.3, 0.6, 0.3))] * 4
        fl = c['mesh_object']('flowers', fb, M['Flower'], smooth=False)
        colattr = fl.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
        for i, cc in enumerate(fcol):
            colattr.data[i].color = (*cc, 1)
        srcs['flowers'] = fl
        srcs['palm'] = self.palm()
        srcs['pine_snow'] = self.snowy_pine()
        srcs['bamboo'] = self.bamboo()
        out = {}
        for k, o in srcs.items():
            o.name = f'Inst_{k}'
            o.location = (0, 0, 0)
            out[k] = o
        return out

    def palm(self):
        c, M = self.c, self.M
        pts = [(0, 0, -0.3), (0.3, 0, 2.5), (1.0, 0, 5.0), (1.8, 0, 7.0)]
        trunk = c['curve_strand']('ptrunk', pts, 0.28, 0.17, bulge=0, res=3, bevel_res=2)
        c['set_material'](trunk, M['Bark'])
        parts = [trunk]
        top = Vector(pts[-1])
        for k in range(8):
            a = k / 8 * 2 * PI
            d = Vector((math.cos(a), math.sin(a), 0))
            leaf = c['curve_strand']('leaf', [top, top + d * 1.4 + Vector((0, 0, 0.6)), top + d * 2.8 + Vector((0, 0, 0.1)), top + d * 3.6 + Vector((0, 0, -0.9))], 0.32, 0.03, bulge=0.2, res=2, bevel_res=1)
            for v in leaf.data.vertices:  # foglia appiattita
                rel = v.co - top
                up = rel.dot(Vector((0, 0, 1)))
                v.co.z -= up * 0.0
                v.co += Vector((0, 0, 0))
            leaf.data.transform(Matrix.Identity(4))
            c['set_material'](leaf, M['LeavesGreen'])
            parts.append(leaf)
        for k in range(3):
            b = c['blob']('coco', 0.18, M['WoodDark'], subdiv=1, rough=0.05, seed=k)
            b.location = top + Vector((math.cos(k * 2.1) * 0.25, math.sin(k * 2.1) * 0.25, -0.25))
            parts.append(b)
        return c['join'](parts, 'palm')

    def export_instances(self):
        for k in list(self.instances):
            if k.startswith('_'):
                self.instances.pop(k)
        self.L['instances'] = self.instances
