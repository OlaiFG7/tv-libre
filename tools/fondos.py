#!/usr/bin/env python3
"""Descarga las fotos de fondo en app/fondos/ y prepara sus copias de vidrio.

    python3 tools/fondos.py

Así la TV no tiene que pedirlas a internet: cambiar de fondo es instantáneo y funciona sin red.
Lee la lista de js/fondos.js, pide cada foto a Unsplash a 1920 x 1080 (JPEG, calidad 75, ~400 KB)
y se salta las que ya estén descargadas. Fotos de unsplash.com con la licencia de Unsplash (uso libre).

Por cada foto crea también <id>-vidrio.jpg: 480 x 270, difuminada y más saturada (~10 KB).
Los paneles de vidrio y el reloj la estiran a pantalla completa, así que la TV no tiene que
difuminar nada al vuelo (idea de couch-tv, github.com/Seagey/couch-tv). Necesita Pillow para las
copias de vidrio; sin Pillow solo descarga y la app usa el difuminado de Unsplash por internet.
"""
import io
import os
import re
import sys
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARPETA = os.path.join(RAIZ, 'app', 'fondos')

try:
    from PIL import Image, ImageEnhance, ImageFilter
except ImportError:
    Image = None


def vidrio(origen, destino):
    with Image.open(origen) as foto:
        # Reducir primero: difuminar 480 px es 16 veces más barato que 1920, y al estirarla queda igual
        pequena = foto.convert('RGB').resize((480, 270), Image.LANCZOS)
    borrosa = pequena.filter(ImageFilter.GaussianBlur(14))
    borrosa = ImageEnhance.Color(borrosa).enhance(1.8)
    borrosa.save(destino, 'JPEG', quality=82, optimize=True, progressive=True)


def main():
    with open(os.path.join(RAIZ, 'app', 'js', 'fondos.js'), encoding='utf-8') as f:
        fotos = re.findall(r"id: '([a-z0-9-]+)'[^}]*?foto: '([0-9a-f-]+)'", f.read())
    if not fotos:
        sys.exit('No encuentro fotos en app/js/fondos.js')
    os.makedirs(CARPETA, exist_ok=True)
    total = 0
    for id_, foto in fotos:
        destino = os.path.join(CARPETA, id_ + '.jpg')
        if os.path.exists(destino):
            print('  ya está   ', id_)
        else:
            url = 'https://images.unsplash.com/photo-%s?w=1920&h=1080&fit=crop&crop=entropy&q=75&fm=jpg' % foto
            with urllib.request.urlopen(url, timeout=30) as r:
                if not r.headers.get('Content-Type', '').startswith('image/'):
                    sys.exit('Respuesta inesperada para %s' % id_)
                datos = r.read()
            with open(destino, 'wb') as f:
                f.write(datos)
            total += len(datos)
            print('  descargada', id_, '(%d KB)' % (len(datos) // 1024))
        copia = os.path.join(CARPETA, id_ + '-vidrio.jpg')
        if Image and not os.path.exists(copia):
            vidrio(destino, copia)
    if not Image:
        print('Aviso: sin Pillow no se crean las copias de vidrio (pip install Pillow).')
    print('Listo: %d fotos en app/fondos/ (%d KB nuevos)' % (len(fotos), total // 1024))


if __name__ == '__main__':
    main()
