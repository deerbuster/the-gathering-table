export function validProfilePhoto(photo: string): boolean {
  return photo === '' || (photo.length <= 90000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo));
}
export async function prepareProfilePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG or WebP image smaller than 5 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image processing is unavailable.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
    const size = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
    const photo = canvas.toDataURL('image/jpeg', .75);
    if (!validProfilePhoto(photo)) throw new Error('This picture is too large. Choose a simpler image.');
    return photo;
  } finally { bitmap.close(); }
}
