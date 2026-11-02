#!/usr/bin/env python3
"""Instala TV Libre en una LG con Developer Mode, por la red de casa.

    python3 tools/install.py 192.168.1.50                # empaqueta, instala o actualiza, y la abre
    python3 tools/install.py 192.168.1.50 --desinstalar  # la quita
    python3 tools/install.py 192.168.1.50 --olvidar      # borra la clave y la huella guardadas de esa TV
    python3 tools/install.py 192.168.1.50 --rapido       # solo sube HTML, CSS y JS (para probar cambios)
    python3 tools/install.py --rapido                    # sin IP: usa la TV ya emparejada, si solo hay una
    python3 tools/install.py --calendario=URL            # guarda el enlace iCal privado de tu calendario e instala
    python3 tools/install.py --calendario=               # lo quita

Calendario: en Google Calendar, Configuración → tu calendario → "Dirección secreta en formato iCal".
Se guarda en app/calendario.txt, que no entra en git (quien tenga el enlace ve tu calendario), y va en el paquete.

Antes, en la TV: instala "Developer Mode" desde LG Content Store, entra con una cuenta gratuita de
webostv.developer.lge.com, activa "Dev Mode Status" (la TV se reinicia) y luego "Key Server".
La app muestra la IP de la TV y una frase de paso (passphrase).

La primera vez descarga la clave SSH de la TV desde su Key Server (puerto 9991) y te pide la frase de paso
para desbloquearla; no se guarda la frase, solo la clave ya desbloqueada en ~/.ssh/tvlibre_<IP> (permisos 600).
Es un compromiso de comodidad: así no la pides en cada instalación, pero quien lea tu ~/.ssh puede entrar
al modo desarrollador de la TV. Bórrala cuando no la necesites (o con --olvidar).

Identidad de la TV: la primera conexión guarda la huella de la TV en ~/.ssh/tvlibre_known_hosts y la muestra;
las siguientes se niegan a seguir si cambia (alguien podría estar haciéndose pasar por ella). Si reinstalaste
Developer Mode en la TV, la huella cambia de verdad: ejecuta con --olvidar y vuelve a emparejar.
Ojo: el Key Server sirve la clave por HTTP sin cifrar; actívalo solo mientras emparejas, en tu red de casa.
El .ipk se copia por SSH (puerto 9922, usuario prisoner) y lo instala el propio instalador de la TV
(luna://com.webos.appInstallService/dev/install), como hacen las herramientas de LG.
Necesita Python 3 y OpenSSH (ssh, ssh-keygen), que ya vienen en macOS y Linux.
Flujo inspirado en Free My TV (github.com/simbasjungles/free-my-tv, MIT).
"""
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build  # noqa: E402

TEMPORAL = '/media/developer/temp/tvlibre.ipk'
CONOCIDOS = os.path.join(os.path.expanduser('~'), '.ssh', 'tvlibre_known_hosts')
# accept-new: la primera vez apunta la huella de la TV; después, si no coincide, ssh se niega a conectar
OPCIONES_SSH = ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=' + CONOCIDOS,
                '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=8',
                # Las TV antiguas solo hablan ssh-rsa, que OpenSSH moderno desactiva por defecto
                '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedKeyTypes=+ssh-rsa', '-p', '9922']


def ruta_clave(ip):
    return os.path.join(os.path.expanduser('~'), '.ssh', 'tvlibre_' + ip.replace('.', '_'))


def obtener_clave(ip):
    ruta = ruta_clave(ip)
    if os.path.exists(ruta):
        return ruta
    url = 'http://%s:9991/webos_rsa' % ip
    print('Descargando la clave de la TV desde %s ...' % url)
    try:
        with urllib.request.urlopen(url, timeout=6) as r:
            datos = r.read()
    except Exception as e:
        sys.exit('No llego al Key Server (%s). En la app Developer Mode de la TV, activa "Key Server".' % e)
    frase = getpass.getpass('Frase de paso que muestra Developer Mode en la TV: ').strip()
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(delete=False)
    tmp.write(datos)
    tmp.close()
    os.chmod(tmp.name, 0o600)
    r = subprocess.run(['ssh-keygen', '-p', '-P', frase, '-N', '', '-f', tmp.name], capture_output=True, text=True)
    if r.returncode != 0:
        os.unlink(tmp.name)
        motivo = (r.stderr.strip().splitlines() or [''])[-1]
        sys.exit('La frase de paso no desbloquea la clave (%s). Revísala en la TV y prueba otra vez.' % motivo)
    shutil.move(tmp.name, ruta)
    os.chmod(ruta, 0o600)
    return ruta


def huella_conocida(ip):
    r = subprocess.run(['ssh-keygen', '-F', '[%s]:9922' % ip, '-f', CONOCIDOS], capture_output=True, text=True)
    return r.returncode == 0 and bool(r.stdout.strip())


def emparejar(ip, clave):
    """Primera conexión: guarda la huella de la TV y la enseña para poder compararla si algún día cambia."""
    if huella_conocida(ip):
        return
    r = ssh(ip, clave, 'true')
    if r.returncode != 0:
        sys.exit('No se pudo conectar por SSH: %s\n¿Está activado "Dev Mode Status" en la TV?' %
                 r.stderr.decode(errors='replace').strip())
    r = subprocess.run(['ssh-keygen', '-l', '-F', '[%s]:9922' % ip, '-f', CONOCIDOS], capture_output=True, text=True)
    huella = [l for l in r.stdout.splitlines() if not l.startswith('#')]
    print('TV emparejada. Huella guardada en %s:\n  %s' % (CONOCIDOS, huella[0] if huella else '?'))


def olvidar(ip):
    ruta = ruta_clave(ip)
    if os.path.exists(ruta):
        os.unlink(ruta)
        print('Clave borrada:', ruta)
    if os.path.exists(CONOCIDOS):
        subprocess.run(['ssh-keygen', '-R', '[%s]:9922' % ip, '-f', CONOCIDOS], capture_output=True)
        print('Huella de %s olvidada.' % ip)


def ssh(ip, clave, orden, entrada=None, terminal=False):
    args = ['ssh'] + (['-tt'] if terminal else []) + OPCIONES_SSH + ['-i', clave, 'prisoner@' + ip, orden]
    return subprocess.run(args, input=entrada, capture_output=True)


def luna(ip, clave, uri, datos, espera=60, fin=None):
    """Llama a luna-send-pub en la TV y devuelve las respuestas JSON.

    luna-send-pub no imprime nada sin terminal, de ahí el -tt. El instalador manda varias respuestas
    seguidas, así que se leen en vivo y se corta en cuanto `fin(respuesta)` dice que ya está.
    El BusyBox de webOS antiguo solo entiende `timeout -t SEG`; el nuevo, `timeout SEG`.
    """
    carga = json.dumps(datos).replace("'", "'\\''")
    orden = ("if timeout -t 1 true 2>/dev/null; then T='timeout -t %d'; else T='timeout %d'; fi; "
             "$T luna-send-pub -i '%s' '%s'" % (espera, espera, uri, carga))
    args = ['ssh', '-tt'] + OPCIONES_SSH + ['-i', clave, 'prisoner@' + ip, orden]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    respuestas = []
    for linea in proc.stdout:
        m = re.search(r'\{.*\}', linea)
        if not m:
            continue
        try:
            r = json.loads(m.group())
        except ValueError:
            continue
        respuestas.append(r)
        if fin and fin(r):
            break
    proc.terminate()
    proc.wait()
    return respuestas


def estado(r):
    return (r.get('details') or {}).get('state') or r.get('state') or ''


def instalar(ip, clave):
    ipk, app_id = build.construir()
    with open(ipk, 'rb') as f:
        datos = f.read()
    print('Copiando a la TV ...')
    r = ssh(ip, clave, 'mkdir -p /media/developer/temp && cat > %s' % TEMPORAL, entrada=datos)
    if r.returncode != 0:
        detalle = r.stderr.decode(errors='replace').strip()
        if 'HOST IDENTIFICATION HAS CHANGED' in detalle or 'Host key verification failed' in detalle:
            sys.exit('La huella SSH de la TV no coincide con la guardada. Si reinstalaste Developer Mode, '
                     'ejecuta con --olvidar; si no, alguien en la red podría estar suplantándola.')
        sys.exit('No se pudo copiar por SSH: %s\n¿Está activado "Dev Mode Status" en la TV?' % detalle)

    print('Instalando ...')
    terminado = lambda x: x.get('returnValue') is False or 'installed' in estado(x) or 'fail' in estado(x).lower()
    respuestas = luna(ip, clave, 'luna://com.webos.appInstallService/dev/install',
                      {'id': app_id, 'ipkUrl': TEMPORAL, 'subscribe': True}, fin=terminado)
    ssh(ip, clave, 'rm -f %s' % TEMPORAL)
    finales = [x for x in respuestas if terminado(x)]
    if not finales or 'installed' not in estado(finales[-1]):
        detalle = json.dumps(finales[-1] if finales else respuestas[-1:] or 'sin respuesta', ensure_ascii=False)
        sys.exit('La instalación no se confirmó: %s' % detalle)

    print('Instalada. Abriendo TV Libre ...')
    luna(ip, clave, 'luna://com.webos.applicationManager/launch', {'id': app_id}, espera=10,
         fin=lambda x: 'returnValue' in x)
    print('\nListo. Para tenerla a un botón: con TV Libre abierta, mantén pulsado un número del mando'
          ' (Acceso rápido) y elige guardarla ahí.')


def rapido(ip, clave):
    """Copia solo index.html, css/, js/ e img/ (~60 KB) sobre la app ya instalada y la relanza.

    Sin fotos ni instalador: cada prueba tarda un segundo en vez de quince y no reescribe 15 MB
    en la memoria de la TV. Requiere haberla instalado antes de forma normal.
    """
    import io
    import tarfile
    with open(os.path.join(build.APP, 'appinfo.json'), encoding='utf-8') as f:
        app_id = json.load(f)['id']
    destino = '/media/developer/apps/usr/palm/applications/' + app_id
    datos = io.BytesIO()
    with tarfile.open(fileobj=datos, mode='w') as tar:
        for nombre in ('index.html', 'appinfo.json', 'css', 'js', 'img'):
            ruta = os.path.join(build.APP, nombre)
            if os.path.exists(ruta):
                tar.add(ruta, arcname=nombre)
    print('Subiendo %d KB a %s ...' % (len(datos.getvalue()) // 1024, destino))
    r = ssh(ip, clave, 'test -w %s && tar -x -C %s' % (destino, destino), entrada=datos.getvalue())
    if r.returncode != 0:
        sys.exit('No se pudo escribir en la app instalada (%s).\n'
                 'Instálala primero sin --rapido; si ya lo está, este firmware no deja escribir ahí.' %
                 (r.stderr.decode(errors='replace').strip() or 'sin permiso'))
    luna(ip, clave, 'luna://com.webos.applicationManager/closeByAppId', {'id': app_id}, espera=10,
         fin=lambda x: 'returnValue' in x)
    luna(ip, clave, 'luna://com.webos.applicationManager/launch', {'id': app_id}, espera=10,
         fin=lambda x: 'returnValue' in x)
    print('Actualizada y relanzada.')


def desinstalar(ip, clave):
    with open(os.path.join(build.APP, 'appinfo.json'), encoding='utf-8') as f:
        app_id = json.load(f)['id']
    print('Quitando %s ...' % app_id)
    respuestas = luna(ip, clave, 'luna://com.webos.appInstallService/dev/remove',
                      {'id': app_id, 'subscribe': True}, espera=30,
                      fin=lambda x: x.get('returnValue') is False or 'removed' in estado(x))
    if any('removed' in estado(x) for x in respuestas):
        print('Desinstalada.')
    else:
        sys.exit('No se confirmó: %s' % json.dumps(respuestas[-1:], ensure_ascii=False))


OPCIONES = ('--desinstalar', '--olvidar', '--rapido')


def tv_emparejada():
    """La IP de la única TV con clave guardada, para no tener que escribirla cada vez (None si hay 0 o varias)."""
    carpeta = os.path.join(os.path.expanduser('~'), '.ssh')
    try:
        nombres = os.listdir(carpeta)
    except OSError:
        return None
    ips = [n[len('tvlibre_'):].replace('_', '.') for n in nombres
           if re.match(r'^tvlibre_\d{1,3}(_\d{1,3}){3}$', n)]
    return ips[0] if len(ips) == 1 else None


def guardar_calendario(valor):
    ruta = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'app', 'calendario.txt')
    valor = valor.strip()
    if valor.startswith('webcal://'):
        valor = 'https://' + valor[len('webcal://'):]
    if not valor:
        if os.path.exists(ruta):
            os.remove(ruta)
        print('Calendario quitado.')
        return
    if not re.match(r'^https://\S+$', valor):
        sys.exit('El enlace del calendario tiene que empezar por https:// (la "dirección secreta en formato iCal").')
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(valor + '\n')
    os.chmod(ruta, 0o600)
    print('Calendario guardado en app/calendario.txt (fuera de git).')


def main():
    calendario = [a for a in sys.argv[1:] if a.startswith('--calendario=')]
    if calendario:
        guardar_calendario(calendario[-1].split('=', 1)[1])
    desconocidas = [a for a in sys.argv[1:] if a.startswith('--') and a not in OPCIONES and not a.startswith('--calendario=')]
    if desconocidas:
        # Mejor parar que hacer una instalación completa por una errata en --rapido
        sys.exit('Opción desconocida: %s\n%s' % (' '.join(desconocidas), __doc__))
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args and tv_emparejada():
        args = [tv_emparejada()]
        print('TV emparejada:', args[0])
    if len(args) != 1 or not re.match(r'^\d{1,3}(\.\d{1,3}){3}$', args[0]):
        sys.exit(__doc__)
    ip = args[0]
    if not shutil.which('ssh') or not shutil.which('ssh-keygen'):
        sys.exit('Hace falta OpenSSH (ssh y ssh-keygen).')
    if '--olvidar' in sys.argv:
        olvidar(ip)
        return
    clave = obtener_clave(ip)
    emparejar(ip, clave)
    inicio = time.time()
    if '--desinstalar' in sys.argv:
        desinstalar(ip, clave)
    elif '--rapido' in sys.argv:
        rapido(ip, clave)
    else:
        instalar(ip, clave)
    print('(%.0f s)' % (time.time() - inicio))


if __name__ == '__main__':
    main()
