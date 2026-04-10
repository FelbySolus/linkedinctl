import type { Pattern } from '../core/runtime-types.js';

export const INTRO_EDIT_BUTTON_PATTERNS: readonly Pattern[] = [/edit intro/i, /editar .*introdução/i, /editar .*intro/i];

export const SAVE_BUTTON_PATTERNS: readonly Pattern[] = [/save/i, /guardar/i, /salvar/i, /done/i, /concluir/i];

export const ABOUT_EDIT_BUTTON_PATTERNS: readonly Pattern[] = [/edit about/i, /editar .*sobre/i];
export const ADD_SECTION_BUTTON_PATTERNS: readonly Pattern[] = [/add section/i, /adicionar sec/i, /adicionar seção/i];
export const ABOUT_SECTION_PICKER_PATTERNS: readonly Pattern[] = [/about/i, /^sobre$/i, /acerca/i];

export const PHOTO_EDIT_BUTTON_PATTERNS: readonly Pattern[] = [/edit photo/i, /profile photo/i, /editar foto/i, /foto de perfil/i, /change photo/i];
export const COVER_EDIT_BUTTON_PATTERNS: readonly Pattern[] = [
  /edit background photo/i,
  /edit cover photo/i,
  /editar imagem de fundo/i,
  /editar foto de fundo/i,
  /editar .*capa/i,
  /foto de fundo/i,
];

export const HEADLINE_INPUT_SELECTORS: readonly string[] = [
  'input[aria-label*="Cargo"]',
  'textarea[aria-label*="Cargo"]',
  '[role="textbox"][contenteditable="true"]',
  'div[role="textbox"]',
  'input[name="headline"]',
  'input[id*="headline"]',
  'textarea[name*="headline"]',
  'textarea[id*="headline"]',
  'textarea[name="headline"]',
  'textarea[aria-label*="Título"]',
  'input[aria-label*="Título"]',
  'input[aria-label*="Headline"]',
  'textarea[aria-label*="Headline"]',
  'div[role="dialog"] textarea',
];

export const ABOUT_TEXTAREA_SELECTORS: readonly string[] = [
  '[role="textbox"][contenteditable="true"]',
  'div[role="textbox"]',
  'textarea[name="summary"]',
  'textarea[id*="about"]',
  'textarea[aria-label*="About"]',
  'textarea[aria-label*="Sobre"]',
  'textarea',
];

export const HEADLINE_TEXT_SELECTORS: readonly string[] = [
  'div.text-body-medium.break-words',
  'h2.mt1',
  '[data-generated-suggestion-target] ~ div',
];

export const ABOUT_TEXT_SELECTORS: readonly string[] = [
  'section:has(#about) div.display-flex.ph5.pv3 > div > span',
  '#about ~ div span[aria-hidden="true"]',
  'section:has(#about) span[aria-hidden="true"]',
];
