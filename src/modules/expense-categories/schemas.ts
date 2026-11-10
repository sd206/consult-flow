import { z } from 'zod'

export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a category name.')
  .max(60, 'Keep the name to 60 characters or fewer.')

/** Form wrapper, so field errors land on `name`. */
export const categoryFormSchema = z.object({ name: categoryNameSchema })
