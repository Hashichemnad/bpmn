export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Safe file name from a process code and name. */
export function exportFileName(code: string, name: string, ext: string): string {
  const base = `${code} ${name}`
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_');
  return `${base || 'process'}.${ext}`;
}

/** Rasterises an SVG string to PNG (2x for crisp output) on a white background. */
export function svgToPng(svg: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(img.width * scale);
      canvas.height = Math.ceil(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG could not be rendered'));
    };
    img.src = url;
  });
}
