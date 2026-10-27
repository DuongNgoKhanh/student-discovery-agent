/** ASCII slug for document/KB ids: Vietnamese marks removed, `đ` → `d`, runs of other characters → `-`. */
export function slugify(value: string, max = 128): string {
  const ascii = value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  return ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
}

export function documentIdFromFilename(name: string): string {
  return slugify(name.replace(/\.(md|markdown|txt)$/i, ''));
}
