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
  return prepareImage(file, 1600, 1200, 300000, false);
}
async function prepareImage(file: File, width: number, height: number, limit: number, crop = true): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP image smaller than 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const fit = Math.min(1, width / bitmap.width, height / bitmap.height);
    canvas.width = crop ? width : Math.max(1, Math.round(bitmap.width * fit));
    canvas.height = crop ? height : Math.max(1, Math.round(bitmap.height * fit));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image processing is unavailable.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const sourceWidth = width / scale; const sourceHeight = height / scale;
    if (crop) ctx.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height);
    else ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let photo = canvas.toDataURL('image/jpeg', crop ? .75 : .88);
    if (!crop) {
      for (const quality of [.8, .7, .6]) {
        if (photo.length <= limit) break;
        photo = canvas.toDataURL('image/jpeg', quality);
      }
      while (photo.length > limit && canvas.width > 400) {
        canvas.width = Math.round(canvas.width * .8); canvas.height = Math.max(1, Math.round(canvas.height * .8));
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        photo = canvas.toDataURL('image/jpeg', .8);
      }
    }
    if (photo.length > limit) throw new Error('This picture is too large. Choose a simpler image.');
    return photo;
  } finally { bitmap.close(); }
}
