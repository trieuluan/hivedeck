import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';

export const projectSearchSchema = z.object({
  tab: z.enum(['artifacts']).optional(),
});

export type ProjectSearch = z.infer<typeof projectSearchSchema>;

export const projectSearchValidator = zodValidator(projectSearchSchema);
