// Revisión de código de los userscripts de Lex+ (SuPJN+, EJE+ y MEV Ultra) con ESLint 9 o
// posterior. Se corre desde la carpeta del repositorio:
//
//     npx eslint supjn-plus.user.js        (o eje-plus.user.js, mev-ultra.user.js)
//
// Reglas: las recomendadas de ESLint, más las de calidad y orden que importan
// en un archivo único de este tamaño. Los globales son los del navegador y los
// que agrega Tampermonkey. Las tres últimas reglas no marcan errores: miden
// funciones demasiado largas o enredadas, que son las que conviene partir.
'use strict';

function recomendadas() {
  try {
    return require('@eslint/js').configs.recommended.rules;     // instalación normal
  } catch (e) {
    // Sin @eslint/js: se leen las reglas marcadas como recomendadas dentro del
    // propio ESLint.
    const path = require('path');
    const reglas = require(path.join(path.dirname(require.resolve('eslint/package.json')), 'lib', 'rules'));
    const out = {};
    for (const [k, v] of reglas.entries()) {
      if (v && v.meta && v.meta.docs && v.meta.docs.recommended) out[k] = 'error';
    }
    return out;
  }
}

const DEL_NAVEGADOR = `window document console navigator location history screen alert confirm prompt
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
queueMicrotask structuredClone fetch localStorage sessionStorage indexedDB crypto performance
innerWidth innerHeight Blob File FileReader FormData URL URLSearchParams AbortController Headers
Request Response XMLHttpRequest EventSource WebSocket TextEncoder TextDecoder DOMParser XMLSerializer
MutationObserver ResizeObserver IntersectionObserver Event CustomEvent MouseEvent KeyboardEvent
PointerEvent DragEvent Image Audio Option Node Element HTMLElement HTMLInputElement NodeFilter Range
getComputedStyle matchMedia scrollTo scrollBy open close print focus blur atob btoa
showDirectoryPicker showOpenFilePicker showSaveFilePicker FileSystemHandle
GM_getValue GM_setValue GM_deleteValue GM_listValues GM_info GM_xmlhttpRequest GM_addStyle
GM_openInTab GM_setClipboard GM_notification GM_download GM_addValueChangeListener GM_removeValueChangeListener GM_getResourceText GM unsafeWindow
Worker CompressionStream DecompressionStream CSS addEventListener removeEventListener dispatchEvent`.split(/\s+/);
const globals = {};
DEL_NAVEGADOR.forEach((g) => { globals[g] = 'readonly'; });

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['**/node_modules/**', 'extension/**'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals },
    rules: {
      ...recomendadas(),
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-use-before-define': ['error', { functions: false, classes: true, variables: false }],
      'no-shadow': 'error',
      'no-implicit-globals': 'error',
      'no-unused-expressions': 'error',
      'consistent-return': 'error',
      'require-await': 'error',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-trailing-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 2 }],
      'no-mixed-spaces-and-tabs': 'error',
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      indent: ['error', 2, { SwitchCase: 1 }],
      'max-len': ['error', { code: 200, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true, ignoreComments: true }],
      // Medidas, no errores: las funciones que conviene partir.
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true, IIFEs: false }],
      complexity: ['warn', 25],
      'max-depth': ['warn', 5],
    },
  },
];
