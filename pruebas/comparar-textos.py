# Compara los textos que ve el usuario entre dos versiones del programa.
#
# Está por una razón concreta: el 23 de septiembre de 2026, al partir una
# función grande en funciones chicas, tres textos de ayuda quedaron cambiados
# sin querer. Dos de ellos estaban recortados porque se los había copiado de
# una vista de pantalla que los cortaba. El banco de pruebas no lo detecta,
# porque esos textos no deciden nada: solo se leen.
#
# Partir el código NO puede cambiar ni un texto. Esta comparación lo comprueba.
#
# Uso: python3 comparar-textos.py <version-anterior.js> <version-nueva.js>
#
# Devuelve 0 si no se perdió ni se inventó ningún texto, y 1 si algo cambió.
import re
import sys

# Los textos cortos cambian por motivos legítimos (una clase de estilo, una
# clave); desde 40 caracteres ya se trata de algo que el usuario lee.
LARGO_MINIMO = 40


def textos(ruta):
    """Los textos entrecomillados del archivo, sin los que son código."""
    src = open(ruta, encoding='utf-8').read()
    sueltos = set()
    for comilla in ("'", '"'):
        for m in re.finditer(r'%s([^%s\\\n]{%d,})%s' % (comilla, comilla, LARGO_MINIMO, comilla), src):
            sueltos.add(m.group(1))
    # Las plantillas `…` también llevan texto a la vista, pero solo se miran
    # las de un renglón: una plantilla que ocupa varios suele tener código
    # adentro y compararla daría avisos falsos cada vez que se parte una
    # función.
    for m in re.finditer(r'`([^`\\\n]{%d,})`' % LARGO_MINIMO, src):
        sueltos.add(m.group(1))
    return sueltos


def parece_codigo(t):
    """Descarta lo que es un estilo o un selector y no un texto para leer."""
    if re.search(r'[{};]\s*[a-z-]+\s*:', t):
        return True                      # una hoja de estilos
    if t.count(':') > 3 and ' ' not in t.strip():
        return True
    # Un trozo de código que quedó entre dos comillas de la misma línea: no es
    # nada que el usuario lea.
    if re.search(r'=>|&&|\|\||\breturn\b|===|!==', t):
        return True
    return False


def main():
    if len(sys.argv) < 3:
        print('Faltan los dos archivos a comparar.')
        return 2
    antes, despues = textos(sys.argv[1]), textos(sys.argv[2])
    perdidos = sorted(t for t in antes - despues if not parece_codigo(t))
    nuevos = sorted(t for t in despues - antes if not parece_codigo(t))

    print('Textos de %d caracteres o más: %d antes, %d después.' % (LARGO_MINIMO, len(antes), len(despues)))
    if perdidos:
        print('\nSE PERDIERON O CAMBIARON (%d):' % len(perdidos))
        for t in perdidos:
            print('  - ' + t[:150])
    if nuevos:
        print('\nAPARECIERON (%d). Si no los agregaste a propósito, alguno es un texto reescrito:' % len(nuevos))
        for t in nuevos:
            print('  + ' + t[:150])
    if not perdidos and not nuevos:
        print('\nNingún texto cambió.')
    return 1 if (perdidos or nuevos) else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:      # cuando la salida se corta con head
        sys.exit(0)
