"""
Atrio centrale di Oasis: hall circolare futuristica (usato da hub.py tramite World).

Disposizione (angoli nel gioco: 0° = sud/+Z, 180° = nord/-Z, 90° = est/+X):
  r 0-8     pedana centrale con ologramma e piante
  r 11-13.5 anello di fioriere con strisce LED
  r 34-37   portali ad arco (30° + 60°k)
  r 38-46   edificio ad anello a due piani con vetrine, balconata in vetro, tetto
            aperto agli angoli delle strade (0°, 60°, ..., 300°)
  sopra     cupola: anello sul tetto + raggi curvi verso un anello centrale sospeso
  nord      tunnel di archi luminosi verso il Quartiere Neon, logo sopra l'ingresso
"""
import math
import random

import bpy  # noqa: I001
import bmesh
from mathutils import Matrix, Vector

from world_districts import H, road_dist, BOUNDS

PI = math.pi
R_IN = 38.0
R_OUT = 46.0
GAP = math.radians(7.5)  # mezza apertura dei varchi
GAPS = [math.radians(60 * k) for k in range(6)]
LEVEL = 6.0
ROOF = 12.0


def P(r, a, h):
    """(raggio, angolo nel gioco, altezza) -> coordinate Blender."""
    return Vector((r * math.sin(a), -r * math.cos(a), h))


def install_atrium(World):

    def arc_panel(self, name, r, a0, a1, z0, z1, mat, inward=True, n=None):
        n = n or max(2, int(abs(a1 - a0) * r / 1.5))
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        cols = []
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            cols.append((bm.verts.new(P(r, a, z0)), bm.verts.new(P(r, a, z1)), i / n))
        for i in range(n):
            b0, t0, u0 = cols[i]
            b1, t1, u1 = cols[i + 1]
            f = bm.faces.new([b0, b1, t1, t0] if not inward else [b1, b0, t0, t1])
            for loop in f.loops:
                v = loop.vert
                uu = u0 if v in (b0, t0) else u1
                vv = 0 if v in (b0, b1) else 1
                loop[uvl].uv = (uu if not inward else 1 - uu, vv)
        return self.c['mesh_object'](name, bm, mat, smooth=True)

    def arc_slab(self, name, r0, r1, a0, a1, z0, z1, mat, n=None):
        n = n or max(2, int(abs(a1 - a0) * r1 / 1.5))
        bm = bmesh.new()
        rings = []
        for i in range(n + 1):
            a = a0 + (a1 - a0) * i / n
            rings.append([bm.verts.new(P(r, a, z)) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
        for i in range(n):
            for q in range(4):
                q2 = (q + 1) % 4
                bm.faces.new([rings[i][q], rings[i][q2], rings[i + 1][q2], rings[i + 1][q]])
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        o = self.c['mesh_object'](name, bm, mat, smooth=False)
        return o

    def arc_tube(self, name, r, a0, a1, z, thick, mat, n=None):
        n = n or max(4, int(abs(a1 - a0) * r / 1.0))
        pts = [P(r, a0 + (a1 - a0) * i / n, z) for i in range(n + 1)]
        t = self.c['curve_strand'](name, pts, thick, thick, bulge=0, res=1, bevel_res=1)
        self.c['set_material'](t, mat)
        return t

    # ------------------------------------------------------------ anello di edifici
    def build_arcade(self, shop_angles):
        c, M = self.c, self.M
        segs = []
        for k in range(6):
            a0 = GAPS[k] + GAP
            a1 = GAPS[(k + 1) % 6] + (2 * PI if k == 5 else 0) - GAP
            segs.append((a0, a1))
        for si, (a0, a1) in enumerate(segs):
            parts = []
            # struttura: pavimento, tetto, muro esterno, balconata, fasce
            parts.append(self.arc_slab('floor', R_IN - 0.2, R_OUT, a0, a1, -0.05, 0.12, M['HullDark']))
            parts.append(self.arc_slab('mid', R_IN - 1.6, R_OUT, a0, a1, LEVEL - 0.35, LEVEL, M['Hull']))
            parts.append(self.arc_slab('roof', R_IN - 0.6, R_OUT + 0.3, a0, a1, ROOF - 0.5, ROOF, M['Hull']))
            parts.append(self.arc_slab('outer', R_OUT - 0.3, R_OUT, a0, a1, 0, ROOF, M['Hull']))
            parts.append(self.arc_slab('backwall', R_IN + 3.0, R_IN + 3.3, a0, a1, 0, ROOF, M['HullDark']))
            for ang in (a0, a1):  # testate dei varchi
                end = self.arc_slab('end', R_IN - 0.4, R_OUT, ang - 0.004 if ang == a1 else ang, ang + 0.004 if ang == a0 else ang, 0, ROOF, M['Hull'], n=1)
                parts.append(end)
            # fasce luminose: sotto la balconata (calda), bordo del tetto (azzurra), parapetto (calda)
            parts.append(self.arc_tube('warm1', R_IN - 1.55, a0, a1, LEVEL - 0.42, 0.05, M['Lantern']))
            parts.append(self.arc_tube('roofglow', R_IN - 0.65, a0, a1, ROOF - 0.55, 0.07, M['ArchGlow']))
            parts.append(self.arc_tube('warm2', R_IN - 1.5, a0, a1, LEVEL + 1.1, 0.035, M['Lantern']))
            parts.append(self.arc_tube('floorled', R_IN - 0.25, a0, a1, 0.14, 0.04, M['Lantern']))
            # pilastri e vetrine (piano terra e primo piano)
            n_bays = max(3, int((a1 - a0) * R_IN / 4.2))
            for b in range(n_bays + 1):
                ang = a0 + (a1 - a0) * b / n_bays
                parts.append(self.arc_slab('col', R_IN - 0.5, R_IN + 0.1, ang - 0.006, ang + 0.006, 0, ROOF - 0.5, M['HullDark'], n=1))
                cx, cz = (R_IN - 0.4) * math.sin(ang), (R_IN - 0.4) * math.cos(ang)
                c['collider'](cx, cz, 0.45)
            for b in range(n_bays):
                b0 = a0 + (a1 - a0) * b / n_bays + 0.008
                b1 = a0 + (a1 - a0) * (b + 1) / n_bays - 0.008
                mid = (b0 + b1) / 2
                is_shop = any(abs(math.atan2(math.sin(mid - sa), math.cos(mid - sa))) < (b1 - b0) / 2 for sa in shop_angles)
                if not is_shop:
                    parts.append(self.arc_panel('shopwin', R_IN + 0.3, b0, b1, 0.4, LEVEL - 1.2, M['ShopGlow']))
                    parts.append(self.arc_panel('sign', R_IN + 0.05, b0 + 0.01, b1 - 0.01, LEVEL - 1.05, LEVEL - 0.55, M['ArchGlow' if b % 2 else 'Lantern']))
                parts.append(self.arc_panel('upwin', R_IN + 0.3, b0, b1, LEVEL + 0.5, ROOF - 1.2, M['ShopGlowDim']))
            # parapetto in vetro della balconata
            parts.append(self.arc_panel('glass', R_IN - 1.55, a0, a1, LEVEL, LEVEL + 1.1, M['Glass']))
            parts.append(self.arc_tube('rail', R_IN - 1.55, a0, a1, LEVEL + 1.12, 0.04, M['Hull']))
            o = c['static'](c['join'](parts, f'Arcade_{si}'))
            # collisioni: muro tra le vetrine (dietro i pilastri) e muro esterno
            n = int((a1 - a0) * R_IN / 1.2)
            for i in range(n + 1):
                ang = a0 + (a1 - a0) * i / n
                if not any(abs(math.atan2(math.sin(ang - sa), math.cos(ang - sa))) < 0.065 for sa in shop_angles):
                    c['collider'](R_IN * math.sin(ang), R_IN * math.cos(ang), 0.55)
                c['collider'](R_OUT * math.sin(ang), R_OUT * math.cos(ang), 0.6)
            for ang in (a0, a1):
                for rr in range(int(R_IN), int(R_OUT) + 1):
                    c['collider'](rr * math.sin(ang), rr * math.cos(ang), 0.6)

    # ------------------------------------------------------------ negozi nell'edificio
    def build_storefronts(self, shops):
        c, M = self.c, self.M
        self.L['shops'] = {}
        for sid, title, deg in shops:
            a = math.radians(deg)
            w = 3.6 / R_IN
            parts = [
                self.arc_panel('interior', R_IN + 2.9, a - w, a + w, 0.1, LEVEL - 0.4, M['ShopGlow']),
                self.arc_slab('counter', R_IN + 0.5, R_IN + 1.3, a - w * 0.8, a + w * 0.8, 0, 1.05, M['Hull']),
                self.arc_slab('countertop', R_IN + 0.4, R_IN + 1.4, a - w * 0.85, a + w * 0.85, 1.05, 1.13, M['HullDark']),
                self.arc_tube('ctrglow', R_IN + 0.42, a - w * 0.8, a + w * 0.8, 0.9, 0.03, M['ArchGlow']),
            ]
            for s in (-1, 1):
                parts.append(self.arc_slab('side', R_IN, R_IN + 3.0, a + s * w - 0.004, a + s * w + 0.004, 0, LEVEL - 0.35, M['HullDark'], n=1))
                ped = c['cylinder']('ped', 0.42, 0.5, 0.8, M['HullDark'], segs=16, center=P(R_IN - 2.6, a + s * 2.8 / R_IN, 0))
                parts.append(ped)
                parts.append(c['cylinder']('pedglow', 0.44, 0.44, 0.04, M['GlowCyan'], segs=16, center=P(R_IN - 2.6, a + s * 2.8 / R_IN, 0.8), smooth=False))
            o = c['static'](c['join'](parts, f'Shop_{sid}'))
            f = a + PI  # verso il centro
            gx, gz = R_IN * math.sin(a), R_IN * math.cos(a)
            self.text_board(f'Board_shop_{sid}', title, (R_IN - 0.08) * math.sin(a), LEVEL - 0.8, (R_IN - 0.08) * math.cos(a), f, w=3.6, h=0.7, style='shop')
            displays = []
            for s in (-1, 1):
                ang = a + s * 2.8 / R_IN
                dx, dz = (R_IN - 2.6) * math.sin(ang), (R_IN - 2.6) * math.cos(ang)
                c['collider'](dx, dz, 0.55)
                displays.append([round(dx, 3), 0.84, round(dz, 3)])
            for s in (-1, 1):  # pareti laterali e bancone
                for rr in (R_IN + 0.5, R_IN + 1.5, R_IN + 2.5):
                    c['collider'](rr * math.sin(a + s * w), rr * math.cos(a + s * w), 0.3)
            for t in (-0.6, -0.2, 0.2, 0.6):
                c['collider']((R_IN + 0.9) * math.sin(a + t * w), (R_IN + 0.9) * math.cos(a + t * w), 0.45)
            kx, kz = (R_IN + 2.0) * math.sin(a), (R_IN + 2.0) * math.cos(a)
            ix, iz = (R_IN - 0.6) * math.sin(a), (R_IN - 0.6) * math.cos(a)
            self.L['shops'][sid] = {'title': title, 'displays': displays, 'keeper': [round(kx, 3), 0.12, round(kz, 3), round(f, 4)]}
            self.L['interactables'].append({'type': 'shop', 'shop': sid, 'point': [round(ix, 3), 0, round(iz, 3)], 'radius': 2.0, 'label': title})

    # ------------------------------------------------------------ cupola
    def build_dome(self):
        c, M = self.c, self.M
        parts = []
        R_TOP, H_TOP = 11.0, 27.0
        parts.append(c['lathe']('outerring', [(R_IN - 2.2, ROOF), (R_IN + 1.0, ROOF), (R_IN + 1.0, ROOF + 1.4), (R_IN - 2.2, ROOF + 1.4)], M['Hull'], segs=128, smooth=False))
        parts.append(c['lathe']('outerglow', [(R_IN - 2.25, ROOF + 0.05), (R_IN - 2.25, ROOF + 0.35)], M['ArchGlow'], segs=128, smooth=False))
        parts.append(c['lathe']('topring', [(R_TOP - 0.8, H_TOP - 1.0), (R_TOP + 1.6, H_TOP - 1.0), (R_TOP + 1.6, H_TOP + 0.6), (R_TOP - 0.8, H_TOP + 0.6)], M['Hull'], segs=96, smooth=False))
        parts.append(c['lathe']('topglow1', [(R_TOP - 0.85, H_TOP - 0.8), (R_TOP - 0.85, H_TOP - 0.4)], M['ArchGlow'], segs=96, smooth=False))
        parts.append(c['lathe']('topglow2', [(R_TOP + 1.65, H_TOP - 0.4), (R_TOP + 1.65, H_TOP)], M['ArchGlow'], segs=96, smooth=False))
        # raggi curvi
        n = 12
        for k in range(n):
            a = math.radians(15 + 30 * k)
            pts = []
            glow = []
            for i in range(17):
                t = i / 16
                r = R_IN - 1.0 + (R_TOP + 0.4 - (R_IN - 1.0)) * t
                h = ROOF + 1.2 + (H_TOP - ROOF - 1.2) * math.sin(t * PI / 2)
                pts.append(P(r, a, h))
                glow.append(P(r, a, h - 0.55))
            beam = c['curve_strand']('spoke', pts, 0.55, 0.4, bulge=0, res=2, bevel_res=1)
            c['set_material'](beam, M['Hull'])
            parts.append(beam)
            g = c['curve_strand']('spokeglow', glow, 0.08, 0.08, bulge=0, res=2, bevel_res=1)
            c['set_material'](g, M['ArchGlow'])
            parts.append(g)
        c['static'](c['join'](parts, 'Dome'))

    # ------------------------------------------------------------ pedana centrale
    def build_dais(self):
        c, M = self.c, self.M
        parts = [
            c['lathe']('dais', [(8.2, 0), (8.2, 0.42), (8.0, 0.45), (0.01, 0.45)], M['HullDark'], segs=96, smooth=False),
            c['lathe']('daisglow', [(8.23, 0.18), (8.23, 0.32)], M['Lantern'], segs=96, smooth=False),
            c['lathe']('holo_ring_base', [(3.9, 0.45), (4.2, 0.45), (4.2, 0.6), (3.9, 0.6)], M['Hull'], segs=64, smooth=False),
            c['lathe']('holoedge', [(4.21, 0.5), (4.21, 0.58)], M['ArchGlow'], segs=64, smooth=False),
        ]
        # vasche con piante intorno all'ologramma (4 archi con passaggi)
        for k in range(4):
            a0 = math.radians(20 + 90 * k)
            a1 = a0 + math.radians(50)
            parts.append(self.arc_slab('bed', 5.0, 7.2, a0, a1, 0.45, 0.95, M['HullDark']))
            parts.append(self.arc_tube('bedglow', 7.22, a0, a1, 0.8, 0.035, M['Lantern']))
            for j in range(3):
                ang = a0 + (a1 - a0) * (j + 0.5) / 3
                pl = self.tropical_plant(900 + k * 3 + j)
                pl.scale = (1.4, 1.4, 1.4)
                pl.location = P(6.1, ang, 0.9)
                parts.append(pl)
                c['collider'](6.1 * math.sin(ang), 6.1 * math.cos(ang), 1.2)
            orb = c['blob']('orb', 0.28, M['OrbLamp'], subdiv=2, rough=0.0, seed=k)
            orb.location = P(6.1, a1 - 0.05, 1.25)
            parts.append(orb)
        c['static'](c['join'](parts, 'Dais'))
        c['platform'](0, 0, 8.2, 0.45)
        # disco olografico (shader nel gioco)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        n = 48
        center = bm.verts.new((0, 0, 0.62))
        ring = [bm.verts.new((math.cos(2 * PI * i / n) * 3.9, math.sin(2 * PI * i / n) * 3.9, 0.62)) for i in range(n)]
        for i in range(n):
            f = bm.faces.new([center, ring[i], ring[(i + 1) % n]])
            for loop in f.loops:
                co = loop.vert.co
                loop[uvl].uv = (co.x / 7.8 + 0.5, co.y / 7.8 + 0.5)
        c['mesh_object']('Holo_disc', bm, M['Screen'], smooth=False)
        # anello di fioriere
        for k in range(6):
            a0 = math.radians(60 * k) + math.radians(9)
            a1 = math.radians(60 * (k + 1)) - math.radians(9)
            parts = [self.arc_slab('planter', 11.0, 13.5, a0, a1, 0, 0.7, M['HullDark']),
                     self.arc_tube('pglow_i', 10.98, a0, a1, 0.5, 0.035, M['Lantern']),
                     self.arc_tube('pglow_o', 13.52, a0, a1, 0.5, 0.035, M['Lantern'])]
            for j in range(5):
                ang = a0 + (a1 - a0) * (j + 0.5) / 5
                pl = self.tropical_plant(1000 + k * 5 + j)
                pl.scale = (1.6, 1.6, 1.6) if j % 2 else (1.15, 1.15, 1.15)
                pl.location = P(12.25, ang, 0.65)
                parts.append(pl)
            for ang in (a0 + 0.04, a1 - 0.04):
                orb = c['blob']('orb', 0.3, M['OrbLamp'], subdiv=2, rough=0.0, seed=k)
                orb.location = P(12.25, ang, 1.0)
                parts.append(orb)
            c['static'](c['join'](parts, f'PlanterRing_{k}'))
            n = int((a1 - a0) * 12.25 / 1.1)
            for i in range(n + 1):
                ang = a0 + (a1 - a0) * i / n
                c['collider'](12.25 * math.sin(ang), 12.25 * math.cos(ang), 1.3)
        # strisce LED nel pavimento: archi tratteggiati concentrici
        strips = []
        for r, n_d in ((17.5, 48), (24.0, 64), (30.5, 80)):
            for i in range(n_d):
                if i % 4 == 3:
                    continue
                a0 = 2 * PI * i / n_d
                a1 = a0 + 2 * PI / n_d * 0.7
                if any(abs(math.atan2(math.sin(a0 - g), math.cos(a0 - g))) < 0.05 for g in GAPS):
                    continue
                strips.append(self.arc_slab('led', r - 0.035, r + 0.035, a0, a1, 0.0, 0.08, M['Lantern'], n=3))
        c['join'](strips, 'FloorLEDs')

    # ------------------------------------------------------------ maxischermi sul tetto dell'edificio
    def build_screens(self):
        for sid, label, deg in (('explore', 'Esplora', 270), ('play', 'Gioca', 210), ('create', 'Crea', 150), ('social', 'Social', 90)):
            a = math.radians(deg)
            self.screen(sid, label, (R_IN - 0.3) * math.sin(a), (R_IN - 0.3) * math.cos(a), w=9.0, h=4.0, base=ROOF + 1.6, legs=False)

    # ------------------------------------------------------------ tunnel e logo a nord
    def build_tunnel(self):
        c, M = self.c, self.M
        parts = []
        a = PI  # nord
        for k in range(9):
            r = R_IN - 1 + k * 3.0
            arch = c['lathe']('tarch', [(4.6, -0.35), (5.4, -0.35), (5.4, 0.35), (4.6, 0.35)], M['HullDark'], segs=32, smooth=False)
            arch.data.transform(Matrix.Rotation(PI / 2, 4, 'X'))
            glow = c['lathe']('tglow', [(4.55, -0.1), (4.55, 0.1)], M['ArchGlow'], segs=32, smooth=False)
            glow.data.transform(Matrix.Rotation(PI / 2, 4, 'X'))
            o = c['join']([arch, glow], 'ta')
            # metà superiore: tagliamo la parte sotto terra
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.3], context='VERTS')
            bm.to_mesh(o.data)
            bm.free()
            o.data.transform(Matrix.Translation(P(r, a, 0.0)))
            parts.append(o)
            for s in (-1, 1):
                c['collider'](s * 5.0, -r, 0.5)
        parts.append(c['box']('tfloor', (8.6, 27, 0.08), P(R_IN + 11, a, 0.02), M['LobbyFloor']))
        for s in (-1, 1):
            parts.append(c['box']('tled', (0.08, 27, 0.06), P(R_IN + 11, a, 0.08) + Vector((s * 3.6, 0, 0)), M['ArchGlow']))
        c['static'](c['join'](parts, 'Tunnel'))
        # logo e stendardi sopra l'ingresso del tunnel
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        W, Hh = 18.0, 7.7
        vs = [bm.verts.new(p) for p in ((-W / 2, 0, -Hh / 2), (W / 2, 0, -Hh / 2), (W / 2, 0, Hh / 2), (-W / 2, 0, Hh / 2))]
        face = bm.faces.new(vs)
        for loop, uv in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uvl].uv = uv
        logo = c['mesh_object']('Logo_holo', bm, M['LogoScreen'], smooth=False)
        c['place'](logo, 0, ROOF + 6.5, -(R_IN - 1.5), 0.0)
        banners = []
        for s in (-1, 1):
            b = c['box']('banner', (2.0, 0.08, 7.0), (0, 0, 0), M['BannerBlue'])
            em = c['lathe']('emblem', [(0.5, -0.05), (0.66, -0.05), (0.66, 0.05), (0.5, 0.05)], M['ArchGlow'], segs=24, smooth=False)
            em.data.transform(Matrix.Translation((0, -0.06, 1.6)) @ Matrix.Rotation(PI / 2, 4, 'X'))
            dot = c['box']('emdot', (0.3, 0.06, 0.3), (0, -0.06, 1.6), M['ArchGlow'])
            o = c['join']([b, em, dot], 'banner')
            c['place'](o, s * 13.5, ROOF + 6.0, -(R_IN - 2.0), 0.0)
            banners.append(o)
        for k in range(4):  # altri stendardi appesi alla cupola
            ang = math.radians(120 + 40 * k)
            if abs(ang - PI) < 0.3:
                continue
            b = c['box']('banner', (1.6, 0.06, 5.5), (0, 0, 0), M['BannerBlue'])
            em = c['box']('em', (0.4, 0.06, 0.4), (0, -0.05, 1.3), M['ArchGlow'])
            o = c['join']([b, em], 'banner')
            c['place'](o, 27 * math.sin(ang), 17.0, 27 * math.cos(ang), ang + PI)
            banners.append(o)
        for b in banners:
            c['static'](b)

    # ------------------------------------------------------------ falesie con alberi dietro l'anello
    def build_cliffs(self):
        c, M = self.c, self.M
        r = random.Random(808)
        for k in range(14):
            a = math.radians(r.uniform(0, 360))
            if any(abs(math.atan2(math.sin(a - g), math.cos(a - g))) < math.radians(14) for g in GAPS):
                continue
            d = r.uniform(58, 72)
            gx, gz = d * math.sin(a), d * math.cos(a)
            if road_dist(gx, gz) < 7:
                continue
            h = r.uniform(18, 34)
            rad = r.uniform(5, 8)
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=rad, radius2=rad * 0.75, depth=h)
            bmesh.ops.translate(bm, vec=(0, 0, h / 2 - 1), verts=bm.verts)
            bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=3, use_grid_fill=True)
            from mathutils import noise
            for v in bm.verts:
                nrm = Vector((v.co.x, v.co.y, 0))
                if nrm.length > 0.1:
                    v.co += nrm.normalized() * noise.noise(v.co * 0.25 + Vector((k, 0, 0))) * rad * 0.35
            rock = c['mesh_object']('cliff', bm, M['Rock'], smooth=False)
            top = c['blob']('ctop', rad * 1.05, M['Grass'], subdiv=2, rough=0.15, seed=k + 70, squash=0.18)
            top.location = (0, 0, h - 1)
            o = c['static'](c['join']([rock, top], f'CliffSpire_{k}'))
            c['place'](o, gx, H(gx, gz) - 1, gz, r.uniform(0, 6))
            c['collider'](gx, gz, rad * 1.1)
            for j in range(4):
                ta = r.uniform(0, 2 * PI)
                td = r.uniform(0, rad * 0.6)
                self.add_instance(r.choice(['round', 'pine', 'round']), gx + math.cos(ta) * td, gz + math.sin(ta) * td,
                                  scale=r.uniform(0.9, 1.5), y=H(gx, gz) - 1 + h - 0.6)

    World.arc_panel = arc_panel
    World.arc_slab = arc_slab
    World.arc_tube = arc_tube
    World.build_arcade = build_arcade
    World.build_storefronts = build_storefronts
    World.build_dome = build_dome
    World.build_dais = build_dais
    World.build_screens = build_screens
    World.build_tunnel = build_tunnel
    World.build_cliffs = build_cliffs

    def build_atrium(self):
        shops = [('veicoli', 'Garage Turbo', 226), ('animali', 'Amici Pelosi', 134), ('effetti', 'Magie & Scie', 286), ('snack', 'Gelati Stellari', 74)]
        self.build_arcade([math.radians(d) for _, _, d in shops])
        self.build_storefronts(shops)
        self.build_dome()
        self.build_dais()
        self.build_screens()
        self.build_tunnel()
        self.build_cliffs()
        self.build_waterfall()
        sp = self.L.setdefault('npcSpots', {})
        sp['plaza'] = [[round(r * math.sin(math.radians(d)), 2), 0.0, round(r * math.cos(math.radians(d)), 2)]
                       for r in (17.0, 21.0, 26.0, 31.0) for d in range(10, 360, 40)]

    World.build_atrium = build_atrium
