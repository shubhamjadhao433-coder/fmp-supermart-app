/**
 * Compresses an uploaded browser image file (JPEG/PNG/WebP) via HTML5 Canvas
 * so store photos & product images stay safely within Firestore document limits (< 180 KB).
 */
export async function compressImageFileToDataUrl(
  file: File,
  maxDimension: number = 800,
  maxOutputBytes: number = 180_000
): Promise<string> {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPG, PNG, or WebP).');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image file is too large (max 10 MB).');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image file.'));
    image.src = rawDataUrl;
  });

  let width = img.naturalWidth || img.width || maxDimension;
  let height = img.naturalHeight || img.height || maxDimension;

  if (width > maxDimension || height > maxDimension) {
    if (width >= height) {
      height = Math.max(1, Math.round((height / width) * maxDimension));
      width = maxDimension;
    } else {
      width = Math.max(1, Math.round((width / height) * maxDimension));
      height = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas image processing is unavailable in this browser.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.78;
  let output = canvas.toDataURL('image/jpeg', quality);
  while (output.length > maxOutputBytes && quality > 0.35) {
    quality -= 0.1;
    output = canvas.toDataURL('image/jpeg', quality);
  }

  if (output.length > maxOutputBytes) {
    // Resize down once more if still large
    const smallerCanvas = document.createElement('canvas');
    smallerCanvas.width = Math.round(width * 0.65);
    smallerCanvas.height = Math.round(height * 0.65);
    const sCtx = smallerCanvas.getContext('2d');
    if (sCtx) {
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(0, 0, smallerCanvas.width, smallerCanvas.height);
      sCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
      output = smallerCanvas.toDataURL('image/jpeg', 0.65);
    }
  }

  return output;
}
