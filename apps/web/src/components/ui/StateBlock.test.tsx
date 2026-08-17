import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StateBlock } from './StateBlock';

describe('StateBlock', () => {
  it('renders a title only', () => {
    render(<StateBlock title="This folder is empty" />);
    expect(screen.getByText('This folder is empty')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders body text and both actions and calls them', async () => {
    const action = vi.fn();
    const secondary = vi.fn();
    render(
      <StateBlock
        title="Couldn't load this folder"
        body="The server didn't respond."
        action={{ label: 'Try again', onClick: action }}
        secondaryAction={{ label: 'Go back', onClick: secondary }}
        tone="danger"
      />,
    );
    expect(screen.getByText("The server didn't respond.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(secondary).toHaveBeenCalledTimes(1);
  });
});
