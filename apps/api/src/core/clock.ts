import { Injectable } from '@nestjs/common';

/**
 * The engine asks this for "now" instead of calling `new Date()` directly, so tests can
 * move time forward to trigger deadlines and the seed script can create realistic history.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}
