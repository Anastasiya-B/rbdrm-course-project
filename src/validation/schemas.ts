import { z } from 'zod';

export const positiveIdSchema = z.coerce.number().int().positive();
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  cursor: z.string().min(1).max(500).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(512),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(1000) });
export const logoutSchema = refreshSchema;

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  price: z.number().int().positive().safe(),
  stockQuantity: z.number().int().min(0).max(1_000_000).default(0),
});

export const createOrderSchema = z.object({
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    quantity: z.number().int().positive().max(1_000_000),
  })).min(1).max(100),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['cancelled']),
});

export const uploadIntentSchema = z.object({
  filename: z.string().max(255).optional(),
  contentType: z.string().min(1).max(200),
  size: z.number().int().min(0).max(1_000_000_000).optional(),
});
export const uploadCommitSchema = z.object({ fileId: z.string().uuid() });

export const webhookSchema = z.object({
  event_id: z.string().min(1).max(200),
  order_id: z.number().int().positive(),
  amount: z.number().int().positive().safe(),
});
