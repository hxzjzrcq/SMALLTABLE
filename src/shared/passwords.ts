import { z } from 'zod';
/** Shape only: the authoritative strength policy and blocklist run on the server. */
export const passwordChangeSchema = z
  .object({
    currentDMPassword: z.string().min(1).max(1024),
    roomPassword: z.string().min(1).max(256).optional(),
    dmPassword: z.string().min(1).max(256).optional(),
  })
  .strict()
  .refine((c) => c.roomPassword !== undefined || c.dmPassword !== undefined, '请填写新密码');
export type PasswordChange = z.infer<typeof passwordChangeSchema>;
