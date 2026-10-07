export function validProfilePhoto(photo: string): boolean {
  return photo === '' || (photo.length <= 90000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo));
}
export async function prepareProfilePhoto(file: File): Promise<string> {
  return prepareImage(file, 256, 256, 90000);
}
export function validCampaignBackground(photo: string): boolean {
  return photo === '' || (photo.length <= 300000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo));
}
export async function prepareCampaignBackground(file: File): Promise<string> {
  return prepareImage(file, 1200, 400, 300000);
}
async function prepareImage(file: File, width: number, height: number, limit: number): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP image smaller than 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image processing is unavailable.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const sourceWidth = width / scale; const sourceHeight = height / scale;
    ctx.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
    const photo = canvas.toDataURL('image/jpeg', .75);
    if (photo.length > limit) throw new Error('This picture is too large. Choose a simpler image.');
    return photo;
  } finally { bitmap.close(); }
}
