import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResumePage } from './ResumePage';
import { RESUME_PATH, stashReturnTo, takeStashedReturnTo } from './returnToStash';

const renderResume = (route: string): void => {
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={`${RESUME_PATH}/:key`} element={<ResumePage />} />
        <Route path="*" element={<span data-testid="landed">{window.location.pathname}</span>} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('returnTo stash', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('sends an opaque key through OAuth instead of the share token', () => {
    // The finding this exists for: `returnTo` is base64-encoded into the OAuth `state` and handed
    // to Google as a query parameter. On `/s/:token/…` that parameter *is* a 32-byte bearer
    // capability, and `state` is encoding, not encryption.
    const token = 'sharetoken0123456789abcdef0123456789abcdef';
    const returnTo = stashReturnTo(`/s/${token}/file/n1`);

    expect(returnTo).toMatch(new RegExp(`^${RESUME_PATH}/[0-9a-f]{32}$`));
    expect(returnTo).not.toContain(token);
  });

  it('round-trips the path it was given', () => {
    const key = stashReturnTo('/s/tok/f/n1?page=2').slice(`${RESUME_PATH}/`.length);
    expect(takeStashedReturnTo(key)).toBe('/s/tok/f/n1?page=2');
  });

  it('burns the key: a stash is good for exactly one redirect', () => {
    const key = stashReturnTo('/rooms/r1').slice(`${RESUME_PATH}/`.length);
    expect(takeStashedReturnTo(key)).toBe('/rooms/r1');
    expect(takeStashedReturnTo(key)).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('returns nothing for a key that was never issued', () => {
    expect(takeStashedReturnTo('deadbeef')).toBeNull();
    expect(takeStashedReturnTo(undefined)).toBeNull();
    expect(takeStashedReturnTo('')).toBeNull();
  });

  it('refuses to stash an off-origin path, and refuses to hand one back', () => {
    expect(stashReturnTo('https://evil.example.com')).toBe('/rooms');
    expect(stashReturnTo('/\\evil.example.com')).toBe('/rooms');

    // sessionStorage is writable by anything on this origin, so the value is validated on the way
    // out as well as on the way in.
    window.sessionStorage.setItem('dataroom.returnTo.planted', '//evil.example.com');
    expect(takeStashedReturnTo('planted')).toBeNull();
  });

  it('writes nothing that is not scoped to this feature', () => {
    stashReturnTo('/rooms/r1');
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.key(0)).toMatch(/^dataroom\.returnTo\./);
  });
});

describe('ResumePage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('replaces itself with the stashed destination', async () => {
    const key = stashReturnTo('/s/tok/file/n1').slice(`${RESUME_PATH}/`.length);
    renderResume(`${RESUME_PATH}/${key}`);
    expect(await screen.findByTestId('landed')).toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('falls back to the rooms list when the key is gone', async () => {
    // A different tab, a cleared session, a forwarded link. The user is signed in by now, so there
    // is nothing to recover and nothing to apologise for.
    renderResume(`${RESUME_PATH}/never-issued`);
    expect(await screen.findByTestId('landed')).toBeInTheDocument();
  });
});
