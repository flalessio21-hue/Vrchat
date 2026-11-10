"""Utility condivise dagli script Blender (eseguiti con il modulo `bpy`)."""
import math
import bpy
import bmesh
from mathutils import Vector


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    return scene


def placeholder_image():
    """Piccola immagine bianca: serve solo a far esportare le UV (la texture vera la disegna il gioco)."""
    img = bpy.data.images.get('placeholder')
    if not img:
        img = bpy.data.images.new('placeholder', 4, 4, alpha=True)
        img.pixels = [1.0] * (4 * 4 * 4)
        img.file_format = 'PNG'
        img.pack()
    return img


def material(name, color=(0.8, 0.8, 0.8, 1), emissive=None, rough=0.6, metal=0.0, texture=False):
    """Materiale PBR semplice. Nel gioco i materiali vengono riconosciuti per nome."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if texture:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = placeholder_image()
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emissive:
        bsdf.inputs['Emission Color'].default_value = (*emissive[:3], 1)
        bsdf.inputs['Emission Strength'].default_value = emissive[3] if len(emissive) > 3 else 1.0
    return mat


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def mesh_object(name, bm, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    link(obj)
    if mat:
        obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def apply_modifiers(obj):
    """Applica tutti i modificatori tramite il depsgraph (niente operatori/contesto)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    bpy.data.meshes.remove(old)
    return obj


def skin_mesh(name, verts, edges, radii, mat, root=0, subdiv=2, smooth=True):
    """Corpo morbido da uno "scheletro" di vertici con raggi (modificatore Skin)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([Vector(v) for v in verts], edges, [])
    obj = bpy.data.objects.new(name, me)
    link(obj)
    mod = obj.modifiers.new('skin', 'SKIN')
    mod.use_smooth_shade = smooth
    mod.branch_smoothing = 0.6
    layer = obj.data.skin_vertices[0].data
    for i, r in enumerate(radii):
        layer[i].radius = r if isinstance(r, (tuple, list)) else (r, r)
        layer[i].use_root = i == root
    if subdiv:
        sub = obj.modifiers.new('sub', 'SUBSURF')
        sub.levels = subdiv
        sub.render_levels = subdiv
    apply_modifiers(obj)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = smooth
    return obj


def curve_strand(name, points, r0, r1, bulge=0.25, res=3, bevel_res=3):
    """Ciocca/coda affusolata: curva Bezier con raggio variabile, convertita in mesh."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = bevel_res
    cu.resolution_u = res + 4
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    n = len(points) - 1
    for i, p in enumerate(points):
        bp = sp.bezier_points[i]
        bp.co = Vector(p)
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
        t = i / n
        r = (r0 + (r1 - r0) * t) * (1 + math.sin(min(t * 3, 1) * math.pi) * bulge)
        bp.radius = max(r, 0.0005)
    obj = bpy.data.objects.new(name, cu)
    link(obj)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    bpy.data.curves.remove(cu)
    mobj = bpy.data.objects.new(name, me)
    link(mobj)
    for p in me.polygons:
        p.use_smooth = True
    return mobj


def join(objs, name):
    """Unisce più oggetti mesh in uno solo (senza operatori)."""
    objs = [o for o in objs if o]
    bm = bmesh.new()
    mats = []
    for o in objs:
        me = o.data
        offset_mats = {}
        for i, m in enumerate(me.materials):
            if m not in mats:
                mats.append(m)
            offset_mats[i] = mats.index(m)
        tmp = me.copy()
        tmp.transform(o.matrix_world)
        for p in tmp.polygons:
            p.material_index = offset_mats.get(p.material_index, 0)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    for o in objs:
        me = o.data
        bpy.data.objects.remove(o)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    link(obj)
    return obj


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0
    return obj


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
