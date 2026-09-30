import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '@/components/feedback/toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the message with role status', () => {
    render(<Toast message="Piano generato" onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Piano generato');
  });

  it('calls onDismiss after 3000 ms', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Ciao" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('honours a custom duration', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Ciao" onDismiss={onDismiss} durationMs={500} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps an empty live region mounted and schedules nothing when message is null', () => {
    const onDismiss = vi.fn();
    render(<Toast message={null} onDismiss={onDismiss} />);
    // Regione sempre presente: VoiceOver iOS annuncia male le live region inserite già piene.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('announces a message set after mount inside the same live region', () => {
    const { rerender } = render(<Toast message={null} onDismiss={vi.fn()} />);
    const region = screen.getByRole('status');
    rerender(<Toast message="Piano confermato" onDismiss={vi.fn()} />);
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent('Piano confermato');
  });

  it('never intercepts taps on what lies below (it has no actions)', () => {
    render(<Toast message="Piano confermato" onDismiss={vi.fn()} />);
    expect(screen.getByText('Piano confermato')).toHaveClass('pointer-events-none');
  });

  it('can be raised above a sticky footer', () => {
    render(<Toast message="Ciao" onDismiss={vi.fn()} className="bottom-40" />);
    expect(screen.getByRole('status')).toHaveClass('bottom-40');
    expect(screen.getByRole('status')).not.toHaveClass('bottom-24');
  });

  it('does not dismiss after unmount', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Toast message="Ciao" onDismiss={onDismiss} />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
