/**
 * Génère l'image d'aperçu des liens (Open Graph, 1200×630) et l'icône iPhone.
 * Outil de développement, à relancer seulement si le visuel change :
 *   CHROME_PATH=/chemin/vers/chrome node scripts/make-images.mjs
 */
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, rmSync } from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fonts = pathToFileURL(path.join(root, 'src/assets/fonts')).href;
const img = path.join(root, 'src/assets/img');

const css = `
@font-face{font-family:C;font-weight:500;src:url(${fonts}/cormorant-garamond-latin-500-normal.woff2)}
@font-face{font-family:C;font-weight:500;font-style:italic;src:url(${fonts}/cormorant-garamond-latin-500-italic.woff2)}
@font-face{font-family:M;font-weight:500;src:url(${fonts}/montserrat-latin-500-normal.woff2)}
*{margin:0;box-sizing:border-box}
body{background:#101B3D;color:#fff;font-family:M;overflow:hidden}
.pattern{position:absolute;inset:0;opacity:.08;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56'%3E%3Cg fill='none' stroke='%23F9E000' stroke-width='1'%3E%3Cpath d='M28 4 52 28 28 52 4 28Z'/%3E%3Cpath d='M28 16 40 28 28 40 16 28Z'/%3E%3C/g%3E%3C/svg%3E");-webkit-mask-image:radial-gradient(ellipse at center,#000 10%,transparent 70%)}
`;

const og = `<html><head><style>${css}
.wrap{position:relative;width:1200px;height:630px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
background:radial-gradient(60% 70% at 50% 40%,#1F2F63,transparent 75%),#101B3D}
.frame{position:absolute;inset:26px;border:1px solid rgba(249,224,0,.45);border-radius:6px}
.frame2{position:absolute;inset:36px;border:1px solid rgba(255,255,255,.12);border-radius:4px}
.fam{font-size:22px;letter-spacing:.55em;text-indent:.55em;color:rgba(255,255,255,.8)}
.name{white-space:nowrap;font-family:C;font-weight:500;font-size:96px;letter-spacing:.08em;text-indent:.08em;line-height:.95}
.amp{font-family:C;font-style:italic;color:#F9E000;font-size:64px;line-height:1}
.tag{font-family:C;font-style:italic;font-size:32px;margin-top:20px}
.dates{margin-top:14px;font-size:18px;letter-spacing:.22em;color:#F9E000}
</style></head><body><div class="wrap"><div class="pattern"></div><div class="frame"></div><div class="frame2"></div>
<div class="fam">FAMILLES</div><div class="name" style="margin-top:16px">OUATTARA</div><div class="amp">&amp;</div><div class="name">KANTÉ</div>
<div class="tag">« Deux familles, une union, une célébration. »</div>
<div class="dates">24.12.2026 · DALOA &nbsp;—&nbsp; 03.01.2027 · ABIDJAN</div></div></body></html>`;

const icon = `<html><head><style>${css}
.i{width:180px;height:180px;display:grid;place-items:center;background:radial-gradient(circle at 50% 35%,#1F2F63,transparent 75%),#101B3D}
.r{width:150px;height:150px;border-radius:50%;border:2px solid #F9E000;display:grid;place-items:center;font-family:C;font-size:58px;font-weight:500}
.r i{color:#F9E000}</style></head><body><div class="i"><div class="r"><span>O<i>&amp;</i>K</span></div></div></body></html>`;

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });
const f = path.join(root, '.make-images.tmp.html');
const show = async (html) => { writeFileSync(f, html); await page.goto(pathToFileURL(f).href, { waitUntil: 'load' }); };
await show(og);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(img, 'og-image.jpg'), type: 'jpeg', quality: 86 });
await page.setViewport({ width: 180, height: 180 });
await show(icon);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(img, 'apple-touch-icon.png') });
await browser.close();
rmSync(f, { force: true });
console.log('✔ Images générées dans src/assets/img/');
