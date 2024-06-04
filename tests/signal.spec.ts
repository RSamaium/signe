import { signal } from '@signe/reactive';
import { describe, expect, test } from 'vitest';

describe('signal', () => {
    test('signal is BehaviorSubject', () => {
        const s = signal(1);
        expect(s._subject).toBeTruthy();
    })
})