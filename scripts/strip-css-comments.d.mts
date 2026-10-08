import type { Plugin } from "vite";
export function stripCssComments(): Plugin;
export function stripTemplateCss(code: string, file?: string): string;
