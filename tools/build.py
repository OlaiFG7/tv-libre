#!/usr/bin/env python3
"""Empaqueta app/ en un .ipk instalable en webOS, sin las herramientas de LG (ares-cli).

    python3 tools/build.py            # crea TVLibre.ipk en la raíz del proyecto

Un .ipk es un archivo `ar` (como un .deb) con tres miembros, en este orden:
  debian-binary   "2.0\\n"
  control.tar.gz  ./control con los metadatos del paquete
  data.tar.gz     ./usr/palm/applications/<id>/...  (la app)
                  ./usr/palm/packages/<id>/packageinfo.json
Si faltan los iconos, los dibuja (PNG generado con zlib, sin dependencias).
"""
import io
import json
import os
import struct
import tarfile
import time
import zlib

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(RAIZ, 'app')
IPK = os.path.join(RAIZ, 'TVLibre.ipk')


def png(tam):
    """Icono: cuadrado redondeado con degradado azul y un triángulo de "play" blanco."""
    filas = []
    r = tam * 0.22
    for y in range(tam):
        fila = bytearray([0])
        for x in range(tam):
            # Esquinas redondeadas: transparente fuera del radio
            cx = min(max(x, r), tam - 1 - r)
            cy = min(max(y, r), tam - 1 - r)
            dentro = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
            if not dentro:
                fila += bytes([0, 0, 0, 0])
                continue
            t = (x + y) / (2 * tam)
            rojo, verde, azul = int(43 + 40 * t), int(108 + 60 * t), int(176 + 60 * t)
            # Triángulo apuntando a la derecha, centrado
            u, v = x / tam, y / tam
            if 0.38 <= u <= 0.70 and abs(v - 0.5) <= (0.70 - u) * 0.62:
                rojo, verde, azul = 255, 255, 255
            fila += bytes([rojo, verde, azul, 255])
        filas.append(bytes(fila))

    def trozo(tipo, datos):
        return struct.pack('>I', len(datos)) + tipo + datos + struct.pack('>I', zlib.crc32(tipo + datos) & 0xffffffff)

    cabecera = struct.pack('>IIBBBBB', tam, tam, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + trozo(b'IHDR', cabecera) +
            trozo(b'IDAT', zlib.compress(b''.join(filas), 9)) + trozo(b'IEND', b''))


def iconos(info):
    for clave, tam in (('icon', 80), ('largeIcon', 130)):
        ruta = os.path.join(APP, info[clave])
        if not os.path.exists(ruta):
            with open(ruta, 'wb') as f:
                f.write(png(tam))
            print('Icono creado:', os.path.relpath(ruta, RAIZ))


def tar_gz(entradas):
    """entradas: [(ruta, bytes o None si es carpeta)] -> bytes de un .tar.gz con dueño root."""
    salida = io.BytesIO()
    ahora = int(time.time())
    with tarfile.open(fileobj=salida, mode='w:gz', format=tarfile.GNU_FORMAT) as tar:
        for ruta, datos in entradas:
            ti = tarfile.TarInfo(ruta)
            ti.mtime = ahora
            ti.uid = ti.gid = 0
            ti.uname = ti.gname = 'root'
            if datos is None:
                ti.type = tarfile.DIRTYPE
                ti.mode = 0o755
                tar.addfile(ti)
            else:
                ti.mode = 0o644
                ti.size = len(datos)
                tar.addfile(ti, io.BytesIO(datos))
    return salida.getvalue()


def ar(miembros):
    """Formato ar común: cabecera global y 60 bytes por miembro, rellenando a número par."""
    salida = bytearray(b'!<arch>\n')
    ahora = int(time.time())
    for nombre, datos in miembros:
        cab = '%-16s%-12d%-6d%-6d%-8s%-10d`\n' % (nombre, ahora, 0, 0, '100644', len(datos))
        salida += cab.encode('ascii') + datos
        if len(datos) % 2:
            salida += b'\n'
    return bytes(salida)


def carpetas_de(ruta):
    """'./a/b/c' -> ['./a', './a/b'] para que el tar tenga las carpetas intermedias."""
    partes = ruta.split('/')
    return ['/'.join(partes[:i]) for i in range(2, len(partes))]


def construir():
    with open(os.path.join(APP, 'appinfo.json'), encoding='utf-8') as f:
        info = json.load(f)
    iconos(info)
    app_id, version = info['id'], info['version']

    base = './usr/palm/applications/%s' % app_id
    archivos = []
    for carpeta, subcarpetas, nombres in os.walk(APP):
        subcarpetas.sort()
        for nombre in sorted(nombres):
            if nombre.startswith('.'):
                continue
            origen = os.path.join(carpeta, nombre)
            relativa = os.path.relpath(origen, APP).replace(os.sep, '/')
            with open(origen, 'rb') as f:
                archivos.append((base + '/' + relativa, f.read()))

    paquete = {'app': app_id, 'id': app_id, 'loc_name': info['title'], 'vendor': info.get('vendor', ''),
               'version': version}
    archivos.append(('./usr/palm/packages/%s/packageinfo.json' % app_id,
                     json.dumps(paquete, indent=2).encode('utf-8')))

    carpetas = set()
    for ruta, _ in archivos:
        carpetas.update(carpetas_de(ruta))
    entradas = [(c, None) for c in sorted(carpetas, key=lambda c: (c.count('/'), c))] + archivos

    tamano = (sum(len(d) for _, d in archivos) + 1023) // 1024   # Installed-Size va en KB, como en Debian
    control = ('Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\n'
               'Installed-Size: %d\nMaintainer: %s\nDescription: %s\n'
               'webOS-Package-Format-Version: 2\nwebOS-Packager-Version: 1.0.0\n'
               % (app_id, version, tamano, info.get('vendor', 'TV Libre'), info['title']))

    ipk = ar([
        ('debian-binary', b'2.0\n'),
        ('control.tar.gz', tar_gz([('./control', control.encode('utf-8'))])),
        ('data.tar.gz', tar_gz(entradas)),
    ])
    with open(IPK, 'wb') as f:
        f.write(ipk)
    print('Paquete listo: %s (%s %s, %d KB)' % (os.path.relpath(IPK, RAIZ), app_id, version, len(ipk) // 1024))
    return IPK, app_id


if __name__ == '__main__':
    construir()
