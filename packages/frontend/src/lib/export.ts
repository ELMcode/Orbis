import { toPng, toSvg } from 'html-to-image';
import { saveAs } from 'file-saver';
import type { Diagram } from '@/types';

const FILTER = (node: HTMLElement) =>
  !node?.classList?.contains('react-flow__minimap') &&
  !node?.classList?.contains('react-flow__controls') &&
  !node?.classList?.contains('react-flow__panel') &&
  !node?.dataset?.exportIgnore;

export async function exportDiagramPng(element: HTMLElement, filename: string) {
  const dataUrl = await toPng(element, {
    filter: FILTER,
    backgroundColor: getComputedStyle(document.body).getPropertyValue('--background') || '#0a0e1a',
    pixelRatio: 2,
    cacheBust: true,
  });
  saveAs(dataUrl, `${filename}.png`);
}

export async function exportDiagramSvg(element: HTMLElement, filename: string) {
  const dataUrl = await toSvg(element, {
    filter: FILTER,
    backgroundColor: getComputedStyle(document.body).getPropertyValue('--background') || '#0a0e1a',
    cacheBust: true,
  });
  // Convert the data URL to an SVG blob.
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  saveAs(blob, `${filename}.svg`);
}

export function exportDiagramJson(diagram: Diagram) {
  const payload = {
    name: diagram.name,
    nodes: diagram.nodes,
    edges: diagram.edges,
    exportedAt: new Date().toISOString(),
    version: diagram.version,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  saveAs(blob, `${diagram.name.replace(/[^a-z0-9-_]+/gi, '_')}.json`);
}
