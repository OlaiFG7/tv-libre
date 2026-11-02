#!/usr/bin/env python3
"""Recorta el primer plano de cada foto (montañas, edificios, árboles) para que tape el reloj.

    python3 tools/profundidad.py              # crea app/fondos/<id>-frente.webp
    python3 tools/profundidad.py --muestra    # además, una hoja de prueba en la carpeta temporal

Es el efecto de la pantalla de bloqueo de Apple: el reloj queda detrás de las cumbres. La app dibuja
la foto, luego el reloj y luego este recorte (la foto con el cielo transparente) encima.

Cómo encuentra el cielo (método "grown sky" de couch-tv, github.com/Seagey/couch-tv, sin IA):
crece desde el borde de arriba; un píxel es cielo si su color se parece al del cielo que tiene
justo encima (así un degradado de atardecer sigue siendo cielo) y es liso. Lo que no es cielo es
primer plano. Luego se limpian agujeros y motas, y el borde se suaviza un poco.
Necesita numpy, scipy y Pillow.
"""
import os
import re
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARPETA = os.path.join(RAIZ, 'app', 'fondos')
ANCHO, ALTO = 960, 540   # se calcula a media resolución: 4 veces más rápido y bordes de sobra


# Caja del reloj en una pantalla de 1920x1080: los dígitos van de y≈165 a y≈405.
RELOJ_X0, RELOJ_X1, RELOJ_Y1 = 600, 1320, 405
RELOJ_LIBRE = 0.62   # fracción de arriba del reloj que nunca se tapa (solo asoman las cumbres por abajo)


def despejar_reloj(alfa):
    """Limita el recorte dentro de la caja del reloj a su franja de abajo, con bordes suaves.

    alfa: array float 0-1 de alto x ancho. Fuera de la caja no cambia nada, y como la foto de debajo
    tiene los mismos píxeles, lo único que pasa es que el reloj queda delante de esas cumbres."""
    alto, ancho = alfa.shape
    k = ancho / 1920.0
    y = np.arange(alto, dtype=np.float32)[:, None] / k
    x = np.arange(ancho, dtype=np.float32)[None, :] / k
    corte = 165 + (RELOJ_Y1 - 165) * RELOJ_LIBRE
    vertical = np.clip((y - corte) / 50.0, 0, 1)                      # 0 arriba, 1 en la franja de abajo
    dentro = np.clip(np.minimum(x - (RELOJ_X0 - 80), (RELOJ_X1 + 80) - x) / 80.0, 0, 1)
    dentro = dentro * np.clip((RELOJ_Y1 + 60 - y) / 60.0, 0, 1)       # por debajo del reloj, libre
    return alfa * (1 - dentro * (1 - vertical))


def cielo(img, paso=16.0, lejos=70.0, suelo=0.8, textura=9.0):
    a = np.asarray(img, dtype=np.float32)
    H, W, _ = a.shape
    gris = a.mean(axis=2)
    # Textura: cuánto cambia la luz alrededor (el cielo es liso; la roca, los árboles y las ventanas no)
    detalle = ndimage.uniform_filter(np.hypot(ndimage.sobel(gris, 0), ndimage.sobel(gris, 1)), 5) / 8
    liso = detalle < textura

    arriba = np.median(a[0], axis=0)
    es = np.zeros((H, W), bool)
    es[0] = (np.linalg.norm(a[0] - arriba, axis=1) < lejos) & liso[0]
    ref = a[0].copy()   # por columna, el último color de cielo visto
    for y in range(1, int(suelo * H)):
        cerca = (np.linalg.norm(a[y] - ref, axis=1) < paso) & liso[y]
        fila = cerca & (es[y - 1] | np.roll(es[y - 1], 1) | np.roll(es[y - 1], -1))
        # se extiende por la fila hacia vecinos igual de "cielo" (para rodear cosas por los lados)
        for _ in range(40):
            fila = fila | (cerca & (np.roll(fila, 1) | np.roll(fila, -1)))
        es[y] = fila
        ref[fila] = a[y][fila]

    # Segunda pasada, solo hacia los lados y corta: una banda de nubes con el borde marcado corta el
    # crecimiento hacia abajo y deja columnas de "primer plano" en pleno cielo. Se rellenan si su color
    # se parece al del cielo de esa misma fila (así no se come montañas con bruma, que van más lejos)
    fondo_fila = np.full((H, 3), np.inf, np.float32)
    con_cielo = es.any(axis=1)
    for y in np.nonzero(con_cielo)[0]:
        fondo_fila[y] = np.median(a[y][es[y]], axis=0)
    parecido = liso & (np.linalg.norm(a - fondo_fila[:, None, :], axis=2) < 2 * paso)
    parecido[int(suelo * H):] = False
    for _ in range(30):
        nuevo = ~es & parecido & (np.roll(es, 1, 1) | np.roll(es, -1, 1))
        if not nuevo.any():
            break
        es |= nuevo

    # Limpieza: sin agujeros en el cielo, y solo cuenta el cielo que toca el borde de arriba
    es = ndimage.binary_closing(es, iterations=2, border_value=1)
    etiquetas, _ = ndimage.label(es)
    es = np.isin(etiquetas, list(set(np.unique(etiquetas[0])) - {0}))
    # El primer plano que flota en el cielo (nubes sueltas, estrellas) no es primer plano
    frente = ~es
    etiquetas, _ = ndimage.label(frente)
    abajo = set(np.unique(etiquetas[-1])) - {0}
    frente = np.isin(etiquetas, list(abajo))
    # Franjas verticales finas (columnas donde el cielo dejó de crecer por ruido): fuera
    frente = ndimage.binary_opening(frente, structure=np.ones((1, 13)))
    etiquetas, _ = ndimage.label(frente)
    frente = np.isin(etiquetas, list(set(np.unique(etiquetas[-1])) - {0}))
    return frente


def recortar(id_):
    origen = os.path.join(CARPETA, id_ + '.jpg')
    foto = Image.open(origen).convert('RGB')
    frente = cielo(foto.resize((ANCHO, ALTO), Image.LANCZOS))
    mascara = Image.fromarray((frente * 255).astype(np.uint8)).resize(foto.size, Image.BILINEAR)
    # Borde suave: medio píxel hacia dentro y un difuminado ligero, para que no se vea serrado
    mascara = mascara.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    mascara = Image.fromarray((despejar_reloj(np.asarray(mascara, np.float32) / 255) * 255).astype(np.uint8))
    rgba = foto.copy()
    rgba.putalpha(mascara)
    destino = os.path.join(CARPETA, id_ + '-frente.webp')
    rgba.save(destino, 'WEBP', quality=80, method=6)
    cubierto = float(np.asarray(mascara).mean()) / 255
    return destino, cubierto, mascara


def main():
    # Solo las fotos marcadas con profundidad: true en js/fondos.js (las que se recortan limpias)
    with open(os.path.join(RAIZ, 'app', 'js', 'fondos.js'), encoding='utf-8') as f:
        fotos = re.findall(r"id: '([a-z0-9-]+)'[^}]*?profundidad: true", f.read())
    fotos = [f for f in fotos if os.path.exists(os.path.join(CARPETA, f + '.jpg'))]
    if not fotos:
        sys.exit('No hay fotos con profundidad: ejecuta antes python3 tools/fondos.py')
    muestras = []
    for id_ in fotos:
        destino, cubierto, mascara = recortar(id_)
        print('  %-24s primer plano %3.0f%%  (%d KB)' % (id_, cubierto * 100, os.path.getsize(destino) // 1024))
        muestras.append((id_, mascara))
    if '--muestra' in sys.argv:
        # Hoja de prueba: cada foto con el cielo pintado de magenta, para revisar el recorte a ojo
        hoja = Image.new('RGB', (4 * 480, ((len(muestras) + 3) // 4) * 270), (40, 40, 40))
        for i, (id_, mascara) in enumerate(muestras):
            foto = Image.open(os.path.join(CARPETA, id_ + '.jpg')).convert('RGB')
            magenta = Image.new('RGB', foto.size, (255, 0, 200))
            prueba = Image.composite(foto, magenta, mascara).resize((480, 270))
            hoja.paste(prueba, ((i % 4) * 480, (i // 4) * 270))
        ruta = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'tvlibre-profundidad.jpg')
        hoja.save(ruta, quality=85)
        print('Hoja de prueba:', ruta)


if __name__ == '__main__':
    main()
