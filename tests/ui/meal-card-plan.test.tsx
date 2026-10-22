import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, MealCard } from '@/components/cards/meal-card';

// jsdom has no PointerEvent: without it fireEvent.pointer* drops button/clientX/clientY.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {}
  Object.defineProperty(window, 'PointerEvent', {
    value: PointerEventPolyfill,
    configurable: true,
  });
}

const base = {
  id: 'meal-1',
  day: 'Lunedì',
  mealType: 'Cena',
  title: 'Salmone al forno',
};

describe('MealCard (plan behaviours)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes a data-testid on the root', () => {
    render(<MealCard {...base} />);
    expect(screen.getByTestId('meal-card-meal-1')).toBeInTheDocument();
  });

  it('renders no favorite button without onToggleFavorite', () => {
    render(<MealCard {...base} onSwap={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Aggiungi ai preferiti' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cambia Salmone al forno' })).toBeInTheDocument();
  });

  it('renders no Cambia button without onSwap', () => {
    render(<MealCard {...base} onToggleFavorite={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Cambia/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Aggiungi ai preferiti' })).toBeInTheDocument();
  });

  it('renders no footer at all without handlers or actions', () => {
    const { container } = render(<MealCard {...base} onToggleLock={vi.fn()} />);
    expect(container.querySelector('.border-t')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cambia/ })).toBeNull();
  });

  it('actions replace the whole footer', () => {
    render(
      <MealCard
        {...base}
        onSwap={vi.fn()}
        onToggleFavorite={vi.fn()}
        actions={<button>Tieni</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Tieni' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Cambia/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /preferiti/ })).toBeNull();
  });

  it('long-press fires onLongPress and suppresses the following click', () => {
    const onLongPress = vi.fn();
    const onSelect = vi.fn();
    render(<MealCard {...base} onLongPress={onLongPress} onSelect={onSelect} />);
    const card = screen.getByTestId('meal-card-meal-1');
    fireEvent.pointerDown(card, { button: 0, clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).toHaveBeenCalledWith('meal-1');
    fireEvent.pointerUp(card);
    fireEvent.click(screen.getByText('Salmone al forno'));
    expect(onSelect).not.toHaveBeenCalled();
    // the suppression is consumed: the next click selects
    fireEvent.click(screen.getByText('Salmone al forno'));
    expect(onSelect).toHaveBeenCalledWith('meal-1');
  });

  it('a short press does not long-press and the click selects', () => {
    const onLongPress = vi.fn();
    const onSelect = vi.fn();
    render(<MealCard {...base} onLongPress={onLongPress} onSelect={onSelect} />);
    const card = screen.getByTestId('meal-card-meal-1');
    fireEvent.pointerDown(card, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.pointerUp(card);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onLongPress).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Salmone al forno'));
    expect(onSelect).toHaveBeenCalledWith('meal-1');
  });

  it('moving more than 10px cancels the long-press', () => {
    const onLongPress = vi.fn();
    render(<MealCard {...base} onLongPress={onLongPress} />);
    const card = screen.getByTestId('meal-card-meal-1');
    fireEvent.pointerDown(card, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(card, { clientX: 0, clientY: 20 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('ignores non-primary buttons', () => {
    const onLongPress = vi.fn();
    render(<MealCard {...base} onLongPress={onLongPress} />);
    fireEvent.pointerDown(screen.getByTestId('meal-card-meal-1'), { button: 2 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('pointerDown on the lock button does not start a long-press', () => {
    const onLongPress = vi.fn();
    render(<MealCard {...base} onLongPress={onLongPress} onToggleLock={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Blocca pasto' }), { button: 0 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('clears the timer on unmount', () => {
    const onLongPress = vi.fn();
    const { unmount } = render(<MealCard {...base} onLongPress={onLongPress} />);
    fireEvent.pointerDown(screen.getByTestId('meal-card-meal-1'), { button: 0 });
    unmount();
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('MealCard (pick action "Scegli")', () => {
  const pickName = "Scegli un'altra ricetta per Salmone al forno";

  it('shows Scegli with its aria-label and calls onPick with the id, not onSelect', () => {
    const onPick = vi.fn();
    const onSelect = vi.fn();
    render(<MealCard {...base} onPick={onPick} onSelect={onSelect} />);
    const pick = screen.getByRole('button', { name: pickName });
    expect(pick).toHaveTextContent('Scegli');
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledWith('meal-1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders no Scegli button without onPick', () => {
    render(<MealCard {...base} onSwap={vi.fn()} onToggleFavorite={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Scegli/ })).toBeNull();
  });

  it('disables Scegli when the meal is locked, like Cambia', () => {
    render(<MealCard {...base} isLocked onSwap={vi.fn()} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: pickName })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cambia Salmone al forno' })).toBeDisabled();
  });

  it('shows the footer when only onPick is provided', () => {
    const { container } = render(<MealCard {...base} onPick={vi.fn()} />);
    expect(container.querySelector('.border-t')).not.toBeNull();
    expect(screen.getByRole('button', { name: pickName })).toBeInTheDocument();
  });

  it('orders the footer as Cambia, Scegli, preferiti', () => {
    render(
      <MealCard {...base} onSwap={vi.fn()} onPick={vi.fn()} onToggleFavorite={vi.fn()} />
    );
    const names = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    const cambia = names.indexOf('Cambia Salmone al forno');
    const scegli = names.indexOf(pickName);
    const preferiti = names.indexOf('Aggiungi ai preferiti');
    expect(cambia).toBeGreaterThanOrEqual(0);
    expect(scegli).toBeGreaterThan(cambia);
    expect(preferiti).toBeGreaterThan(scegli);
  });

  it('gives the pick button the 44 px minimum height class (jsdom has no layout)', () => {
    render(<MealCard {...base} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: pickName })).toHaveClass('min-h-[44px]');
  });

  it('actions replace the footer and hide Scegli', () => {
    render(<MealCard {...base} onPick={vi.fn()} actions={<button>Tieni</button>} />);
    expect(screen.getByRole('button', { name: 'Tieni' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Scegli/ })).toBeNull();
  });
});

describe('MealCard (course badge)', () => {
  it('shows the course right after the time badge and before the style tags', () => {
    render(
      <MealCard {...base} prepTimeMinutes={20} course="Secondo · Contorno" tags={['Veloce']} />
    );
    const time = screen.getByText('20 min');
    const course = screen.getByText('Secondo · Contorno');
    const tag = screen.getByText('Veloce');
    expect(time.compareDocumentPosition(course) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(course.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the course alone when there is no prep time and no tag', () => {
    render(<MealCard {...base} course="Primo" />);
    expect(screen.getByText('Primo')).toBeInTheDocument();
  });

  it('shows no course text without a course', () => {
    render(<MealCard {...base} prepTimeMinutes={20} tags={['Veloce']} />);
    expect(screen.queryByText(/Primo|Secondo|Contorno|Piatto unico/)).toBeNull();
    expect(screen.getByText('20 min')).toBeInTheDocument();
  });
});
