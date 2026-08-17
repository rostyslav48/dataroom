import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { errors } from './domain-error';

/**
 * Validation happens once, against the contract schema, at the controller boundary.
 *
 * There are deliberately no `class-validator` DTOs anywhere in this codebase: two validation
 * systems means two definitions of "valid", and the frontend only knows about one of them.
 */
@Injectable()
export class ZodValidationPipe<TOut, TIn = unknown>
  implements PipeTransform<unknown, TOut>
{
  constructor(private readonly schema: ZodType<TOut, ZodTypeDef, TIn>) {}

  transform(value: unknown): TOut {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_root';
      (details[key] ??= []).push(issue.message);
    }
    throw errors.validationFailed(details, 'Some fields need attention.');
  }
}

/** `@Body(validate(CreateFolderBody))` reads better than `new ZodValidationPipe(...)` inline. */
export const validate = <TOut, TIn>(
  schema: ZodType<TOut, ZodTypeDef, TIn>,
): ZodValidationPipe<TOut, TIn> => new ZodValidationPipe(schema);
