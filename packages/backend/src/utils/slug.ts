/**
 * Convertit un texte en slug URL-safe (minuscules, tirets, sans accents).
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // retire les caractères non alphanumériques
    .replace(/[\s_-]+/g, '-') // espaces/underscores → tirets
    .replace(/^-+|-+$/g, ''); // retire les tirets en bouts
}
