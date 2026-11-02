#!/usr/bin/env python3
"""Genera movil/compartido/fondos.json a partir de app/js/fondos.js, para las apps del móvil.

    python3 tools/fondos_movil.py

Las apps del móvil enseñan miniaturas de los fondos y, al tocar una, abren TV Libre con {fondo: id}.
Las fotos no van dentro de las apps: las miniaturas (320 x 180, ~15 KB) se piden a Unsplash al abrir esa
pestaña. Los minimalistas llevan sus dos colores principales para dibujarlos sin descargar nada.
"""
import json
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    with open(os.path.join(RAIZ, 'app', 'js', 'fondos.js'), encoding='utf-8') as f:
        codigo = f.read()
    fondos = []
    # Cada entrada empieza por "{ id:"; los minimalistas ocupan varias líneas
    for linea in re.split(r'(?=\{\s*id: )', codigo):
        m = re.match(r"\{\s*id: '([a-z0-9-]+)', nombre: '([^']+)', grupo: '([^']+)'", linea)
        if not m:
            continue
        id_, nombre, grupo = m.groups()
        fondo = {'id': id_, 'nombre': nombre, 'grupo': grupo}
        foto = re.search(r"foto: '([0-9a-f-]+)'", linea)
        if foto:
            fondo['miniatura'] = ('https://images.unsplash.com/photo-%s'
                                  '?w=320&h=180&fit=crop&crop=entropy&q=60&fm=jpg' % foto.group(1))
        else:
            oscuro = re.search(r"oscuro: '([^']+)'", linea)
            colores = re.findall(r'#[0-9a-fA-F]{6}', oscuro.group(1) if oscuro else '')
            fondo['colores'] = colores[:2] or ['#1c1c1e', '#2c2c2e']
        fondos.append(fondo)
    destino = os.path.join(RAIZ, 'movil', 'compartido', 'fondos.json')
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(fondos, f, ensure_ascii=False, indent=1)
    print('%d fondos en %s' % (len(fondos), os.path.relpath(destino, RAIZ)))


if __name__ == '__main__':
    main()
