"""
Quartieri aggiuntivi di Oasis e piazza arricchita (usato da hub.py tramite World):
  - Borgo Medievale con castello, case a graticcio, taverna, pozzo e mulino
  - Città d'Oriente con porta monumentale, pagoda, case dai tetti curvi, laghetto e ponte
  - Valle Innevata con baita, igloo, pupazzi di neve e laghetto ghiacciato
  - Negozi in piazza, fioriere, stendardi
  - Monete da raccogliere e punti dove passeggiano i personaggi non giocanti
"""
import math
import random

import bpy  # noqa: I001
import bmesh
from mathutils import Matrix, Vector

from world_districts import (CASTLE, CHINA, ICE, MEDIEVAL, POND, SNOW, BOUNDS, H, LAKE, LAKE_R, road_dist, srgb)

PI = math.pi


def tint(obj, color):
    col = obj.data.color_attributes.new('Tint', 'FLOAT_COLOR', 'POINT')
    c = srgb(color)
    for i in range(len(obj.data.vertices)):
        col.data[i].color = (*c, 1)
    return obj


def prism_roof(c, mat, w, d, base, rise, ov=0.5, thick=0.18):
    """Tetto a due falde (colmo lungo X)."""
    bm = bmesh.new()
    x0, x1 = -w / 2 - ov, w / 2 + ov
    y0, y1 = -d / 2 - ov, d / 2 + ov
    v = [bm.verts.new(p) for p in ((x0, y0, base), (x1, y0, base), (x1, 0, base + rise), (x0, 0, base + rise),
                                    (x0, y1, base), (x1, y1, base))]
    bm.faces.new([v[0], v[1], v[2], v[3]])
    bm.faces.new([v[3], v[2], v[5], v[4]])
    o = c['mesh_object']('roof', bm, mat, smooth=False)
    so = o.modifiers.new('so', 'SOLIDIFY')
    so.thickness = thick
    c['apply_modifiers'](o)
    return o


def gables(c, mat, w, d, base, rise):
    bm = bmesh.new()
    for y, order in ((-d / 2, (0, 1, 2)), (d / 2, (0, 2, 1))):
        pts = [(-w / 2, y, base), (w / 2, y, base), (0, y, base + rise)]
        bm.faces.new([bm.verts.new(pts[i]) for i in order])
    bm2 = bmesh.new()
    for x, order in ((-w / 2, (0, 2, 1)), (w / 2, (0, 1, 2))):
        pass
    bm2.free()
    return c['mesh_object']('gable', bm, mat, smooth=False)


def curved_roof(c, mat, w, d, base, rise, ov=0.9, thick=0.16):
    """Tetto orientale: falde concave e angoli che si alzano."""
    bm = bmesh.new()
    nx, ny = 14, 10
    W = w / 2 + ov
    D = d / 2 + ov
    grid = []
    for i in range(nx + 1):
        row = []
        for j in range(ny + 1):
            x = -W + 2 * W * i / nx
            y = -D + 2 * D * j / ny
            ty = abs(y) / D
            tx = abs(x) / W
            z = base + rise * (1 - ty ** 0.65) + rise * 0.35 * (tx ** 6) * (0.4 + ty) + rise * 0.18 * ty ** 6
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(nx):
        for j in range(ny):
            bm.faces.new([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    o = c['mesh_object']('croof', bm, mat, smooth=True)
    so = o.modifiers.new('so', 'SOLIDIFY')
    so.thickness = thick
    c['apply_modifiers'](o)
    return o


def flared_roof(c, mat, r, z, segs=8):
    prof = [(r + 2.3, z + 0.45), (r + 2.0, z + 0.2), (r + 1.3, z + 0.45), (r * 0.7, z + 1.1), (0.01, z + 1.35)]
    return c['lathe']('froof', prof, mat, segs=segs, smooth=False)


def install(World):
    """Aggiunge i metodi dei nuovi quartieri alla classe World."""

    # ------------------------------------------------------------ istanze nuove
    def snowy_pine(self):
        c, M = self.c, self.M
        parts = [c['cylinder']('trunk', 0.22, 0.14, 1.6, M['Bark'], segs=8)]
        for k in range(4):
            rr = 1.8 - k * 0.4
            z = 1.1 + k * 0.95
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=rr, radius2=0.0, depth=1.6)
            bmesh.ops.translate(bm, vec=(0, 0, z + 0.8), verts=bm.verts)
            parts.append(c['mesh_object']('pine', bm, M['LeavesPine'], smooth=True))
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=rr * 0.62, radius2=0.0, depth=0.65)
            bmesh.ops.translate(bm, vec=(0, 0, z + 1.32), verts=bm.verts)
            parts.append(c['mesh_object']('snowcap', bm, M['Snow'], smooth=True))
        return c['join'](parts, 'pine_snow')

    def bamboo(self):
        c, M = self.c, self.M
        r = random.Random(17)
        parts = []
        for k in range(7):
            x, y = (r.random() - 0.5) * 1.4, (r.random() - 0.5) * 1.4
            h = 4 + r.random() * 3
            st = c['curve_strand']('stalk', [(x, y, 0), (x + 0.1, y, h * 0.5), (x + 0.3, y + 0.1, h)], 0.07, 0.05, bulge=0, res=1, bevel_res=1)
            c['set_material'](st, M['Bamboo'])
            parts.append(st)
            for j in range(4):
                lf = c['curve_strand']('leaf', [(x + 0.2, y, h * (0.55 + j * 0.12)), (x + 0.2 + math.cos(j * 2.1) * 0.7, y + math.sin(j * 2.1) * 0.7, h * (0.55 + j * 0.12) - 0.25)],
                                       0.08, 0.01, bulge=0, res=1, bevel_res=1)
                c['set_material'](lf, M['LeavesGreen'])
                parts.append(lf)
        return c['join'](parts, 'bamboo')

    World.snowy_pine = snowy_pine
    World.bamboo = bamboo

    # ------------------------------------------------------------ testi sui cartelli
    def text_board(self, name, text, gx, gy, gz, facing, w=3.2, h=0.9, style='wood'):
        c = self.c
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        vs = [bm.verts.new(p) for p in ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
        f = bm.faces.new(vs)
        for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uvl].uv = uv
        board = c['mesh_object'](name, bm, self.M['Board'], smooth=False)
        c['place'](board, gx, gy, gz, facing)
        self.L.setdefault('boardTexts', {})[name] = {'text': text, 'style': style, 'aspect': round(w / h, 3)}
        return board

    World.text_board = text_board

    # ------------------------------------------------------------ Borgo Medievale
    def house(self, name, gx, gz, facing, w, d, h, r):
        c, M = self.c, self.M
        y = H(gx, gz) - 0.2
        parts = [
            c['box']('plinth', (w + 0.3, d + 0.3, 0.7), (0, 0, 0.35), M['CastleStone'], bevel=0.05, segs=1),
            c['box']('walls', (w, d, h), (0, 0, h / 2 + 0.6), M['Plaster']),
        ]
        T = M['Timber']
        for sx in (-1, 1):
            for sy in (-1, 1):
                parts.append(c['box']('post', (0.26, 0.26, h), (sx * (w / 2), sy * (d / 2), h / 2 + 0.6), T))
        for z in (0.75, h * 0.55 + 0.6, h + 0.55):
            parts.append(c['box']('beamx', (w + 0.1, d + 0.06, 0.2), (0, 0, z), T))
        for sx in (-1, 1):  # croci di Sant'Andrea sul davanti
            br = c['box']('brace', (0.18, 0.1, h * 0.62), (0, 0, 0), T)
            br.data.transform(Matrix.Translation((sx * w * 0.3, -d / 2 - 0.04, h * 0.3 + 0.65)) @ Matrix.Rotation(sx * 0.6, 4, 'Y'))
            parts.append(br)
        parts.append(c['box']('door', (1.1, 0.14, 2.0), (0, -d / 2 - 0.05, 1.6), M['WoodDark']))
        for sx in (-1, 1):
            parts.append(c['box']('win', (0.8, 0.12, 0.8), (sx * w * 0.32, -d / 2 - 0.06, h * 0.75 + 0.6), M['WinAmber']))
            parts.append(c['box']('winside', (0.12, 0.8, 0.8), (sx * (w / 2 + 0.06), 0, h * 0.7 + 0.6), M['WinAmber']))
        rise = 1.6 + r.random() * 1.2
        parts.append(prism_roof(c, M['RoofRed'], w, d, h + 0.6, rise))
        parts.append(gables(c, M['Plaster'], w, d, h + 0.6, rise))
        parts.append(c['box']('chimney', (0.6, 0.6, rise + 1.0), (w * 0.28, d * 0.15, h + 0.6 + rise * 0.5), M['CastleStone']))
        o = c['static'](c['join'](parts, name))
        c['place'](o, gx, y, gz, facing)
        self.box_collider(gx, gz, w / 2 + 0.25, d / 2 + 0.25, facing)
        return o

    def build_medieval(self):
        c, M = self.c, self.M
        r = random.Random(1066)
        mx, mz = MEDIEVAL
        y0 = H(mx, mz)
        # pozzo al centro della piazza
        well = [
            c['lathe']('well', [(1.3, 0), (1.3, 0.9), (1.05, 0.9), (1.05, 0.2)], M['CastleStone'], segs=16, smooth=False),
            c['disc']('wellwater', 0, 1.05, 2, 16, M['Water'], z=0.6),
        ]
        for s in (-1, 1):
            well.append(c['box']('wpost', (0.18, 0.18, 2.4), (s * 1.1, 0, 1.2), M['Timber']))
        well.append(prism_roof(c, M['RoofRed'], 2.4, 1.6, 2.4, 0.8, ov=0.3, thick=0.1))
        well.append(c['cylinder']('bucket', 0.18, 0.15, 0.3, M['WoodDark'], segs=10, center=(0, 0, 1.3)))
        o = c['static'](c['join'](well, 'Well'))
        c['place'](o, mx, y0, mz)
        c['collider'](mx, mz, 1.5)
        # case attorno alla piazza
        to_plaza = math.atan2(-mx, -mz)
        k = 0
        for i in range(11):
            a = to_plaza + 0.45 + i * (2 * PI - 0.9) / 10
            d = 21 + r.random() * 6
            hx, hz = mx + math.sin(a) * d, mz + math.cos(a) * d
            if math.hypot(hx - CASTLE[0], hz - CASTLE[1]) < 32:
                continue
            w, dd, hh = r.uniform(5, 7.5), r.uniform(4.5, 6), r.uniform(3.2, 4.6)
            if k == 2:  # la taverna
                w, dd, hh = 10, 7, 4.8
            self.house(f'House_{k}', hx, hz, math.atan2(mx - hx, mz - hz), w, dd, hh, r)
            if k == 2:
                f = math.atan2(mx - hx, mz - hz)
                sx, sz = self.local(hx, hz, f, 0, dd / 2 + 0.25)
                self.text_board('Board_sign_tavern', 'Taverna del Drago Felice', sx, H(hx, hz) + hh + 0.3, sz, f, w=4.6, h=0.9)
                for t in (-1, 1):  # tavoli all'aperto
                    tx, tz = self.local(hx, hz, f, t * 3.2, dd / 2 + 3.2)
                    tab = c['static'](c['join']([c['box']('top', (1.6, 0.9, 0.08), (0, 0, 0.78), M['Wood']),
                                                 c['box']('leg', (0.14, 0.14, 0.75), (0, 0, 0.38), M['WoodDark'])], 'Table'))
                    c['place'](tab, tx, H(tx, tz), tz, f)
                    c['collider'](tx, tz, 0.8)
                    for s2 in (-1, 1):
                        bx, bz = self.local(tx, tz, f, 0, s2 * 1.0)
                        bench = c['static'](c['box']('tbench', (1.6, 0.35, 0.42), (0, 0, 0.21), M['WoodDark']))
                        c['place'](bench, bx, H(bx, bz), bz, f)
                        self.seat(bx, H(bx, bz), bz, f + (PI if s2 > 0 else 0))
            k += 1
        # torce
        parts = []
        for i in range(8):
            a = i / 8 * 2 * PI
            tx, tz = mx + math.sin(a) * 13, mz + math.cos(a) * 13
            p = c['G'](tx, H(tx, tz), tz)
            parts.append(c['cylinder']('tpost', 0.08, 0.1, 2.4, M['Timber'], segs=8, center=p))
            parts.append(c['cylinder']('bowl', 0.2, 0.12, 0.2, M['Metal'], segs=8, center=p + Vector((0, 0, 2.4))))
            parts.append(c['blob']('flame', 0.16, M['Lantern'], subdiv=1, rough=0.2, seed=i, squash=1.6))
            parts[-1].location = p + Vector((0, 0, 2.75))
            c['collider'](tx, tz, 0.15)
        c['static'](c['join'](parts, 'Torches'))
        self.build_castle()
        self.build_windmill()
        self.pad('Borgo Medievale', mx + 8, mz + 8, facing=to_plaza)
        self.L.setdefault('npcSpots', {})['medieval'] = [[round(mx + math.sin(a) * 8, 2), round(y0, 2), round(mz + math.cos(a) * 8, 2)] for a in (0.3, 1.4, 2.6, 3.7, 4.9, 5.8)]

    def build_castle(self):
        c, M = self.c, self.M
        cx, cz = CASTLE
        y = 6.4
        f = math.atan2(MEDIEVAL[0] - cx, MEDIEVAL[1] - cz)
        S = 18.0
        parts = []
        S_ = M['CastleStone']

        def wall(x0, y0, x1, y1):
            L = math.hypot(x1 - x0, y1 - y0)
            ang = math.atan2(y1 - y0, x1 - x0)
            w = c['box']('wall', (L, 2.0, 8.0), (0, 0, 4.0), S_)
            merl = []
            for k in range(int(L / 1.6)):
                merl.append(c['box']('merlon', (0.8, 2.0, 0.9), (-L / 2 + 0.8 + k * 1.6, 0, 8.45), S_))
            o = c['join']([w] + merl, 'w')
            o.data.transform(Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, 0)) @ Matrix.Rotation(ang, 4, 'Z'))
            parts.append(o)
            # collisione (coordinate locali del castello -> gioco)
            mx_, my_ = (x0 + x1) / 2, (y0 + y1) / 2
            gx, gz = self.local(cx, cz, f, mx_, -my_)
            self.box_collider(gx, gz, L / 2, 1.0, f - ang)

        gate = 3.0
        wall(-S, -S, -gate, -S)
        wall(gate, -S, S, -S)
        wall(-S, S, S, S)
        wall(-S, -S, -S, S)
        wall(S, -S, S, S)
        parts.append(c['box']('gatetop', (2 * gate + 1, 2.4, 2.4), (0, -S, 7.2), S_))
        parts.append(c['box']('portcullis', (2 * gate, 0.25, 1.6), (0, -S - 0.4, 5.6), M['Metal']))
        for sx in (-1, 1):
            for sy in (-1, 1):
                px, py = sx * S, sy * S
                parts.append(c['cylinder']('tower', 3.3, 3.0, 13, S_, segs=16, center=(px, py, 0)))
                parts.append(c['cylinder']('ring', 3.6, 3.6, 0.6, S_, segs=16, center=(px, py, 12.6)))
                parts.append(c['cylinder']('cone', 3.8, 0.05, 5.5, M['RoofBlue'], segs=16, center=(px, py, 13.2), smooth=False))
                parts.append(c['box']('flag', (0.06, 1.4, 0.9), (px, py + 0.7, 20.2), M['BannerRed']))
                parts.append(c['cylinder']('pole', 0.05, 0.05, 2.5, M['Metal'], segs=6, center=(px, py, 18.4)))
                gx, gz = self.local(cx, cz, f, px, -py)
                c['collider'](gx, gz, 3.4)
        # mastio
        parts.append(c['box']('keep', (12, 9, 15), (0, 7, 7.5), S_, bevel=0.1, segs=1))
        for k in range(8):
            parts.append(c['box']('kmerlon', (0.9, 9.0, 1.0), (-5.4 + k * 1.55, 7, 15.5), S_))
        parts.append(c['cylinder']('ktower', 2.6, 2.4, 21, S_, segs=16, center=(4.5, 9.5, 0)))
        parts.append(c['cylinder']('kcone', 3.1, 0.05, 6, M['RoofBlue'], segs=16, center=(4.5, 9.5, 21), smooth=False))
        parts.append(c['box']('kdoor', (2.4, 0.3, 3.4), (0, 2.4, 1.7), M['WoodDark']))
        for sx in (-3.5, 3.5):
            parts.append(c['box']('banner', (1.4, 0.08, 4.2), (sx, 2.42, 9.5), M['BannerBlue']))
            parts.append(c['box']('emblem', (0.6, 0.1, 0.6), (sx, 2.38, 10.2), M['Gold']))
            parts.append(c['box']('kwin', (1.0, 0.12, 1.4), (sx, 2.42, 5.5), M['WinAmber']))
        o = c['static'](c['join'](parts, 'Castle'))
        c['place'](o, cx, y - 0.2, cz, f)
        gx, gz = self.local(cx, cz, f, 0, -7)
        self.box_collider(gx, gz, 6, 4.5, f)
        gx, gz = self.local(cx, cz, f, 4.5, -9.5)
        c['collider'](gx, gz, 2.6)
        bx, bz = self.local(cx, cz, f, 0, S + 4)
        self.text_board('Board_sign_castle', 'Castello di Roccalta', bx, H(bx, bz) + 2.2, bz, f, w=4.2, h=0.9, style='stone')
        c['collider'](bx, bz, 0.3)
        post = c['static'](c['box']('signpost', (0.2, 0.2, 2.6), (0, 0.15, 1.3), M['Timber']))
        c['place'](post, bx, H(bx, bz), bz, f)

    def build_windmill(self):
        c, M = self.c, self.M
        wx, wz = MEDIEVAL[0] + 34, MEDIEVAL[1] - 26
        y = H(wx, wz)
        f = math.atan2(-wx, -wz)
        parts = [c['lathe']('tower', [(3.4, 0), (3.0, 3), (2.4, 8.5), (2.2, 9.0), (0.01, 9.0)], M['Plaster'], segs=12, smooth=False),
                 c['cylinder']('cap', 2.6, 0.05, 3.0, M['RoofRed'], segs=12, center=(0, 0, 9.0), smooth=False),
                 c['box']('door', (1.2, 0.2, 2.0), (0, -3.25, 1.0), M['WoodDark']),
                 c['cylinder']('axle', 0.25, 0.25, 1.4, M['Timber'], segs=8, center=(0, -2.4, 9.3))]
        parts[-1].data.transform(Matrix.Translation((0, -2.4, 9.3)) @ Matrix.Rotation(PI / 2, 4, 'X') @ Matrix.Translation((0, 2.4, -9.3)))
        o = c['static'](c['join'](parts, 'Windmill'))
        c['place'](o, wx, y, wz, f)
        c['collider'](wx, wz, 3.4)
        blades = []
        for k in range(4):
            bl = c['box']('blade', (1.3, 0.12, 6.2), (0.3, 0, 3.3), M['Canvas'])
            spar = c['box']('spar', (0.16, 0.16, 7.0), (0, 0, 3.4), M['Timber'])
            b = c['join']([bl, spar], 'b')
            b.data.transform(Matrix.Rotation(k * PI / 2, 4, 'Y'))
            tint(b, (0.95, 0.9, 0.8))
            blades.append(b)
        hub = c['cylinder']('hub', 0.5, 0.5, 0.5, M['Timber'], segs=10)
        hub.data.transform(Matrix.Rotation(PI / 2, 4, 'X'))
        blades.append(hub)
        bo = c['join'](blades, 'Windmill_blades')
        bx, bz = self.local(wx, wz, f, 0, 3.1)
        c['place'](bo, bx, y + 9.3, bz, f)
        # campo di grano
        r = random.Random(4)
        rows = []
        for k in range(10):
            rx, rz = self.local(wx, wz, f, -8 - k * 1.3, -4)
            row = c['box']('wheat', (0.7, 14, 0.9), (0, 0, 0.45), M['Canvas'])
            row.data.transform(Matrix.Rotation(f, 4, 'Z'))
            row.location = c['G'](rx, H(rx, rz), rz)
            tint(row, (0.95, 0.8 + r.random() * 0.1, 0.35))
            rows.append(row)
        c['static'](c['join'](rows, 'WheatField'))

    World.house = house
    World.build_medieval = build_medieval
    World.build_castle = build_castle
    World.build_windmill = build_windmill

    # ------------------------------------------------------------ Città d'Oriente
    def east_house(self, name, gx, gz, facing, w, d, h):
        c, M = self.c, self.M
        y = H(gx, gz)
        parts = [c['box']('base', (w + 0.8, d + 0.8, 0.5), (0, 0, 0.25), M['CastleStone'], bevel=0.04, segs=1),
                 c['box']('walls', (w, d, h), (0, 0, h / 2 + 0.5), M['Plaster'])]
        for sx in (-1, 0, 1):
            for sy in (-1, 1):
                parts.append(c['cylinder']('col', 0.2, 0.2, h, M['Lacquer'], segs=10, center=(sx * w / 2, sy * d / 2, 0.5)))
        parts.append(c['box']('beam', (w + 0.3, d + 0.3, 0.3), (0, 0, h + 0.4), M['Lacquer']))
        parts.append(c['box']('door', (1.6, 0.14, 2.2), (0, -d / 2 - 0.05, 1.6), M['Lacquer']))
        for sx in (-1, 1):
            parts.append(c['box']('lattice', (1.3, 0.12, 1.1), (sx * w * 0.3, -d / 2 - 0.06, h * 0.6 + 0.5), M['WinAmber']))
        parts.append(curved_roof(c, M['RoofJade'], w, d, h + 0.55, 1.8))
        parts.append(c['box']('ridge', (w + 1.6, 0.35, 0.3), (0, 0, h + 2.45), M['Gold']))
        o = c['static'](c['join'](parts, name))
        c['place'](o, gx, y, gz, facing)
        self.box_collider(gx, gz, w / 2 + 0.4, d / 2 + 0.4, facing)
        return o

    def build_east(self):
        c, M = self.c, self.M
        cx, cz = CHINA
        f = math.atan2(-cx, -cz)  # verso la piazza
        y0 = H(cx, cz)
        # porta monumentale
        gx, gz = self.local(cx, cz, f, 0, 38)
        parts = []
        for lx, hh in ((-6.5, 6.0), (-2.6, 7.5), (2.6, 7.5), (6.5, 6.0)):
            parts.append(c['cylinder']('pillar', 0.45, 0.45, hh, M['Lacquer'], segs=12, center=(lx, 0, 0)))
            parts.append(c['cylinder']('pbase', 0.75, 0.8, 0.6, M['CastleStone'], segs=8, center=(lx, 0, 0)))
            px, pz = self.local(gx, gz, f, lx, 0)
            c['collider'](px, pz, 0.6)
        parts.append(c['box']('beam1', (15, 0.8, 0.6), (0, 0, 5.6), M['Lacquer']))
        parts.append(c['box']('beam2', (7, 0.8, 0.6), (0, 0, 7.2), M['Lacquer']))
        roof1 = curved_roof(c, M['RoofJade'], 13, 1.6, 6.0, 1.0, ov=0.8)
        roof2 = curved_roof(c, M['RoofJade'], 6, 1.6, 7.6, 1.2, ov=0.8)
        parts += [roof1, roof2]
        gate = c['static'](c['join'](parts, 'EastGate'))
        c['place'](gate, gx, H(gx, gz), gz, f)
        self.text_board('Board_sign_east', "Porta d'Oriente", gx, H(gx, gz) + 6.4, gz + 0.0, f, w=3.6, h=0.9, style='east')
        # pagoda
        px, pz = self.local(cx, cz, f, 0, -16)
        parts = [c['cylinder']('base', 7.2, 7.6, 1.0, M['CastleStone'], segs=8, smooth=False)]
        z = 1.0
        for i in range(5):
            rr = 4.6 - i * 0.75
            hh = 3.4 - i * 0.25
            parts.append(c['cylinder']('tier', rr, rr * 0.96, hh, M['Lacquer'], segs=8, center=(0, 0, z), smooth=False))
            for k in range(8):
                a = k / 8 * 2 * PI + PI / 8
                parts.append(c['box']('win', (0.7, 0.12, 1.0), (math.cos(a) * rr * 0.97, math.sin(a) * rr * 0.97, z + hh * 0.55), M['WinAmber']))
                parts[-1].data.transform(Matrix.Translation((math.cos(a) * rr * 0.97, math.sin(a) * rr * 0.97, z + hh * 0.55)) @ Matrix.Rotation(a + PI / 2, 4, 'Z') @ Matrix.Translation((-math.cos(a) * rr * 0.97, -math.sin(a) * rr * 0.97, -(z + hh * 0.55))))
            z += hh
            parts.append(flared_roof(c, M['RoofJade'], rr, z - 0.2))
            z += 0.9
        parts.append(c['lathe']('spire', [(0.01, z), (0.4, z + 0.3), (0.15, z + 1.0), (0.35, z + 1.4), (0.12, z + 2.0), (0.01, z + 3.4)], M['Gold'], segs=12))
        pag = c['static'](c['join'](parts, 'Pagoda'))
        c['place'](pag, px, H(px, pz), pz, f)
        c['collider'](px, pz, 4.8)
        c['platform'](px, pz, 7.4, H(px, pz) + 1.0)
        # case lungo il viale
        k = 0
        for lz in (24, 10):
            for side in (-1, 1):
                hx, hz = self.local(cx, cz, f, side * 14, lz)
                if math.hypot(hx - POND[0], hz - POND[1]) < 17:
                    continue
                self.east_house(f'EastHouse_{k}', hx, hz, f + side * PI / 2, 9, 6, 3.4)
                k += 1
        for lz in (-4,):
            for side in (-1, 1):
                hx, hz = self.local(cx, cz, f, side * 16, lz)
                if math.hypot(hx - POND[0], hz - POND[1]) < 17:
                    continue
                self.east_house(f'EastHouse_{k}', hx, hz, f + side * PI / 2, 8, 6, 3.2)
                k += 1
        # lanterne rosse lungo il viale
        parts = []
        for lz in range(-4, 36, 6):
            for side in (-1, 1):
                lx_, lz_ = self.local(cx, cz, f, side * 5.5, lz)
                p = c['G'](lx_, H(lx_, lz_), lz_)
                parts.append(c['cylinder']('lpost', 0.08, 0.1, 3.0, M['Lacquer'], segs=8, center=p))
                parts.append(c['box']('larm', (0.1, 0.1, 0.1), p + Vector((0, 0, 3.0)), M['Lacquer']))
                lan = c['blob']('lantern', 0.32, M['LanternRed'], subdiv=2, rough=0.0, seed=lz, squash=1.25)
                lan.location = p + Vector((0, 0, 2.55))
                parts.append(lan)
                parts.append(c['cylinder']('lcap', 0.18, 0.18, 0.08, M['Gold'], segs=8, center=p + Vector((0, 0, 2.95))))
                c['collider'](lx_, lz_, 0.15)
        c['static'](c['join'](parts, 'EastLanterns'))
        # laghetto con ponte ad arco
        water = c['disc']('Water_pond', 0, 11.5, 6, 64, M['Water'])
        water.location = c['G'](POND[0], 0.15, POND[1])
        bf = math.atan2(cx - POND[0], cz - POND[1]) + PI / 2
        deck = []
        n = 12
        L = 16.0
        for i in range(n):
            t = (i + 0.5) / n - 0.5
            top = 0.55 + 1.3 * (1 - (2 * t) ** 2)
            seg = c['box']('deck', (2.6, L / n + 0.02, 0.18), (0, t * L, top - 0.09), M['Lacquer'])
            deck.append(seg)
            for s in (-1, 1):
                deck.append(c['box']('rail', (0.1, L / n + 0.02, 0.1), (s * 1.25, t * L, top + 0.75), M['Lacquer']))
                deck.append(c['box']('rpost', (0.12, 0.12, 0.8), (s * 1.25, t * L, top + 0.35), M['Lacquer']))
            bx, bz = self.local(POND[0], POND[1], bf, 0, t * L * -1)
            self.box_platform(bx, bz, 1.3, L / n / 2 + 0.05, bf, top)
        br = c['static'](c['join'](deck, 'Bridge'))
        c['place'](br, POND[0], 0, POND[1], bf)
        for s in (-1, 1):
            for i in range(n):
                t = (i + 0.5) / n - 0.5
                bx, bz = self.local(POND[0], POND[1], bf, s * 1.45, -t * L)
                c['collider'](bx, bz, 0.12)
        # sala da tè con sedute vicino al laghetto
        tx, tz = POND[0] + 16, POND[1] + 4
        tf = math.atan2(POND[0] - tx, POND[1] - tz)
        parts = [c['box']('floor', (7, 5, 0.4), (0, 0, 0.2), M['Wood'])]
        for sx in (-1, 1):
            for sy in (-1, 1):
                parts.append(c['cylinder']('col', 0.16, 0.16, 3.0, M['Lacquer'], segs=8, center=(sx * 3.2, sy * 2.2, 0.4)))
        parts.append(curved_roof(c, M['RoofJade'], 6.4, 4.4, 3.3, 1.4))
        th = c['static'](c['join'](parts, 'TeaHouse'))
        c['place'](th, tx, H(tx, tz), tz, tf)
        self.box_platform(tx, tz, 3.5, 2.5, tf, H(tx, tz) + 0.4)
        for s in (-1.2, 1.2):
            sx, sz = self.local(tx, tz, tf, s, 1.2)
            self.seat(sx, H(tx, tz) + 0.4 - 0.45 + 0.45, sz, tf)
        # bambù e ciliegi
        r = random.Random(88)
        placed = 0
        while placed < 70:
            a = r.random() * 2 * PI
            d = 34 + r.random() * 18
            x, z = cx + math.sin(a) * d, cz + math.cos(a) * d
            if road_dist(x, z) < 5 or math.hypot(x, z) > BOUNDS - 3:
                continue
            self.add_instance('bamboo', x, z, scale=0.8 + r.random() * 0.5)
            c['collider'](x, z, 0.8)
            placed += 1
        for k in range(10):
            a = r.random() * 2 * PI
            x, z = POND[0] + math.sin(a) * 14, POND[1] + math.cos(a) * 14
            if math.hypot(x - tx, z - tz) < 6:
                continue
            self.add_instance('sakura', x, z, scale=0.9 + r.random() * 0.3)
            c['collider'](x, z, 0.35)
        ex, ez = self.local(cx, cz, f, 6, 30)
        self.pad("Città d'Oriente", ex, ez, facing=f)
        self.L.setdefault('npcSpots', {})['east'] = [[round(x, 2), round(H(x, z), 2), round(z, 2)] for x, z in
                                                    [self.local(cx, cz, f, lx, lz) for lx, lz in ((0, 30), (0, 18), (0, 6), (2, -6), (-2, 12), (1, 24))]]

    World.east_house = east_house
    World.build_east = build_east

    # ------------------------------------------------------------ Valle Innevata
    def build_snow(self):
        c, M = self.c, self.M
        sx, sz = SNOW
        f = math.atan2(-sx, -sz)
        y0 = H(sx, sz)
        # baita
        bx, bz = self.local(sx, sz, f, 0, -12)
        W, D, Hh = 12.0, 9.0, 4.5
        parts = [c['box']('base', (W + 0.6, D + 0.6, 0.8), (0, 0, 0.4), M['CastleStone'], bevel=0.05, segs=1)]
        for k in range(14):
            z = 0.95 + k * 0.3
            for (lx, ly, ln, rot) in ((0, -D / 2, W + 0.6, 'Y'), (0, D / 2, W + 0.6, 'Y'), (-W / 2, 0, D + 0.6, 'X'), (W / 2, 0, D + 0.6, 'X')):
                lg = c['cylinder']('wall', 0.17, 0.17, ln, M['Bark'] if k % 2 else M['WoodDark'], segs=8)
                lg.data.transform(Matrix.Translation((lx, ly, z)) @ Matrix.Rotation(PI / 2, 4, rot) @ Matrix.Translation((0, 0, -ln / 2)))
                parts.append(lg)
        parts.append(prism_roof(c, M['WoodDark'], W, D, Hh + 0.8, 3.2, ov=1.0, thick=0.3))
        parts.append(prism_roof(c, M['Snow'], W, D, Hh + 1.12, 3.2, ov=1.05, thick=0.25))
        parts.append(gables(c, M['WoodDark'], W, D, Hh + 0.8, 3.2))
        parts.append(c['box']('door', (1.6, 0.15, 2.4), (0, -D / 2 - 0.1, 2.0), M['WoodDark']))
        for k2 in (-3.5, -1.8, 1.8, 3.5):
            parts.append(c['box']('win', (1.0, 0.12, 1.1), (k2, -D / 2 - 0.12, 2.6), M['WinAmber']))
        parts.append(c['box']('chimney', (0.9, 0.9, 3.4), (3.5, 1.5, Hh + 3.2), M['CastleStone']))
        parts.append(c['box']('balcony', (W, 1.6, 0.2), (0, -D / 2 - 0.8, Hh + 0.6), M['Wood']))
        o = c['static'](c['join'](parts, 'Chalet'))
        c['place'](o, bx, H(bx, bz) - 0.2, bz, f)
        self.box_collider(bx, bz, W / 2 + 0.3, D / 2 + 0.3, f)
        tb = self.local(bx, bz, f, 0, D / 2 + 1.7)
        self.text_board('Board_sign_chalet', 'Baita del Fiocco', tb[0], H(bx, bz) + Hh + 1.6, tb[1], f, w=4.0, h=0.9)
        for s in (-3.5, 3.5):
            px, pz = self.local(bx, bz, f, s, D / 2 + 3.2)
            b = c['bench_mesh']()
            b.name = 'SnowBench'
            c['place'](b, px, H(px, pz), pz, f)
            c['static'](b)
            for s2 in (-0.5, 0.5):
                qx, qz = self.local(px, pz, f, s2, 0.02)
                self.seat(qx, H(px, pz), qz, f)
            c['collider'](px, pz, 0.6)
        # igloo
        ix, iz = self.local(sx, sz, f, -14, 6)
        ig = [c['lathe']('dome', [(3.0, 0), (2.9, 0.8), (2.5, 1.7), (1.7, 2.5), (0.8, 2.9), (0.01, 3.0)], M['Snow'], segs=20)]
        tun = c['cylinder']('tunnel', 1.0, 1.0, 1.8, M['Snow'], segs=12)
        tun.data.transform(Matrix.Translation((0, -3.0, 0.2)) @ Matrix.Rotation(PI / 2, 4, 'X') @ Matrix.Translation((0, 0, -0.9)))
        ig.append(tun)
        ig.append(c['box']('door', (1.1, 0.1, 1.2), (0, -3.95, 0.6), M['Dark']))
        o = c['static'](c['join'](ig, 'Igloo'))
        c['place'](o, ix, H(ix, iz), iz, f)
        c['collider'](ix, iz, 3.1)
        # pupazzi di neve
        for k in range(4):
            a = 0.8 + k * 1.4
            px, pz = sx + math.sin(a) * 10, sz + math.cos(a) * 10
            if math.hypot(px - bx, pz - bz) < 9 or math.hypot(px - ix, pz - iz) < 5:
                continue
            p = [c['blob']('s1', 0.65, M['Snow'], subdiv=2, rough=0.03, seed=k),
                 c['blob']('s2', 0.47, M['Snow'], subdiv=2, rough=0.03, seed=k + 9),
                 c['blob']('s3', 0.34, M['Snow'], subdiv=2, rough=0.03, seed=k + 19)]
            p[0].location = (0, 0, 0.55)
            p[1].location = (0, 0, 1.4)
            p[2].location = (0, 0, 2.05)
            for s in (-1, 1):
                e = c['blob']('eye', 0.05, M['Dark'], subdiv=1, rough=0, seed=1)
                e.location = (s * 0.11, -0.3, 2.13)
                p.append(e)
                arm = c['curve_strand']('arm', [(s * 0.4, 0, 1.5), (s * 0.8, 0, 1.8), (s * 1.0, 0, 2.0)], 0.03, 0.015, bulge=0, res=1, bevel_res=1)
                c['set_material'](arm, M['Bark'])
                p.append(arm)
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.06, radius2=0.0, depth=0.3)
            bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(PI / 2, 3, 'X'), verts=bm.verts)
            bmesh.ops.translate(bm, vec=(0, -0.45, 2.03), verts=bm.verts)
            p.append(c['mesh_object']('nose', bm, M['Carrot']))
            scarf = c['lathe']('scarf', [(0.36, 1.68), (0.38, 1.75), (0.38, 1.82), (0.35, 1.86)], M['BannerRed'], segs=16)
            p.append(scarf)
            o = c['static'](c['join'](p, f'Snowman_{k}'))
            c['place'](o, px, H(px, pz), pz, math.atan2(-px + sx, -pz + sz) + PI)
            c['collider'](px, pz, 0.7)
        # laghetto ghiacciato su cui si scivola
        ice = c['disc']('Ice', 0, 16, 4, 64, M['Ice'])
        ice.location = c['G'](ICE[0], 1.24, ICE[1])
        c['platform'](ICE[0], ICE[1], 16, 1.26)
        self.L['ice'] = {'x': ICE[0], 'z': ICE[1], 'r': 16}
        # lampioni
        parts = []
        for k in range(10):
            a = k / 10 * 2 * PI
            lx, lz = sx + math.sin(a) * 22, sz + math.cos(a) * 22
            if road_dist(lx, lz) < 3:
                continue
            p = c['G'](lx, H(lx, lz), lz)
            parts.append(c['cylinder']('lp', 0.08, 0.1, 3.2, M['Metal'], segs=8, center=p))
            parts.append(c['cylinder']('lamp', 0.22, 0.18, 0.4, M['Lantern'], segs=6, center=p + Vector((0, 0, 3.2)), smooth=False))
            parts.append(c['cylinder']('lcap', 0.32, 0.02, 0.25, M['Snow'], segs=6, center=p + Vector((0, 0, 3.6)), smooth=False))
            c['collider'](lx, lz, 0.15)
        c['static'](c['join'](parts, 'SnowLamps'))
        # abeti innevati (istanze)
        r = random.Random(2025)
        placed = 0
        tries = 0
        while placed < 150 and tries < 5000:
            tries += 1
            a = r.random() * 2 * PI
            d = 26 + math.sqrt(r.random()) * 75
            x, z = sx + math.sin(a) * d, sz + math.cos(a) * d
            if math.hypot(x, z) > BOUNDS - 2 or road_dist(x, z) < 4 or math.hypot(x - ICE[0], z - ICE[1]) < 19:
                continue
            if math.hypot(x - bx, z - bz) < 11 or math.hypot(x - ix, z - iz) < 5:
                continue
            sc = 0.9 + r.random() * 0.8
            self.add_instance('pine_snow', x, z, scale=sc)
            c['collider'](x, z, 0.35 * sc)
            placed += 1
        px, pz = self.local(sx, sz, f, 7, 6)
        self.pad('Valle Innevata', px, pz, facing=f)
        self.L.setdefault('npcSpots', {})['snow'] = [[round(x, 2), round(H(x, z), 2), round(z, 2)] for x, z in
                                                    ((sx + 3, sz + 2), (sx - 4, sz - 2), (ICE[0] + 4, ICE[1] - 3), (ICE[0] - 5, ICE[1] + 2), (sx + 8, sz - 4))]

    World.build_snow = build_snow

    # ------------------------------------------------------------ piazza: negozi e decorazioni
    def build_plaza_extras(self):
        c, M = self.c, self.M
        shops = [('veicoli', 'Garage Turbo', 60, (0.3, 0.75, 1.0)), ('effetti', 'Magie & Scie', 120, (0.75, 0.45, 1.0)),
                 ('snack', 'Gelati Stellari', 240, (1.0, 0.55, 0.7)), ('animali', 'Amici Pelosi', 300, (1.0, 0.75, 0.35))]
        self.L['shops'] = {}
        for sid, title, deg, color in shops:
            a = math.radians(deg)
            gx, gz = math.sin(a) * 19.0, math.cos(a) * 19.0
            f = a + PI  # guarda il centro della piazza
            # chiosco fantascientifico: bancone in metallo, pannello scuro con cornice luminosa, tettoia sospesa
            parts = [c['box']('counter', (3.4, 0.9, 1.05), (0, -0.6, 0.53), M['Hull'], bevel=0.08, segs=2),
                     c['box']('countertop', (3.6, 1.1, 0.08), (0, -0.6, 1.08), M['HullDark']),
                     c['box']('counterglow', (3.42, 0.05, 0.06), (0, -1.07, 0.9), M['GlowCyan']),
                     c['box']('back', (3.6, 0.25, 2.9), (0, 1.1, 1.45), M['HullDark'], bevel=0.05, segs=1)]
            panel = c['box']('panel', (3.0, 0.06, 1.6), (0, 0.96, 1.9), M['Canvas'])
            tint(panel, tuple(0.35 + 0.65 * x for x in color))
            parts.append(panel)
            for sx in (-1, 1):
                parts.append(c['box']('frameglow', (0.06, 0.08, 2.7), (sx * 1.78, 0.98, 1.45), M['GlowCyan']))
                parts.append(c['box']('pillar', (0.22, 0.22, 3.2), (sx * 1.85, 1.1, 1.6), M['Hull'], bevel=0.04, segs=1))
            parts.append(c['box']('canopy', (4.2, 2.7, 0.14), (0, -0.2, 3.25), M['Hull'], bevel=0.05, segs=1))
            parts.append(c['box']('canopyglow', (4.22, 0.06, 0.06), (0, -1.55, 3.22), M['GlowCyan']))
            for sx in (-1, 1):  # piedistalli per mostrare la merce
                parts.append(c['cylinder']('ped', 0.42, 0.5, 0.8, M['Stone'], segs=16, center=(sx * 2.6, -1.9, 0)))
                parts.append(c['cylinder']('pedglow', 0.44, 0.44, 0.04, M['GlowCyan'], segs=16, center=(sx * 2.6, -1.9, 0.8), smooth=False))
            o = c['static'](c['join'](parts, f'Shop_{sid}'))
            c['place'](o, gx, 0, gz, f)
            sxp, szp = self.local(gx, gz, f, 0, -1.08)
            self.text_board(f'Board_shop_{sid}', title, sxp, 3.65, szp, f, w=3.2, h=0.8, style='shop')
            self.box_collider(*self.local(gx, gz, f, 0, 0.1), 1.9, 1.25, f)
            displays = []
            for sx in (-1, 1):
                dx, dz = self.local(gx, gz, f, sx * 2.6, 1.9)
                c['collider'](dx, dz, 0.55)
                displays.append([round(dx, 3), 0.84, round(dz, 3)])
            kx, kz = self.local(gx, gz, f, 0, 0.35)
            ix, iz = self.local(gx, gz, f, 0, 1.9)
            self.L['shops'][sid] = {'title': title, 'displays': displays, 'keeper': [round(kx, 3), 0, round(kz, 3), round(f, 4)]}
            self.L['interactables'].append({'type': 'shop', 'shop': sid, 'point': [round(ix, 3), 0, round(iz, 3)], 'radius': 1.8, 'label': title})
        # fioriere e stendardi attorno alla piazza
        parts = []
        for k in range(24):
            a = k / 24 * 2 * PI + 0.13
            deg = math.degrees(a) % 360
            if any(abs((deg - d + 180) % 360 - 180) < 9 for d in (30, 90, 150, 210, 270, 330, 0, 180, 60, 120, 240, 300)):
                continue
            px, pz = math.sin(a) * 22.6, math.cos(a) * 22.6
            planter = c['lathe']('planter', [(0.95, 0), (1.0, 0.1), (1.0, 0.55), (0.92, 0.6), (0.85, 0.5)], M['HullDark'], segs=24)
            planter.location = c['G'](px, 0, pz)
            parts.append(planter)
            rim = c['lathe']('prim', [(1.0, 0.56), (1.03, 0.58), (1.03, 0.62), (1.0, 0.64)], M['GlowCyan'], segs=24, smooth=False)
            rim.location = c['G'](px, 0, pz)
            parts.append(rim)
            plant = self.tropical_plant(k + 700)
            plant.location = c['G'](px, 0.5, pz)
            parts.append(plant)
            if k % 2 == 0:
                orb = c['blob']('orb', 0.32, M['OrbLamp'], subdiv=2, rough=0.0, seed=k)
                orb.location = c['G'](px + math.cos(a) * 0.55, 0.85, pz - math.sin(a) * 0.55)
                parts.append(orb)
                self.L.setdefault('orbs', []).append([round(px, 2), 0.95, round(pz, 2)])
            c['collider'](px, pz, 0.85)
        for d in (30, 90, 150, 210, 270, 330):
            for s in (-1, 1):
                a = math.radians(d) + s * 0.1
                px, pz = math.sin(a) * 23.4, math.cos(a) * 23.4
                p = c['G'](px, 0, pz)
                parts.append(c['cylinder']('fpole', 0.06, 0.08, 4.6, M['Metal'], segs=8, center=p))
                fl = c['box']('flag', (0.9, 0.05, 1.8), p + Vector((0, 0, 3.4)), M['BannerBlue'] if s > 0 else M['BannerRed'])
                fl.data.transform(Matrix.Translation(-p - Vector((0, 0, 3.4))))
                fl.data.transform(Matrix.Translation(p + Vector((0, 0, 3.4))) @ Matrix.Rotation(-a, 4, 'Z') @ Matrix.Translation((0.45, 0, 0)))
                parts.append(fl)
                c['collider'](px, pz, 0.12)
        c['static'](c['join'](parts, 'PlazaDecor'))
        spots = []
        for k in range(14):
            a = k / 14 * 2 * PI
            d = 13.5 + (k % 3) * 1.6
            spots.append([round(math.sin(a) * d, 2), 0.0, round(math.cos(a) * d, 2)])
        self.L.setdefault('npcSpots', {})['plaza'] = spots

    World.build_plaza_extras = build_plaza_extras

    # ------------------------------------------------------------ monete
    def scatter_coins(self):
        r = random.Random(777)
        coins = []
        tries = 0
        while len(coins) < 240 and tries < 20000:
            tries += 1
            a = r.random() * 2 * PI
            d = 6 + math.sqrt(r.random()) * (BOUNDS - 8)
            x, z = math.sin(a) * d, math.cos(a) * d
            h = H(x, z)
            if h < -0.5 or math.hypot(x - LAKE[0], z - LAKE[1]) < LAKE_R:
                continue
            if any(abs(x - b[0]) < b[2] + 0.5 and abs(z - b[1]) < b[3] + 0.5 for b in self.L['boxColliders'] if abs(b[4]) < 0.01):
                continue
            coins.append([round(x, 2), round(h + 1.1, 2), round(z, 2)])
        self.L['coins'] = coins

    World.scatter_coins = scatter_coins

    # punti dove passeggiano i personaggi negli altri quartieri
    def npc_spots_misc(self):
        sp = self.L.setdefault('npcSpots', {})
        sp['city'] = [[x, 0.45, z] for x, z in ((-8, -128), (8, -130), (0, -138), (-14, -126), (14, -140), (0, -120))]
        sp['lake'] = [[round(x, 2), round(H(x, z), 2), round(z, 2)] for x, z in ((70, 44), (75, 50), (66, 52), (80, 40))]
        sp['forest'] = [[round(x, 2), round(H(x, z), 2), round(z, 2)] for x, z in ((3, 120), (-4, 122), (6, 134), (-6, 132))]
        sp['stage'] = [[round(x, 2), 0.3, round(z, 2)] for x, z in ((86, -50), (90, -47), (82, -54), (88, -56))]

    World.npc_spots_misc = npc_spots_misc


def install_lobby(World):
    """Atrio fantascientifico sopra la piazza (ispirato a una hall futuristica)."""

    def tropical_plant(self, seed):
        c, M = self.c, self.M
        r = random.Random(seed)
        parts = []
        for k in range(9):
            a = k / 9 * 2 * PI + r.random() * 0.4
            L = 0.9 + r.random() * 0.7
            tilt = 0.5 + r.random() * 0.5
            p0 = Vector((0, 0, 0.05))
            p1 = Vector((math.cos(a) * L * 0.4, math.sin(a) * L * 0.4, L * 0.7 * tilt + 0.3))
            p2 = Vector((math.cos(a) * L, math.sin(a) * L, L * 0.45 * tilt + 0.1))
            leaf = c['curve_strand']('leaf', [p0, p1, p2], 0.11, 0.02, bulge=0.6, res=2, bevel_res=1)
            for v in leaf.data.vertices:  # foglia larga e piatta
                v.co.z = v.co.z * 0.85
            c['set_material'](leaf, M['Foliage'] if k % 3 else M['LeavesGreen'])
            parts.append(leaf)
        return c['join'](parts, 'plant')

    def arc_beam(self, name, angle, r0, r1, h, width, depth, mat, glow, n=28):
        """Trave curva (quarto di ellisse) da terra (raggio r0) fino all'anello centrale (raggio r1, altezza h)."""
        c = self.c
        bm = bmesh.new()
        ca, sa = math.sin(angle), math.cos(angle)  # direzione nel gioco: x = sin, z = cos
        rings = []
        for i in range(n + 1):
            t = i / n * (PI / 2)
            rr = r1 + (r0 - r1) * math.cos(t)
            y = h * math.sin(t)
            # tangente per orientare la sezione
            dr = -(r0 - r1) * math.sin(t)
            dy = h * math.cos(t)
            ln = math.hypot(dr, dy)
            nr, ny = -dy / ln, dr / ln  # normale nel piano verticale
            ring = []
            for sw, sd in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                off_r = nr * depth / 2 * sd
                off_y = ny * depth / 2 * sd
                gx = ca * (rr + off_r) + sa * 0 + (-sa) * 0
                gz = sa * (rr + off_r)
                # spostamento laterale (larghezza della trave)
                lx, lz = math.cos(angle) * width / 2 * sw, -math.sin(angle) * width / 2 * sw
                ring.append(bm.verts.new(c['G'](gx + lx, y + off_y, gz + lz)))
            rings.append(ring)
        for i in range(n):
            for q in range(4):
                q2 = (q + 1) % 4
                bm.faces.new([rings[i][q], rings[i][q2], rings[i + 1][q2], rings[i + 1][q]])
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        beam = c['mesh_object'](name, bm, mat, smooth=False)
        # striscia luminosa sul lato interno
        pts = []
        for i in range(n + 1):
            t = i / n * (PI / 2)
            rr = r1 + (r0 - r1) * math.cos(t) - 0.05
            y = h * math.sin(t) - depth / 2 - 0.02 if i else 0.3
            pts.append(c['G'](ca * rr, max(y, 0.3), sa * rr))
        strip = c['curve_strand']('strip', pts, 0.07, 0.07, bulge=0, res=2, bevel_res=1)
        c['set_material'](strip, glow)
        return c['join']([beam, strip], name)

    def screen(self, sid, label, gx, gz, w=8.0, h=4.2, base=3.2):
        c, M = self.c, self.M
        f = math.atan2(-gx, -gz)
        parts = [c['box']('frame', (w + 0.5, 0.5, h + 0.5), (0, 0.15, base + h / 2), M['HullDark'], bevel=0.08, segs=1),
                 c['box']('glowtop', (w + 0.52, 0.08, 0.08), (0, -0.12, base + h + 0.26), M['GlowCyan']),
                 c['box']('glowbot', (w + 0.52, 0.08, 0.08), (0, -0.12, base - 0.26), M['GlowCyan'])]
        for sx in (-1, 1):
            parts.append(c['box']('leg', (0.5, 0.5, base), (sx * (w / 2 - 0.6), 0.15, base / 2), M['Hull'], bevel=0.06, segs=1))
        o = c['static'](c['join'](parts, f'ScreenFrame_{sid}'))
        c['place'](o, gx, 0, gz, f)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        vs = [bm.verts.new(p) for p in ((-w / 2, -0.11, base), (w / 2, -0.11, base), (w / 2, -0.11, base + h), (-w / 2, -0.11, base + h))]
        face = bm.faces.new(vs)
        for loop, uv in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uvl].uv = uv
        scr = c['mesh_object'](f'Screen_{sid}', bm, M['Screen'], smooth=False)
        c['place'](scr, gx, 0, gz, f)
        for sx in (-1, 1):
            px, pz = self.local(gx, gz, f, sx * (w / 2 - 0.6), -0.15)
            c['collider'](px, pz, 0.45)
        ix, iz = self.local(gx, gz, f, 0, 2.6)
        self.L['interactables'].append({'type': 'screen', 'screen': sid, 'point': [round(ix, 2), 0, round(iz, 2)], 'radius': 3.0, 'label': label})
        self.L.setdefault('screens', {})[sid] = label

    def build_lobby(self):
        c, M = self.c, self.M
        # sei archi che salgono a un anello sospeso al centro
        H_TOP = 26.0
        R_TOP = 9.0
        R_FOOT = 28.0
        beams = []
        for k in range(6):
            a = math.radians(45 + 60 * k)
            beams.append(self.arc_beam(f'Arch_{k}', a, R_FOOT, R_TOP, H_TOP, 1.1, 1.4, M['Hull'], M['ArchGlow']))
            fx, fz = math.sin(a) * R_FOOT, math.cos(a) * R_FOOT
            foot = c['cylinder']('foot', 1.3, 1.6, 0.8, M['HullDark'], segs=16, center=c['G'](fx, 0, fz))
            beams.append(foot)
            c['collider'](fx, fz, 1.5)
        ring = c['lathe']('topring', [(R_TOP - 0.3, -0.7), (R_TOP + 1.2, -0.7), (R_TOP + 1.2, 0.7), (R_TOP - 0.3, 0.7)], M['Hull'], segs=96, smooth=False)
        ring.location = (0, 0, H_TOP)
        beams.append(ring)
        for z, rr in ((-0.72, R_TOP + 0.4), (0.72, R_TOP + 0.4)):
            gr = c['lathe']('ringglow', [(rr - 0.06, z), (rr + 0.06, z)], M['GlowCyan'], segs=96, smooth=False)
            gr.location = (0, 0, H_TOP)
            beams.append(gr)
        mid = c['lathe']('midring', [(19.6, -0.35), (20.4, -0.35), (20.4, 0.35), (19.6, 0.35)], M['Hull'], segs=128, smooth=False)
        mid.location = (0, 0, 14.0)
        beams.append(mid)
        mg = c['lathe']('midglow', [(19.55, -0.05), (19.55, 0.05)], M['GlowPink'], segs=128, smooth=False)
        mg.location = (0, 0, 14.0)
        beams.append(mg)
        c['static'](c['join'](beams, 'LobbyCanopy'))
        # stendardi appesi all'anello intermedio
        banners = []
        for k in range(6):
            a = math.radians(15 + 60 * k)
            px, pz = math.sin(a) * 20.0, math.cos(a) * 20.0
            b = c['box']('banner', (1.6, 0.06, 5.0), (0, 0, 0), M['BannerBlue'])
            em = c['lathe']('emblem', [(0.42, -0.04), (0.55, -0.04), (0.55, 0.04), (0.42, 0.04)], M['GlowCyan'], segs=24, smooth=False)
            em.data.transform(Matrix.Translation((0, -0.05, 0.9)) @ Matrix.Rotation(PI / 2, 4, 'X'))
            dot = c['box']('emdot', (0.24, 0.06, 0.24), (0, -0.05, 0.9), M['GlowCyan'])
            o = c['join']([b, em, dot], 'banner')
            c['place'](o, px, 11.0, pz, math.atan2(-px, -pz))
            banners.append(o)
        for b in banners:
            c['static'](b)
        # maxischermi: ESPLORA, GIOCA, CREA, SOCIAL
        for sid, label, deg in (('explore', 'Esplora', 255), ('play', 'Gioca', 195), ('create', 'Crea', 135), ('social', 'Social', 75)):
            a = math.radians(deg)
            self.screen(sid, label, math.sin(a) * 27.0, math.cos(a) * 27.0)
        # strisce di luce curve nel pavimento
        strips = []
        for k in range(12):
            a0 = math.radians(k * 30 + 8)
            pts = []
            for i in range(20):
                t = i / 19
                rr = 7.2 + t * 16.2
                aa = a0 + math.sin(t * PI) * 0.35 * (1 if k % 2 else -1)
                pts.append(c['G'](math.sin(aa) * rr, 0.08, math.cos(aa) * rr))
            st = c['curve_strand']('fstrip', pts, 0.045, 0.045, bulge=0, res=2, bevel_res=1)
            for v in st.data.vertices:
                v.co.z = max(v.co.z, 0.075)
            c['set_material'](st, M['GlowCyan'] if k % 3 else M['Lantern'])
            strips.append(st)
        c['join'](strips, 'FloorStrips')
        # logo olografico (disegnato nel gioco)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        W, Hh = 14.0, 6.0
        vs = [bm.verts.new(p) for p in ((-W / 2, 0, -Hh / 2), (W / 2, 0, -Hh / 2), (W / 2, 0, Hh / 2), (-W / 2, 0, Hh / 2))]
        face = bm.faces.new(vs)
        for loop, uv in zip(face.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uvl].uv = uv
        logo = c['mesh_object']('Logo_holo', bm, M['LogoScreen'], smooth=False)
        c['place'](logo, 0, 15.5, -11.0, 0.0)
        self.build_waterfall()

    def build_waterfall(self):
        c, M = self.c, self.M
        a = math.radians(112)
        gx, gz = math.sin(a) * 44, math.cos(a) * 44
        f = math.atan2(-gx, -gz)
        # roccia sospesa da cui cade l'acqua
        rock = c['blob']('wfrock', 5.5, M['Rock'], subdiv=3, rough=0.35, seed=4242, squash=0.55)
        for v in rock.data.vertices:
            if v.co.z < 0:
                v.co.z *= 2.4
        rock.data.update()
        rock.location = c['G'](gx, 19.0, gz)
        top = c['blob']('wftop', 5.2, M['Grass'], subdiv=3, rough=0.12, seed=4243, squash=0.12)
        top.location = c['G'](gx, 21.2, gz)
        parts = [rock, top]
        for k in range(3):
            p = self.tropical_plant(4300 + k)
            p.scale = (2.2, 2.2, 2.2)
            p.location = c['G'](gx + math.cos(k * 2.1) * 2.5, 21.4, gz + math.sin(k * 2.1) * 2.5)
            parts.append(p)
        isle = c['static'](c['join'](parts, 'WaterfallRock'))
        # vasca alla base con rocce
        pool = c['lathe']('pool', [(5.6, 0), (6.0, 0.15), (6.0, 0.6), (5.6, 0.7), (5.4, 0.3)], M['Rock'], segs=32, smooth=False)
        pool.location = c['G'](gx, 0, gz)
        c['static'](pool)
        water = c['disc']('Water_lake_pool', 0, 5.5, 4, 48, M['Water'])
        water.location = c['G'](gx, 0.42, gz)
        c['collider'](gx, gz, 6.0)
        # lama d'acqua verticale (animata nel gioco)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new('UVMap')
        W = 3.2
        n = 12
        verts = []
        for i in range(n + 1):
            t = i / n
            z = 0.4 + t * 17.2
            bow = math.sin(t * PI) * 0.6
            verts.append((bm.verts.new((-W / 2 * (1 - 0.3 * t), -bow, z)), bm.verts.new((W / 2 * (1 - 0.3 * t), -bow, z)), t))
        for i in range(n):
            a1, b1, t1 = verts[i]
            a2, b2, t2 = verts[i + 1]
            fce = bm.faces.new([a1, b1, b2, a2])
            for loop, uv in zip(fce.loops, ((0, t1), (1, t1), (1, t2), (0, t2))):
                loop[uvl].uv = uv
        wf = c['mesh_object']('Waterfall', bm, M['Waterfall'], smooth=True)
        wx, wz = self.local(gx, gz, f, 0, 0.5)
        c['place'](wf, wx, 0, wz, f)
        self.L['waterfall'] = [round(gx, 2), round(gz, 2)]

    World.tropical_plant = tropical_plant
    World.arc_beam = arc_beam
    World.screen = screen
    World.build_lobby = build_lobby
    World.build_waterfall = build_waterfall
