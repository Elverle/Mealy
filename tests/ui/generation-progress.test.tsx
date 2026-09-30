import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GENERATION_MESSAGES,
  GENERATION_MESSAGE_INTERVAL_MS,
  GenerationProgress,
  useRotatingMessage,
} from '@/components/plan/generation-progress';

describe('GenerationProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with the first message and rotates every 2500 ms', () => {
    render(<GenerationProgress />);
    expect(screen.getByText('Sto sfogliando il ricettario…')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(GENERATION_MESSAGE_INTERVAL_MS);
    });
    expect(screen.getByText('Accendo i fornelli…')).toBeInTheDocument();
  });

  it('renders 4 skeletons by default and clamps cards to 1..6', () => {
    const { container, rerender } = render(<GenerationProgress />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4);
    rerender(<GenerationProgress cards={9} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(6);
    rerender(<GenerationProgress cards={0} />);
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });

  it('never renders a progressbar', () => {
    render(<GenerationProgress />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('useRotatingMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps around circularly', () => {
    const { result } = renderHook(() => useRotatingMessage(['a', 'b'], 100));
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('b');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('a');
  });

  it('stays on the first message while inactive and restarts from it', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useRotatingMessage(GENERATION_MESSAGES, 100, active),
      { initialProps: { active: true } }
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe(GENERATION_MESSAGES[2]);
    rerender({ active: false });
    expect(result.current).toBe(GENERATION_MESSAGES[0]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(GENERATION_MESSAGES[0]);
    rerender({ active: true });
    expect(result.current).toBe(GENERATION_MESSAGES[0]);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(GENERATION_MESSAGES[1]);
  });
});
