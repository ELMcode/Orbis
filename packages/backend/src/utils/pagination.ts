import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type Pagination = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export function parsePagination(query: unknown): Pagination {
  const parsed = paginationSchema.parse(query ?? {});
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    skip: (parsed.page - 1) * parsed.pageSize,
    take: parsed.pageSize,
  };
}

export function paginationMeta(pagination: Pagination, total: number): PaginationMeta {
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    pageCount,
    hasNextPage: pagination.page < pageCount,
    hasPreviousPage: pagination.page > 1,
  };
}
