#!/usr/bin/env python3
"""Crea la versión de noche de cada foto, para el modo oscuro.

    python3 tools/noche.py              # crea app/fondos/<id>-noche.jpg (y su vidrio y su primer plano)
    python3 tools/noche.py --muestra    # además, una hoja de prueba día / noche en la carpeta temporal

Es la "noche americana" del cine: la foto de día se oscurece, se enfría hacia el azul de la luz de luna
y pierde color. En las fotos con profundidad (tools/profundidad.py) se sabe dónde está el cielo, y ese
cielo se cambia por uno de noche con estrellas; el paisaje se queda con su forma, solo que de noche.
Las fotos que ya son de noche (nocturna: true en js/fondos.js, o muy oscuras) se saltan: la app usa la de siempre.
Y al revés: las marcadas con dia: true (de noche, pero con un cielo liso que se puede cambiar) reciben una versión
de día, <id>-dia.jpg, para el modo claro: cielo azul con las nubes de la foto y el paisaje con más luz.

Se hace aquí y no en la TV porque retocar una foto de 1920 x 1080 al vuelo la dejaría parada.
Necesita numpy y Pillow. Ejecutar después de fondos.py y profundidad.py.
"""
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fondos import vidrio   # noqa: E402  (misma copia difuminada que las fotos de día)

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARPETA = os.path.join(RAIZ, 'app', 'fondos')
YA_OSCURA = 0.24   # luminancia media por debajo de la cual la foto ya parece de noche
LUNA = np.array([0.62, 0.74, 1.0], np.float32)   # tinte de la luz de luna


def luminancia(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def paisaje_de_noche(a):
    """Noche americana: poco color, mucho menos luz, azul frío y las sombras más hundidas."""
    L = luminancia(a)[..., None]
    poco_color = L + (a - L) * 0.45
    oscuro = np.power(poco_color, 1.25) * 0.55
    return oscuro * LUNA


def cielo_de_noche(alto, ancho, original, semilla):
    """Degradado azul noche, un poco de la textura de las nubes originales y estrellas."""
    y = np.linspace(0, 1, alto, dtype=np.float32)[:, None, None]
    arriba = np.array([0.012, 0.02, 0.06], np.float32)
    horizonte = np.array([0.09, 0.13, 0.24], np.float32)
    cielo = arriba + (horizonte - arriba) * np.power(y, 1.6)
    # Las nubes no desaparecen: quedan como velos grises que tapan las estrellas
    nubes = np.clip(luminancia(original)[..., None] - 0.55, 0, 1) * 0.35
    cielo = cielo + nubes * LUNA
    rng = np.random.default_rng(semilla)
    n = ancho * alto // 900
    xs, ys = rng.integers(0, ancho, n), (np.power(rng.random(n), 1.8) * alto * 0.85).astype(int)
    brillo = np.power(rng.random(n), 3) * 0.9 + 0.1
    estrellas = np.zeros((alto, ancho), np.float32)
    estrellas[ys, xs] = brillo
    # Las más brillantes, de 2 x 2 px (la TV pasa de 1080 a 4K exactamente al doble)
    grandes = brillo > 0.6
    estrellas[np.minimum(ys[grandes] + 1, alto - 1), xs[grandes]] = brillo[grandes] * 0.6
    estrellas[ys[grandes], np.minimum(xs[grandes] + 1, ancho - 1)] = brillo[grandes] * 0.6
    estrellas *= np.clip(1 - nubes[..., 0] * 5, 0, 1)
    return cielo + estrellas[..., None] * np.array([0.9, 0.95, 1.0], np.float32)


def cielo_de_dia(alto, original):
    """Azul de día, más claro hacia el horizonte, con las nubes de la foto convertidas en nubes blancas."""
    y = np.linspace(0, 1, alto, dtype=np.float32)[:, None, None]
    arriba = np.array([0.24, 0.48, 0.82], np.float32)
    horizonte = np.array([0.72, 0.84, 0.95], np.float32)
    cielo = arriba + (horizonte - arriba) * np.power(y, 1.3)
    L = luminancia(original)
    # Lo que en la foto es más claro que su entorno (nubes iluminadas) pasa a ser nube blanca
    from scipy import ndimage
    fondo = ndimage.uniform_filter(L, 61)
    nubes = np.clip((L - fondo) * 3 + (L - L.mean()) * 1.2, 0, 1)[..., None]
    return cielo + (np.array([0.97, 0.97, 0.98], np.float32) - cielo) * nubes * 0.85


def paisaje_de_dia(a):
    """Más luz (sobre todo en las sombras), un poco menos de color saturado y un tono neutro de día."""
    L = luminancia(a)[..., None]
    calmado = L + (a - L) * 0.75
    return np.power(np.clip(calmado, 0, 1), 0.55) * np.array([1.0, 0.98, 0.95], np.float32)


def mascara_de(foto):
    """El primer plano, como en profundidad.py pero más estricto con lo que es cielo: el recorte de
    profundidad deja pasar trocitos de cielo pegados a las cumbres que, con un cielo nuevo, se verían."""
    from profundidad import cielo, ANCHO, ALTO
    from PIL import ImageFilter
    frente = cielo(foto.resize((ANCHO, ALTO), Image.LANCZOS), paso=30.0, textura=20.0)
    m = Image.fromarray((frente * 255).astype(np.uint8)).resize(foto.size, Image.BILINEAR)
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    return np.asarray(m, np.float32)[..., None] / 255


def guardar(id_, sufijo, img, mascara, con_frente):
    destino = os.path.join(CARPETA, id_ + sufijo + '.jpg')
    img.save(destino, 'JPEG', quality=78, optimize=True, progressive=True)
    vidrio(destino, os.path.join(CARPETA, id_ + sufijo + '-vidrio.jpg'))
    if con_frente:
        rgba = img.copy()
        rgba.putalpha(Image.fromarray((mascara[..., 0] * 255).astype(np.uint8)))
        rgba.save(os.path.join(CARPETA, id_ + sufijo + '-frente.webp'), 'WEBP', quality=80, method=6)


def de_dia(id_, con_frente):
    foto = Image.open(os.path.join(CARPETA, id_ + '.jpg')).convert('RGB')
    a = np.asarray(foto, np.float32) / 255
    mascara = mascara_de(foto)
    dia = paisaje_de_dia(a) * mascara + cielo_de_dia(a.shape[0], a) * (1 - mascara)
    img = Image.fromarray((np.clip(dia, 0, 1) * 255 + 0.5).astype(np.uint8))
    guardar(id_, '-dia', img, mascara, con_frente)
    return foto, img


def de_noche(id_):
    foto = Image.open(os.path.join(CARPETA, id_ + '.jpg')).convert('RGB')
    a = np.asarray(foto, np.float32) / 255
    if luminancia(a).mean() < YA_OSCURA:
        return None
    noche = paisaje_de_noche(a)
    ruta_frente = os.path.join(CARPETA, id_ + '-frente.webp')
    mascara = None
    if os.path.exists(ruta_frente):
        with Image.open(ruta_frente) as f:
            mascara = np.asarray(f.getchannel('A'), np.float32)[..., None] / 255
        cielo = cielo_de_noche(a.shape[0], a.shape[1], a, sum(map(ord, id_)))
        noche = noche * mascara + cielo * (1 - mascara)
    else:
        # Sin máscara no se sabe dónde está el cielo: se oscurece más arriba, como un cielo de noche
        y = np.linspace(0, 1, a.shape[0], dtype=np.float32)[:, None, None]
        noche = noche * (0.55 + 0.45 * np.clip(y * 1.6, 0, 1))
    img = Image.fromarray((np.clip(noche, 0, 1) * 255 + 0.5).astype(np.uint8))
    guardar(id_, '-noche', img, mascara, mascara is not None)
    return foto, img


def main():
    with open(os.path.join(RAIZ, 'app', 'js', 'fondos.js'), encoding='utf-8') as f:
        texto = f.read()
    fotos = re.findall(r"id: '([a-z0-9-]+)'[^}]*?foto: '", texto)
    nocturnas = set(re.findall(r"id: '([a-z0-9-]+)'[^}]*?nocturna: true", texto))
    de_dia_ids = re.findall(r"id: '([a-z0-9-]+)'[^}]*?dia: true", texto)
    con_frente = set(re.findall(r"id: '([a-z0-9-]+)'[^}]*?profundidad: true", texto))
    fotos = [f for f in fotos if os.path.exists(os.path.join(CARPETA, f + '.jpg'))]
    if not fotos:
        sys.exit('No hay fotos: ejecuta antes python3 tools/fondos.py')
    muestras = []
    for id_ in fotos:
        r = None if id_ in nocturnas else de_noche(id_)
        if r is None:
            for sufijo in ('-noche.jpg', '-noche-vidrio.jpg', '-noche-frente.webp'):   # de una pasada anterior
                if os.path.exists(os.path.join(CARPETA, id_ + sufijo)):
                    os.remove(os.path.join(CARPETA, id_ + sufijo))
            print('  %-24s ya es de noche: se usa la misma' % id_)
            continue
        print('  %-24s %4d KB' % (id_, os.path.getsize(os.path.join(CARPETA, id_ + '-noche.jpg')) // 1024))
        muestras.append(r)
    for id_ in de_dia_ids:
        muestras.append(de_dia(id_, id_ in con_frente))
        print('  %-24s de día: %4d KB' % (id_, os.path.getsize(os.path.join(CARPETA, id_ + '-dia.jpg')) // 1024))
    if '--muestra' in sys.argv:
        hoja = Image.new('RGB', (2 * 480, len(muestras) * 270))
        for i, (dia, noche) in enumerate(muestras):
            hoja.paste(dia.resize((480, 270)), (0, i * 270))
            hoja.paste(noche.resize((480, 270)), (480, i * 270))
        ruta = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'tvlibre-noche.jpg')
        hoja.save(ruta, quality=85)
        print('Hoja de prueba:', ruta)


if __name__ == '__main__':
    main()
