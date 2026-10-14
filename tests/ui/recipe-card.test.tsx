import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecipeCard } from '@/components/library/recipe-card';
import { fixtureRecipesAsDomain } from '@/fixtures';
import { toLibraryCard } from '@/lib/domain/library';
import type { LibraryRecipeCard } from '@/lib/domain/types';

const TITLE = 'Salmone al forno';

function makeCard(overrides: Partial<LibraryRecipeCard> = {}): LibraryRecipeCard {
  return { ...toLibraryCard(fixtureRecipesAsDomain()[0]), title: TITLE, ...overrides };
}

describe('RecipeCard (library, without the ★ command)', () => {
  it('calls onToggleFavorite with the recipe id when the ★ is a command', () => {
    const onToggleFavorite = vi.fn();
    const recipe = makeCard({ id: 'recipe-7', favorite: false });
    render(<RecipeCard recipe={recipe} onOpen={vi.fn()} onToggleFavorite={onToggleFavorite} />);
    const star = screen.getByRole('button', { name: `Aggiungi ${TITLE} ai preferiti` });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledWith('recipe-7');
  });

  it('renders no favorite button and no Preferita mark when not favorite and no handler', () => {
    render(<RecipeCard recipe={makeCard({ favorite: false })} onOpen={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /preferiti/ })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Preferita' })).toBeNull();
  });

  it('shows a non-interactive Preferita mark for a favorite recipe without handler', () => {
    render(<RecipeCard recipe={makeCard({ favorite: true })} onOpen={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Preferita' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preferiti/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('shows the badge text and puts it in the name of the opening button after the title', () => {
    render(
      <RecipeCard recipe={makeCard({ favorite: false })} onOpen={vi.fn()} badge="Già nel piano" />
    );
    expect(screen.getByText('Già nel piano')).toBeInTheDocument();
    const opener = screen.getByRole('button', { name: /^\d+ min / });
    expect(opener).toHaveAccessibleName(expect.stringMatching(new RegExp(`${TITLE}\\s+Già nel piano`)));
  });

  it('shows no badge text when the badge prop is absent', () => {
    render(<RecipeCard recipe={makeCard()} onOpen={vi.fn()} />);
    expect(screen.queryByText('Già nel piano')).toBeNull();
  });

  it('shows Bloccata and no favorite control for a blocked recipe, with or without handler', () => {
    const blocked = makeCard({ blocked: true, favorite: false });
    const { unmount } = render(
      <RecipeCard recipe={blocked} onOpen={vi.fn()} onToggleFavorite={vi.fn()} />
    );
    expect(screen.getByText('Bloccata')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preferiti/ })).toBeNull();
    unmount();

    render(<RecipeCard recipe={blocked} onOpen={vi.fn()} />);
    expect(screen.getByText('Bloccata')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Preferita' })).toBeNull();
  });

  it('gives Bloccata priority over the Preferita mark', () => {
    render(<RecipeCard recipe={makeCard({ blocked: true, favorite: true })} onOpen={vi.fn()} />);
    expect(screen.getByText('Bloccata')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Preferita' })).toBeNull();
  });

  it('opens the recipe with its id when the card body is activated', () => {
    const onOpen = vi.fn();
    render(<RecipeCard recipe={makeCard({ id: 'recipe-9' })} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /^\d+ min / }));
    expect(onOpen).toHaveBeenCalledWith('recipe-9');
  });
});
