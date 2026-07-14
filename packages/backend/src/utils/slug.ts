/**
 * Convert text to a URL-safe slug (lowercase, hyphens, without accents).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric characters.
    .replace(/[\s_-]+/g, '-') // espaces/underscores → tirets
    .replace(/^-+|-+$/g, ''); // retire les tirets en bouts
}
